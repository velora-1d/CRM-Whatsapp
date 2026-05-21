'use server'

import { db } from '@/db'
import {
  conversations,
  contacts,
  messages,
  profiles,
  whatsappConfig,
  messageTemplates,
  messageReactions,
  deals,
  contactNotes,
  contactTags,
  tags,
  pipelineStages,
} from '@/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { ConversationStatus, SenderType, ContentType, MessageStatus } from '@/types'

export async function getConversations() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Mengambil percakapan beserta kontak terkait
    const rows = await db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        contactId: conversations.contactId,
        status: conversations.status,
        assignedAgentId: conversations.assignedAgentId,
        lastMessageText: conversations.lastMessageText,
        lastMessageAt: conversations.lastMessageAt,
        unreadCount: conversations.unreadCount,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        contact: {
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          email: contacts.email,
          company: contacts.company,
          avatarUrl: contacts.avatarUrl,
        },
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.lastMessageAt))

    // Format output agar sesuai dengan interface Conversation di frontend (snake_case)
    const formatted = rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      contact_id: r.contactId,
      status: r.status as ConversationStatus,
      assigned_agent_id: r.assignedAgentId || undefined,
      last_message_text: r.lastMessageText || '',
      last_message_at: r.lastMessageAt ? r.lastMessageAt.toISOString() : '',
      unread_count: r.unreadCount,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      contact: r.contact
        ? {
            id: r.contact.id,
            user_id: r.userId,
            phone: r.contact.phone,
            name: r.contact.name || undefined,
            email: r.contact.email || undefined,
            company: r.contact.company || undefined,
            avatar_url: r.contact.avatarUrl || undefined,
            created_at: '',
            updated_at: '',
          }
        : undefined,
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching conversations:', error)
    return { error: error.message || 'Gagal mengambil percakapan' }
  }
}

export async function getMessages(conversationId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Pastikan percakapan milik user saat ini
    const convExists = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    })

    if (!convExists) {
      return { error: 'Percakapan tidak ditemukan atau bukan milik Anda' }
    }

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)

    const formatted = rows.map((r) => ({
      id: r.id,
      conversation_id: r.conversationId,
      sender_type: r.senderType as SenderType,
      sender_id: r.senderId || undefined,
      content_type: r.contentType as ContentType,
      content_text: r.contentText || undefined,
      media_url: r.mediaUrl || undefined,
      template_name: r.templateName || undefined,
      message_id: r.messageId || undefined,
      status: r.status as MessageStatus,
      reply_to_message_id: r.replyToMessageId || undefined,
      created_at: r.createdAt.toISOString(),
    }))

    // Reset unread count ketika pesan dibaca
    await db
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching messages:', error)
    return { error: error.message || 'Gagal mengambil pesan' }
  }
}

export async function updateConversationStatus(
  conversationId: string,
  status: 'open' | 'pending' | 'closed'
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .update(conversations)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error updating status:', error)
    return { error: error.message || 'Gagal memperbarui status' }
  }
}

export async function updateConversationAssignee(
  conversationId: string,
  assignedAgentId: string | null
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .update(conversations)
      .set({ assignedAgentId, updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error updating assignee:', error)
    return { error: error.message || 'Gagal memperbarui agen' }
  }
}

export async function getWhatsAppConnected() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.userId, userId),
    })

    return { success: true, connected: config?.status === 'connected' }
  } catch (error: any) {
    console.error('Error checking whatsapp connected status:', error)
    return { error: error.message || 'Gagal memeriksa status WhatsApp' }
  }
}

export async function getAgents() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    // Mengambil semua profiles sebagai agen
    const list = await db
      .select({
        id: profiles.id,
        userId: profiles.userId,
        fullName: profiles.fullName,
        email: profiles.email,
        avatarUrl: profiles.avatarUrl,
        role: profiles.role,
      })
      .from(profiles)

    const formatted = list.map((p) => ({
      id: p.id,
      user_id: p.userId,
      full_name: p.fullName,
      email: p.email,
      avatar_url: p.avatarUrl || undefined,
      role: p.role || 'user',
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching agents:', error)
    return { error: error.message || 'Gagal mengambil daftar agen' }
  }
}

export async function getWhatsAppTemplates(status?: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const conditions = [eq(messageTemplates.userId, userId)]
    if (status) {
      conditions.push(eq(messageTemplates.status, status))
    }

    const list = await db
      .select()
      .from(messageTemplates)
      .where(and(...conditions))
      .orderBy(desc(messageTemplates.createdAt))

    const formatted = list.map((t) => ({
      id: t.id,
      user_id: t.userId,
      name: t.name,
      category: t.category,
      language: t.language || 'en_US',
      header_type: t.headerType || undefined,
      header_content: t.headerContent || undefined,
      body_text: t.bodyText,
      footer_text: t.footerText || undefined,
      buttons: t.buttons || undefined,
      status: t.status || 'Draft',
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching templates:', error)
    return { error: error.message || 'Gagal mengambil templates' }
  }
}

export async function getMessageReactions(conversationId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    // Pastikan percakapan milik user saat ini
    const convExists = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    })

    if (!convExists) {
      return { error: 'Percakapan tidak ditemukan atau bukan milik Anda' }
    }

    const rows = await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.conversationId, conversationId))

    const formatted = rows.map((r) => ({
      id: r.id,
      message_id: r.messageId,
      conversation_id: r.conversationId,
      actor_type: r.actorType,
      actor_id: r.actorId || undefined,
      emoji: r.emoji,
      created_at: r.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching message reactions:', error)
    return { error: error.message || 'Gagal mengambil reaksi pesan' }
  }
}

export async function resetUnreadCount(conversationId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error resetting unread count:', error)
    return { error: error.message || 'Gagal mereset jumlah pesan belum dibaca' }
  }
}

export async function getContactDeals(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const rows = await db
      .select({
        id: deals.id,
        userId: deals.userId,
        pipelineId: deals.pipelineId,
        stageId: deals.stageId,
        contactId: deals.contactId,
        conversationId: deals.conversationId,
        title: deals.title,
        value: deals.value,
        currency: deals.currency,
        notes: deals.notes,
        expectedCloseDate: deals.expectedCloseDate,
        status: deals.status,
        assignedTo: deals.assignedTo,
        createdAt: deals.createdAt,
        updatedAt: deals.updatedAt,
        stage: {
          id: pipelineStages.id,
          pipelineId: pipelineStages.pipelineId,
          name: pipelineStages.name,
          position: pipelineStages.position,
          color: pipelineStages.color,
          createdAt: pipelineStages.createdAt,
        }
      })
      .from(deals)
      .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(eq(deals.contactId, contactId))
      .orderBy(desc(deals.createdAt))

    const formatted = rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      pipeline_id: r.pipelineId,
      stage_id: r.stageId,
      contact_id: r.contactId,
      conversation_id: r.conversationId || undefined,
      assigned_to: r.assignedTo || undefined,
      title: r.title,
      value: Number(r.value),
      currency: r.currency || undefined,
      notes: r.notes || undefined,
      expected_close_date: r.expectedCloseDate || undefined,
      status: r.status as any,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      stage: r.stage ? {
        id: r.stage.id,
        pipeline_id: r.stage.pipelineId,
        name: r.stage.name,
        position: r.stage.position,
        color: r.stage.color,
        created_at: r.stage.createdAt.toISOString(),
      } : undefined
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contact deals:', error)
    return { error: error.message || 'Gagal mengambil data deal' }
  }
}

export async function getContactNotes(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const rows = await db
      .select()
      .from(contactNotes)
      .where(eq(contactNotes.contactId, contactId))
      .orderBy(desc(contactNotes.createdAt))

    const formatted = rows.map((r) => ({
      id: r.id,
      contact_id: r.contactId,
      user_id: r.userId,
      note_text: r.noteText,
      created_at: r.createdAt.toISOString(),
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contact notes:', error)
    return { error: error.message || 'Gagal mengambil data catatan' }
  }
}

export async function addContactNote(contactId: string, noteText: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const [inserted] = await db
      .insert(contactNotes)
      .values({
        contactId,
        userId,
        noteText,
      })
      .returning()

    const formatted = {
      id: inserted.id,
      contact_id: inserted.contactId,
      user_id: inserted.userId,
      note_text: inserted.noteText,
      created_at: inserted.createdAt.toISOString(),
    }

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error adding contact note:', error)
    return { error: error.message || 'Gagal menambahkan catatan' }
  }
}

export async function getContactTags(contactId: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const rows = await db
      .select({
        id: contactTags.id,
        tagId: contactTags.tagId,
        tag: {
          id: tags.id,
          userId: tags.userId,
          name: tags.name,
          color: tags.color,
          createdAt: tags.createdAt,
        }
      })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(eq(contactTags.contactId, contactId))

    const formatted = rows.map((r) => ({
      id: r.tag.id,
      user_id: r.tag.userId,
      name: r.tag.name,
      color: r.tag.color,
      created_at: r.tag.createdAt.toISOString(),
      contact_tag_id: r.id,
    }))

    return { success: true, data: formatted }
  } catch (error: any) {
    console.error('Error fetching contact tags:', error)
    return { error: error.message || 'Gagal mengambil data tag' }
  }
}

export async function createWhatsAppTemplate(payload: {
  name: string
  category: string
  language: string
  body_text: string
  header_type?: string | null
  footer_text?: string | null
}) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const [inserted] = await db
      .insert(messageTemplates)
      .values({
        userId,
        name: payload.name,
        category: payload.category,
        language: payload.language,
        bodyText: payload.body_text,
        headerType: payload.header_type || null,
        footerText: payload.footer_text || null,
        status: 'Draft',
      })
      .returning()

    return { success: true, data: inserted }
  } catch (error: any) {
    console.error('Error creating template:', error)
    return { error: error.message || 'Gagal membuat template' }
  }
}

export async function deleteWhatsAppTemplate(id: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    await db
      .delete(messageTemplates)
      .where(and(eq(messageTemplates.id, id), eq(messageTemplates.userId, userId)))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting template:', error)
    return { error: error.message || 'Gagal menghapus template' }
  }
}

export async function getWhatsAppConfig() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.userId, userId),
    })

    if (!config) {
      return { success: true, data: null }
    }

    return {
      success: true,
      data: {
        id: config.id,
        user_id: config.userId,
        provider_type: config.providerType,
        phone_number_id: config.phoneNumberId || '',
        waba_id: config.wabaId || '',
        verify_token: config.verifyToken ? 'EXISTING' : '',
        evolution_instance_name: config.evolutionInstanceName || '',
        status: config.status || 'disconnected',
        created_at: config.createdAt?.toISOString(),
        updated_at: config.updatedAt?.toISOString(),
      }
    }
  } catch (error: any) {
    console.error('Error fetching whatsapp config:', error)
    return { error: error.message || 'Gagal mengambil konfigurasi WhatsApp' }
  }
}



