"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearIdentity, getIdentity, setIdentity } from "../lib/identity";
import type { QueueView } from "../lib/queue/types";

const POLL_INTERVAL_MS = 2000;

/**
 * A response the server actually answered with (a domain rejection: 400/403/404/409/429/503),
 * as opposed to a transport failure (network error, timeout, 5xx with no JSON body) - callers
 * distinguish the two via `instanceof QueueActionError`.
 */
export class QueueActionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "QueueActionError";
  }
}

async function callQueueApi(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: Record<string, unknown> = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof data.error === "string" ? data.error : "Erro desconhecido";
    throw new QueueActionError(message, response.status);
  }
  return data;
}

export interface UseQueueActions {
  join: (name: string) => Promise<void>;
  leave: () => Promise<void>;
  confirmTurn: () => Promise<void>;
  finish: () => Promise<void>;
}

export interface UseQueueResult {
  view: QueueView | null;
  /** Best estimate of the server's current clock, using the offset from the last successful poll. */
  now: () => number;
  actions: UseQueueActions;
}

export function useQueue(): UseQueueResult {
  const [view, setView] = useState<QueueView | null>(null);
  const offsetRef = useRef(0);

  const poll = useCallback(async () => {
    const identity = getIdentity();
    const url = identity
      ? `/api/queue?id=${encodeURIComponent(identity.id)}`
      : "/api/queue";
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

  const join = useCallback(
    async (name: string) => {
      const data = await callQueueApi("/api/queue/join", { name });
      setIdentity({
        id: data.id as string,
        name,
        sessionToken: data.sessionToken as string,
      });
      await poll().catch(() => {});
    },
    [poll],
  );

  // 403 (wrong token) and 404 (entry already gone) mean the stored identity no
  // longer refers to anything real - clear it (design.md's Error Handling
  // Strategy). 409 (wrong phase) means the entry is still theirs, just out of
  // sync with a stale UI - the next poll resyncs it, identity stays intact.
  const withIdentityAction = useCallback(
    async (path: string) => {
      const identity = getIdentity();
      if (!identity) {
        return;
      }
      try {
        await callQueueApi(path, {
          id: identity.id,
          sessionToken: identity.sessionToken,
        });
      } catch (error) {
        if (
          error instanceof QueueActionError &&
          (error.status === 403 || error.status === 404)
        ) {
          clearIdentity();
        }
        throw error;
      }
      await poll().catch(() => {});
    },
    [poll],
  );

  const leave = useCallback(
    () => withIdentityAction("/api/queue/leave"),
    [withIdentityAction],
  );
  const confirmTurn = useCallback(
    () => withIdentityAction("/api/queue/confirm-turn"),
    [withIdentityAction],
  );
  const finish = useCallback(
    () => withIdentityAction("/api/queue/finish"),
    [withIdentityAction],
  );

  return { view, now, actions: { join, leave, confirmTurn, finish } };
}
