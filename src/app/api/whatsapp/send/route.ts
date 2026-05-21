import { NextResponse } from 'next/server'
import { db } from '@/db'
import { conversations, contacts, messages, whatsappConfig } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/auth'
import { WhatsAppProviderFactory } from '@/lib/whatsapp/factory'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Per-user rate limit.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      template_name,
      template_params,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    // Fetch conversation and contact using Drizzle
    const conversation = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversation_id), eq(conversations.userId, userId)),
      with: {
        contact: true
      }
    })

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Fetch WhatsApp config using Drizzle
    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.userId, userId)
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    // Self-heal legacy CBC-encrypted tokens for Meta provider
    if (config.providerType === 'meta' && config.accessToken && isLegacyFormat(config.accessToken)) {
      const accessToken = decrypt(config.accessToken)
      await db
        .update(whatsappConfig)
        .set({ accessToken: encrypt(accessToken) })
        .where(eq(whatsappConfig.id, config.id))
    }

    // Get WhatsApp provider from factory
    const provider = await WhatsAppProviderFactory.getProvider(userId)
    if (!provider) {
      return NextResponse.json(
        { error: 'Failed to initialize WhatsApp provider. Please check your credentials.' },
        { status: 400 }
      )
    }

    // Resolve reply targets
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const parent = await db.query.messages.findFirst({
        where: and(
          eq(messages.id, reply_to_message_id),
          eq(messages.conversationId, conversation_id)
        )
      })

      if (!parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.messageId) {
        console.warn(
          '[whatsapp/send] reply target has no WhatsApp message_id; sending without context'
        )
      } else {
        contextMessageId = parent.messageId
      }
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await provider.sendTemplateMessage(
          phone,
          template_name,
          'en_US', // default language
          template_params || [],
          contextMessageId
        )
        return result.messageId
      }
      const result = await provider.sendTextMessage(
        phone,
        content_text,
        contextMessageId
      )
      return result.messageId
    }

    try {
      if (config.providerType === 'meta') {
        const variants = phoneVariants(sanitizedPhone)
        let lastError: unknown = null

        for (const variant of variants) {
          try {
            waMessageId = await attempt(variant)
            workingPhone = variant
            lastError = null
            break
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            if (!isRecipientNotAllowedError(message)) {
              throw err
            }
            lastError = err
            console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next…`)
          }
        }

        if (lastError) throw lastError
      } else {
        // Evolution API/Other providers don't need phone variants trial
        waMessageId = await attempt(sanitizedPhone)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown WhatsApp API error'
      console.error('WhatsApp API send failed:', message)
      return NextResponse.json(
        { error: `WhatsApp API error: ${message}` },
        { status: 502 }
      )
    }

    // Auto-correct phone number in DB if variant succeeded (only for Meta)
    if (workingPhone !== sanitizedPhone && config.providerType === 'meta') {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      )
      await db
        .update(contacts)
        .set({ phone: workingPhone })
        .where(eq(contacts.id, contact.id))
    }

    // Insert message into DB using Drizzle
    const [messageRecord] = await db
      .insert(messages)
      .values({
        conversationId: conversation_id,
        senderType: 'agent',
        contentType: message_type,
        contentText: content_text || null,
        mediaUrl: media_url || null,
        templateName: template_name || null,
        messageId: waMessageId,
        status: 'sent',
        replyToMessageId: reply_to_message_id || null,
      })
      .returning()

    if (!messageRecord) {
      return NextResponse.json(
        { error: 'Message sent to WhatsApp but failed to save to DB' },
        { status: 500 }
      )
    }

    // Update conversation using Drizzle
    await db
      .update(conversations)
      .set({
        lastMessageText: content_text || `[${message_type}]`,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation_id))

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
