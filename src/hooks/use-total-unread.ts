"use client";

import { useEffect, useState } from "react";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Polled periodically.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timerId: NodeJS.Timeout | null = null;

    const fetchUnread = async () => {
      try {
        const res = await fetch("/api/conversations/unread");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && typeof data.total === "number") {
            setTotal(data.total);
          }
        }
      } catch (err) {
        console.error("Failed to fetch unread count:", err);
      } finally {
        if (!cancelled) {
          timerId = setTimeout(fetchUnread, 8000); // Poll setiap 8 detik
        }
      }
    };

    fetchUnread();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  return total;
}

