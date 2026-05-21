import { NextResponse } from 'next/server';
import { db } from '@/db';
import { conversations, messages, messageReactions, whatsappConfig } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { WhatsAppProviderFactory } from '@/lib/whatsapp/factory';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Sends the reaction to WhatsApp provider and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions are handled by the
 * webhook — this route only writes `actor_type = 'agent'` rows.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    // Resolve target message using Drizzle
    const targetMessage = await db.query.messages.findFirst({
      where: eq(messages.id, message_id)
    });

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.messageId) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    // Resolve conversation and verify ownership
    const conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, targetMessage.conversationId),
        eq(conversations.userId, userId)
      ),
      with: {
        contact: true
      }
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const contact = conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    // Get active provider from factory
    const provider = await WhatsAppProviderFactory.getProvider(userId);
    if (!provider) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    try {
      await provider.sendReactionMessage(
        sanitizedPhone,
        targetMessage.messageId,
        emoji
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown WhatsApp API error';
      console.error('[whatsapp/react] sendReactionMessage failed:', message);
      return NextResponse.json(
        { error: `WhatsApp API error: ${message}` },
        { status: 502 },
      );
    }

    // Mirror into DB. Empty emoji = removal.
    if (emoji === '') {
      await db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, targetMessage.id),
            eq(messageReactions.actorType, 'agent'),
            eq(messageReactions.actorId, userId)
          )
        );
    } else {
      // Upsert using Drizzle
      await db
        .insert(messageReactions)
        .values({
          messageId: targetMessage.id,
          conversationId: targetMessage.conversationId,
          actorType: 'agent',
          actorId: userId,
          emoji,
        })
        .onConflictDoUpdate({
          target: [messageReactions.messageId, messageReactions.actorType, messageReactions.actorId],
          set: { emoji },
        });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 },
    );
  }
}
