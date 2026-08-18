"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentity } from "../lib/identity";
import type { QueueView } from "../lib/queue/types";

const POLL_INTERVAL_MS = 2000;

export interface UseQueueResult {
  view: QueueView | null;
  /** Best estimate of the server's current clock, using the offset from the last successful poll. */
  now: () => number;
}

export function useQueue(): UseQueueResult {
  const [view, setView] = useState<QueueView | null>(null);
  const offsetRef = useRef(0);

  const poll = useCallback(async () => {
    const identity = getIdentity();
    const url = identity ? `/api/queue?id=${encodeURIComponent(identity.id)}` : "/api/queue";
    const response = await fetch(url);
    const data: QueueView = await response.json();
    offsetRef.current = data.serverTime - Date.now();
    setView(data);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      poll().catch(() => {});
    };

    const start = () => {
      if (timer !== null) {
        return;
      }
      tick();
      timer = setInterval(tick, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (!document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  const now = useCallback(() => Date.now() + offsetRef.current, []);

  return { view, now };
}
