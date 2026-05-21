import { NextResponse } from 'next/server'
import { db } from '@/db'
import { conversations, messages, contacts, messageReactions } from '@/db/schema'
import { eq, and, gte } from 'drizzle-orm'
import { auth } from '@/auth'

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const { searchParams } = new URL(request.url)
    const sinceStr = searchParams.get('since')
    if (!sinceStr) {
      return NextResponse.json({ error: 'since parameter is required' }, { status: 400 })
    }
    const since = new Date(sinceStr)

    // 1. Ambil conversations yang diperbarui sejak 'since'
    const updatedConvs = await db
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
      .where(and(eq(conversations.userId, userId), gte(conversations.updatedAt, since)))

    const formattedConvs = updatedConvs.map((r) => ({
      id: r.id,
      user_id: r.userId,
      contact_id: r.contactId,
      status: r.status,
      assigned_agent_id: r.assignedAgentId || undefined,
      last_message_text: r.lastMessageText || '',
      last_message_at: r.lastMessageAt ? r.lastMessageAt.toISOString() : '',
      unread_count: r.unreadCount,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      contact: r.contact
        ? {
            id: r.contact.id,
            name: r.contact.name,
            phone: r.contact.phone,
            email: r.contact.email,
            company: r.contact.company,
            avatar_url: r.contact.avatarUrl,
          }
        : null,
    }))

    // 2. Ambil messages yang dibuat sejak 'since' (untuk percakapan milik user saat ini)
    const newMessages = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderType: messages.senderType,
        senderId: messages.senderId,
        contentType: messages.contentType,
        contentText: messages.contentText,
        mediaUrl: messages.mediaUrl,
        templateName: messages.templateName,
        messageId: messages.messageId,
        status: messages.status,
        replyToMessageId: messages.replyToMessageId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.userId, userId), gte(messages.createdAt, since)))

    const formattedMessages = newMessages.map((r) => ({
      id: r.id,
      conversation_id: r.conversationId,
      sender_type: r.senderType,
      sender_id: r.senderId || undefined,
      content_type: r.contentType,
      content_text: r.contentText || undefined,
      media_url: r.mediaUrl || undefined,
      template_name: r.templateName || undefined,
      message_id: r.messageId || undefined,
      status: r.status,
      reply_to_message_id: r.replyToMessageId || undefined,
      created_at: r.createdAt.toISOString(),
    }))

    // 3. Ambil reactions yang dibuat sejak 'since'
    const newReactions = await db
      .select({
        id: messageReactions.id,
        messageId: messageReactions.messageId,
        conversationId: messageReactions.conversationId,
        actorType: messageReactions.actorType,
        actorId: messageReactions.actorId,
        emoji: messageReactions.emoji,
        createdAt: messageReactions.createdAt,
      })
      .from(messageReactions)
      .innerJoin(conversations, eq(messageReactions.conversationId, conversations.id))
      .where(and(eq(conversations.userId, userId), gte(messageReactions.createdAt, since)))

    const formattedReactions = newReactions.map((r) => ({
      id: r.id,
      message_id: r.messageId,
      conversation_id: r.conversationId,
      actor_type: r.actorType,
      actor_id: r.actorId || undefined,
      emoji: r.emoji,
      created_at: r.createdAt.toISOString(),
    }))

    return NextResponse.json({
      conversations: formattedConvs,
      messages: formattedMessages,
      reactions: formattedReactions,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Error in polling route:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
