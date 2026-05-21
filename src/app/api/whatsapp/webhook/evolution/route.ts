import { NextResponse } from 'next/server'
import { db } from '@/db'
import {
  contacts,
  conversations,
  messages,
  whatsappConfig,
  broadcastRecipients,
} from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

// Mapping status Evolution API ke format DB kita ('sent', 'delivered', 'read', 'failed')
function mapEvolutionStatus(statusNum: number | string): string {
  const status = String(statusNum).toUpperCase()
  if (status === '3' || status === 'READ') return 'read'
  if (status === '2' || status === 'DELIVERY_ACK') return 'delivered'
  if (status === '1' || status === 'SERVER' || status === 'PENDING') return 'sent'
  if (status === 'ERROR' || status === 'FAILED') return 'failed'
  return 'sent'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { event, instance, data } = body

    if (!event || !instance || !data) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 })
    }

    // Cari config berdasarkan instanceName
    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.evolutionInstanceName, instance),
    })

    if (!config) {
      console.warn(`[Evolution Webhook] Konfigurasi tidak ditemukan untuk instance: ${instance}`)
      return NextResponse.json({ status: 'ignored', reason: 'No config found' })
    }

    // Jalankan secara asynchronous agar segera merespon webhook
    processEvolutionWebhook(event, config.userId, data).catch((err) => {
      console.error('[Evolution Webhook] Error saat memproses webhook:', err)
    })

    return NextResponse.json({ status: 'received' }, { status: 200 })
  } catch (error: any) {
    console.error('[Evolution Webhook] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

async function processEvolutionWebhook(event: string, userId: string, data: any) {
  // 1. Pesan Masuk / Keluar (messages.upsert)
  if (event === 'messages.upsert' && data.key) {
    const key = data.key
    const fromMe = key.fromMe
    const messageId = key.id
    const remoteJid = key.remoteJid

    // Hanya proses chat personal/individual (bukan grup @g.us)
    if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) {
      return
    }

    const senderPhone = normalizePhone(remoteJid.split('@')[0])
    const pushName = data.pushName || senderPhone

    // Parse pesan content
    const { contentText, contentType, mediaUrl } = parseEvolutionMessage(data)

    // Cari atau buat kontak
    const contactOutcome = await findOrCreateContact(userId, senderPhone, pushName)
    if (!contactOutcome) return
    const contactRecord = contactOutcome.contact

    // Cari atau buat percakapan
    const conversation = await findOrCreateConversation(userId, contactRecord.id)
    if (!conversation) return

    // Cek apakah pesan sudah terdaftar
    const existingMsg = await db.query.messages.findFirst({
      where: eq(messages.messageId, messageId),
    })

    if (existingMsg) {
      return // pesan sudah ada, abaikan
    }

    // Tentukan sender type
    const senderType = fromMe ? 'agent' : 'customer'

    // Hitung priorCustomerMsgCount untuk first inbound check
    let isFirstInboundMessage = false
    if (!fromMe) {
      const priorCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.senderType, 'customer')
          )
        )
      isFirstInboundMessage = (priorCount[0]?.count || 0) === 0
    }

    // Simpan pesan
    const timestamp = data.messageTimestamp
      ? new Date(data.messageTimestamp * 1000)
      : new Date()

    await db.insert(messages).values({
      conversationId: conversation.id,
      senderType,
      contentType,
      contentText,
      mediaUrl,
      messageId,
      status: fromMe ? 'sent' : 'delivered',
      createdAt: timestamp,
    })

    // Update percakapan
    await db
      .update(conversations)
      .set({
        lastMessageText: contentText || `[${contentType}]`,
        lastMessageAt: new Date(),
        unreadCount: fromMe ? conversation.unreadCount : (conversation.unreadCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id))

    // Jalankan automasi jika pesan masuk
    if (!fromMe) {
      const inboundText = contentText || ''
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
        }).catch((err) => console.error('[Evolution webhook automations] dispatch failed:', err))
      }
    }
  }

  // 2. Pembaruan Status Pesan (messages.update)
  if (event === 'messages.update' && data.key) {
    const messageId = data.key.id
    const statusNum = data.update?.status
    if (messageId && statusNum !== undefined) {
      const dbStatus = mapEvolutionStatus(statusNum)

      // Update tabel messages
      await db
        .update(messages)
        .set({ status: dbStatus })
        .where(eq(messages.messageId, messageId))

      // Update broadcast recipients
      const recipient = await db.query.broadcastRecipients.findFirst({
        where: eq(broadcastRecipients.whatsappMessageId, messageId),
      })

      if (recipient) {
        const updateData: Record<string, any> = { status: dbStatus }
        const now = new Date()
        if (dbStatus === 'sent') updateData.sentAt = now
        if (dbStatus === 'delivered') updateData.deliveredAt = now
        if (dbStatus === 'read') updateData.readAt = now

        await db
          .update(broadcastRecipients)
          .set(updateData)
          .where(eq(broadcastRecipients.id, recipient.id))
      }
    }
  }
}

function parseEvolutionMessage(data: any): {
  contentText: string | null
  contentType: string
  mediaUrl: string | null
} {
  const message = data.message
  const messageType = data.messageType

  if (!message) {
    return { contentText: null, contentType: 'text', mediaUrl: null }
  }

  // 1. Text biasa
  if (messageType === 'conversation' || message.conversation) {
    return {
      contentText: message.conversation || '',
      contentType: 'text',
      mediaUrl: null,
    }
  }

  // Extended text (dengan formatting/link)
  if (messageType === 'extendedTextMessage' || message.extendedTextMessage) {
    return {
      contentText: message.extendedTextMessage?.text || '',
      contentType: 'text',
      mediaUrl: null,
    }
  }

  // 2. Image
  if (messageType === 'imageMessage' || message.imageMessage) {
    const img = message.imageMessage
    return {
      contentText: img.caption || null,
      contentType: 'image',
      mediaUrl: img.url || null, // URL media langsung dari Evolution API
    }
  }

  // 3. Document
  if (messageType === 'documentMessage' || message.documentMessage) {
    const doc = message.documentMessage
    return {
      contentText: doc.title || doc.caption || null,
      contentType: 'document',
      mediaUrl: doc.url || null,
    }
  }

  // 4. Audio
  if (messageType === 'audioMessage' || message.audioMessage) {
    const aud = message.audioMessage
    return {
      contentText: null,
      contentType: 'audio',
      mediaUrl: aud.url || null,
    }
  }

  // 5. Video
  if (messageType === 'videoMessage' || message.videoMessage) {
    const vid = message.videoMessage
    return {
      contentText: vid.caption || null,
      contentType: 'video',
      mediaUrl: vid.url || null,
    }
  }

  // 6. Location
  if (messageType === 'locationMessage' || message.locationMessage) {
    const loc = message.locationMessage
    const locText = [loc.name, loc.address, `${loc.degreesLatitude},${loc.degreesLongitude}`]
      .filter(Boolean)
      .join(' - ')
    return {
      contentText: locText,
      contentType: 'location',
      mediaUrl: null,
    }
  }

  return {
    contentText: `[Unsupported Evolution message type: ${messageType}]`,
    contentType: 'text',
    mediaUrl: null,
  }
}

async function findOrCreateContact(userId: string, phone: string, name: string) {
  const userContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))

  const existingContact = userContacts.find((c) => phonesMatch(c.phone, phone))

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
    ),
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
