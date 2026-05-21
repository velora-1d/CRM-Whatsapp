"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Message, Conversation, MessageReaction } from "@/types";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName?: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  onReactionEvent?: (event: RealtimeEvent<MessageReaction>) => void;
  enabled?: boolean;
}

export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  onReactionEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const sinceRef = useRef<string>(new Date().toISOString());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const onReactionRef = useRef(onReactionEvent);

  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
    onReactionRef.current = onReactionEvent;
  });

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    setIsConnected(true);

    const poll = async () => {
      try {
        const res = await fetch(`/api/realtime/poll?since=${encodeURIComponent(sinceRef.current)}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        
        // Update timestamp checker
        if (data.timestamp) {
          sinceRef.current = data.timestamp;
        }

        // Trigger events for conversations
        if (data.conversations && data.conversations.length > 0) {
          for (const conv of data.conversations) {
            // Karena ini polling, kita anggap sebagai UPDATE/INSERT
            // Untuk menyederhanakan frontend, kita trigger UPDATE
            onConversationRef.current?.({
              eventType: "UPDATE",
              new: conv,
              old: {},
            });
          }
        }

        // Trigger events for messages
        if (data.messages && data.messages.length > 0) {
          for (const msg of data.messages) {
            onMessageRef.current?.({
              eventType: "INSERT",
              new: msg,
              old: {},
            });
          }
        }

        // Trigger events for reactions
        if (data.reactions && data.reactions.length > 0) {
          for (const rx of data.reactions) {
            onReactionRef.current?.({
              eventType: "INSERT",
              new: rx,
              old: {},
            });
          }
        }
      } catch (err) {
        console.error("[useRealtime] Polling error:", err);
      } finally {
        // Schedule next poll
        if (enabled) {
          timerRef.current = setTimeout(poll, 3000);
        }
      }
    };

    // Mulai polling pertama setelah delay singkat
    timerRef.current = setTimeout(poll, 1500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setIsConnected(false);
    };
  }, [enabled]);

  const unsubscribe = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setIsConnected(false);
  }, []);

  return { isConnected, unsubscribe };
}
