import { NextResponse } from 'next/server'
import { db } from '@/db'
import {
  whatsappConfig,
  messages,
  broadcastRecipients,
  broadcasts,
  messageReactions,
  conversations,
  contacts,
} from '@/db/schema'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs using Drizzle
    const configs = await db
      .select({
        id: whatsappConfig.id,
        verifyToken: whatsappConfig.verifyToken,
      })
      .from(whatsappConfig)

    // Check if any config's verify_token matches
    let matchedConfig: { id: string; verifyToken: string | null } | null = null
    for (const config of configs) {
      if (!config.verifyToken) continue
      try {
        if (decrypt(config.verifyToken) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed or wrong encryption key config row - skip
      }
    }

    if (matchedConfig) {
      // Self-heal verify_token to GCM format if legacy CBC
      if (matchedConfig.verifyToken && isLegacyFormat(matchedConfig.verifyToken)) {
        await db
          .update(whatsappConfig)
          .set({ verifyToken: encrypt(verifyToken) })
          .where(eq(whatsappConfig.id, matchedConfig.id))
          .catch((err) => {
            console.warn('[webhook] verify_token GCM upgrade failed:', err)
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhook(body).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id using Drizzle
      const config = await db.query.whatsappConfig.findFirst({
        where: eq(whatsappConfig.phoneNumberId, phoneNumberId),
      })

      if (!config || !config.accessToken) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      const decryptedAccessToken = decrypt(config.accessToken)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.userId,
          decryptedAccessToken
        )
      }
    }
  }
}

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages using Drizzle
  await db
    .update(messages)
    .set({ status: status.status })
    .where(eq(messages.messageId, status.id))
    .catch((err) => {
      console.error('Error updating message status in Drizzle:', err)
    })

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  const tsIso = new Date(parseInt(status.timestamp) * 1000)

  const recipient = await db.query.broadcastRecipients.findFirst({
    where: eq(broadcastRecipients.whatsappMessageId, status.id),
  })

  if (!recipient) return

  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, any> = { status: status.status }
  if (status.status === 'sent') update.sentAt = tsIso
  if (status.status === 'delivered') update.deliveredAt = tsIso
  if (status.status === 'read') update.readAt = tsIso

  await db
    .update(broadcastRecipients)
    .set(update)
    .where(eq(broadcastRecipients.id, recipient.id))
    .catch((err) => {
      console.error('Error updating broadcast recipient status in Drizzle:', err)
    })
}

async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    // Most recent outbound broadcast that hasn't been replied to yet.
    const rows = await db
      .select({
        id: broadcastRecipients.id,
        status: broadcastRecipients.status,
      })
      .from(broadcastRecipients)
      .innerJoin(broadcasts, eq(broadcastRecipients.broadcastId, broadcasts.id))
      .where(
        and(
          eq(broadcastRecipients.contactId, contactId),
          eq(broadcasts.userId, userId),
          inArray(broadcastRecipients.status, ['sent', 'delivered', 'read'])
        )
      )
      .orderBy(desc(broadcastRecipients.createdAt))
      .limit(1)

    if (rows.length === 0) return

    const row = rows[0]
    await db
      .update(broadcastRecipients)
      .set({ status: 'replied', repliedAt: new Date() })
      .where(eq(broadcastRecipients.id, row.id))
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const msg = await db.query.messages.findFirst({
    where: and(
      eq(messages.messageId, metaId),
      eq(messages.conversationId, conversationId)
    )
  })
  return msg?.id ?? null
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal
  if (!reaction.emoji) {
    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, targetInternalId),
          eq(messageReactions.actorType, 'customer'),
          eq(messageReactions.actorId, contactId)
        )
      )
      .catch((err) => {
        console.error('[webhook] reaction delete failed:', err)
      })
    return
  }

  // Upsert
  await db
    .insert(messageReactions)
    .values({
      messageId: targetInternalId,
      conversationId: conversationId,
      actorType: 'customer',
      actorId: contactId,
      emoji: reaction.emoji,
    })
    .onConflictDoUpdate({
      target: [messageReactions.messageId, messageReactions.actorType, messageReactions.actorId],
      set: { emoji: reaction.emoji }
    })
    .catch((err) => {
      console.error('[webhook] reaction upsert failed:', err)
    })
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    userId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    userId,
    contactRecord.id
  )
  if (!conversation) return

  // Reactions short-circuit
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl } = await parseMessageContent(
    message,
    accessToken
  )

  // Resolve swipe-reply context if present.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
  }

  // Map incoming WhatsApp types to allowed content types
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'template',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  // Determine whether this is the contact's very first inbound message
  const priorCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.senderType, 'customer')
      )
    )
  const isFirstInboundMessage = (priorCount[0]?.count || 0) === 0

  // Insert message using Drizzle
  await db.insert(messages).values({
    conversationId: conversation.id,
    senderType: 'customer',
    contentType: contentType,
    contentText: contentText,
    mediaUrl: mediaUrl,
    messageId: message.id,
    status: 'delivered',
    createdAt: new Date(parseInt(message.timestamp) * 1000),
    replyToMessageId: replyToInternalId,
  }).catch((err) => {
    console.error('Error inserting message in Drizzle:', err)
  })

  // Update conversation
  await db
    .update(conversations)
    .set({
      lastMessageText: contentText || `[${message.type}]`,
      lastMessageAt: new Date(),
      unreadCount: (conversation.unreadCount || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id))
    .catch((err) => {
      console.error('Error updating conversation in Drizzle:', err)
    })

  // If this contact was a recent broadcast recipient, flag the reply
  await flagBroadcastReplyIfAny(userId, contactRecord.id)

  // Run automations
  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = ['new_message_received', 'keyword_match']
  
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      userId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
}> {
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  switch (message.type) {
    case 'text':
      return {
        contentText: message.text?.body || null,
        mediaUrl: null,
        mediaType: null,
      }

    case 'image':
      if (message.image?.id) {
        return {
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'video':
      if (message.video?.id) {
        return {
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'document':
      if (message.document?.id) {
        return {
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'audio':
      if (message.audio?.id) {
        return {
          contentText: null,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'sticker':
      if (message.sticker?.id) {
        return {
          contentText: null,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return {
          contentText: locationText,
          mediaUrl: null,
          mediaType: null,
        }
      }
      return { contentText: null, mediaUrl: null, mediaType: null }

    case 'reaction':
      return {
        contentText: message.reaction?.emoji || null,
        mediaUrl: null,
        mediaType: null,
      }

    default:
      return {
        contentText: `[Unsupported message type: ${message.type}]`,
        mediaUrl: null,
        mediaType: null,
      }
  }
}

interface ContactOutcome {
  contact: any
  wasCreated: boolean
}

async function findOrCreateContact(
  userId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const userContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))

  const existingContact = userContacts?.find((c) => phonesMatch(c.phone, phone))

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await db
        .update(contacts)
        .set({ name, updatedAt: new Date() })
        .where(eq(contacts.id, existingContact.id))
    }
    return { contact: existingContact, wasCreated: false }
  }

  const [newContact] = await db
    .insert(contacts)
    .values({
      userId,
      phone,
      name: name || phone,
    })
    .returning()

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.userId, userId),
      eq(conversations.contactId, contactId)
    )
  })

  if (existing) {
    return existing
  }

  const [newConv] = await db
    .insert(conversations)
    .values({
      userId,
      contactId,
    })
    .returning()

  return newConv
}
