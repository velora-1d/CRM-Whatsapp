import { db } from '@/db'
import { contacts, whatsappConfig, messages, conversations } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { WhatsAppProviderFactory } from '@/lib/whatsapp/factory'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'

// ------------------------------------------------------------
// Automation-side WhatsApp sender.
//
// Mengirim pesan secara dinamis menggunakan provider aktif (Meta atau Evolution).
// Menggunakan Drizzle ORM dan model user_id terisolasi.
// ------------------------------------------------------------

interface SendTextArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaProvider({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaProvider({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaProvider(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  // 1. Cari kontak berdasarkan user_id (isolasi tenant)
  const contact = await db.query.contacts.findFirst({
    where: and(
      eq(contacts.id, input.contactId),
      eq(contacts.userId, input.userId)
    )
  })

  if (!contact || !contact.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // 2. Dapatkan WhatsAppProvider dinamis (Meta atau Evolution)
  const provider = await WhatsAppProviderFactory.getProvider(input.userId)
  if (!provider) {
    throw new Error('WhatsApp not configured or failed to initialize for this account')
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await provider.sendTemplateMessage(
        phone,
        input.templateName,
        input.language || 'en_US',
        input.params
      )
      return r.messageId
    }
    const r = await provider.sendTextMessage(phone, input.text)
    return r.messageId
  }

  // Coba variasi nomor hp (misal sandbox / trunk 0)
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  // Update nomor kontak di db jika variasi yang berhasil berbeda
  if (workingPhone !== sanitized) {
    await db
      .update(contacts)
      .set({ phone: workingPhone, updatedAt: new Date() })
      .where(eq(contacts.id, contact.id))
  }

  // Persist pesan ke db
  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  try {
    await db.insert(messages).values({
      conversationId: input.conversationId,
      senderType: 'bot',
      contentType: content_type,
      contentText: content_text,
      templateName: template_name,
      messageId: waMessageId,
      status: 'sent',
    })
  } catch (msgErr: any) {
    throw new Error(`sent to WA but DB insert failed: ${msgErr?.message || msgErr}`)
  }

  // Update conversation
  await db
    .update(conversations)
    .set({
      lastMessageText:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, input.conversationId))

  return { whatsapp_message_id: waMessageId }
}

