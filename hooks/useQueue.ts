"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearIdentity, getIdentity, setIdentity } from "../lib/identity";
import type { PushSubscriptionRecord, QueueView } from "../lib/queue/types";

const POLL_INTERVAL_MS = 2000;
// Retry delay after the Nth consecutive transport failure (1-indexed), capped at the last entry.
const BACKOFF_SCHEDULE_MS = [2000, 4000, 8000, 16000, 30000];
const DOWN_THRESHOLD = 4;

/**
 * A response the server actually answered with (a domain rejection: 400/403/404/409/429/503),
 * as opposed to a transport failure (network error, timeout, 5xx with no JSON body) - callers
 * distinguish the two via `instanceof QueueActionError`. Domain errors prove the server is
 * reachable, so they never count toward the network-health signal below.
 */
export class QueueActionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "QueueActionError";
  }
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function backoffDelayForFailureCount(failures: number): number {
  const index = Math.min(Math.max(failures - 1, 0), BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index];
}

export interface UseQueueActions {
  join: (name: string, subscription?: PushSubscriptionRecord) => Promise<void>;
  leave: () => Promise<void>;
  confirmTurn: () => Promise<void>;
  finish: () => Promise<void>;
}

export type ConnectionState = "ok" | "down";

export interface UseQueueResult {
  view: QueueView | null;
  /** Best estimate of the server's current clock, using the offset from the last successful poll. */
  now: () => number;
  actions: UseQueueActions;
  connection: ConnectionState;
  /** Forces an immediate poll attempt, bypassing any remaining backoff wait. */
  retryNow: () => void;
}

export function useQueue(): UseQueueResult {
  const [view, setView] = useState<QueueView | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("ok");
  const offsetRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const retryRef = useRef<() => void>(() => {});

  const noteSuccess = useCallback(() => {
    consecutiveFailuresRef.current = 0;
    setConnection("ok");
  }, []);

  const noteTransportFailure = useCallback(() => {
    consecutiveFailuresRef.current += 1;
    if (consecutiveFailuresRef.current >= DOWN_THRESHOLD) {
      setConnection("down");
    }
  }, []);

  // GET has no domain-rejection shape (it's a read) - any !response.ok, or the
  // fetch itself throwing, is treated as a transport failure.
  const poll = useCallback(async () => {
    const identity = getIdentity();
    const url = identity ? `/api/queue?id=${encodeURIComponent(identity.id)}` : "/api/queue";
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      noteTransportFailure();
      throw error;
    }
    if (!response.ok) {
      noteTransportFailure();
      throw new Error(`GET /api/queue failed with status ${response.status}`);
    }
    const data: QueueView = await response.json();
    offsetRef.current = data.serverTime - Date.now();
    setView(data);
    noteSuccess();
  }, [noteSuccess, noteTransportFailure]);

  const callQueueApi = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      let response: Response;
      try {
        response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (error) {
        noteTransportFailure();
        throw error;
      }
      const data = await parseJsonBody(response);
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : "Erro desconhecido";
        const code = typeof data.code === "string" ? data.code : undefined;
        throw new QueueActionError(message, response.status, code);
      }
      noteSuccess();
      return data;
    },
    [noteSuccess, noteTransportFailure],
  );

  // Self-rescheduling timeout (not setInterval) so the delay between attempts
  // can vary with the backoff schedule instead of staying fixed.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runTick = () => {
      timer = null;
      poll()
        .catch(() => {})
        .finally(() => {
          if (cancelled || document.hidden) {
            return;
          }
          const failures = consecutiveFailuresRef.current;
          const delay = failures > 0 ? backoffDelayForFailureCount(failures) : POLL_INTERVAL_MS;
          timer = setTimeout(runTick, delay);
        });
    };

    retryRef.current = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      runTick();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      } else if (timer === null) {
        runTick();
      }
    };

    if (!document.hidden) {
      runTick();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  const retryNow = useCallback(() => {
    retryRef.current();
  }, []);

  const now = useCallback(() => Date.now() + offsetRef.current, []);

  const join = useCallback(
    async (name: string, subscription?: PushSubscriptionRecord) => {
      const body: Record<string, unknown> = { name };
      if (subscription) {
        body.subscription = subscription;
      }
      const data = await callQueueApi("/api/queue/join", body);
      setIdentity({
        id: data.id as string,
        name,
        sessionToken: data.sessionToken as string,
      });
      await poll().catch(() => {});
    },
    [callQueueApi, poll],
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
        await callQueueApi(path, { id: identity.id, sessionToken: identity.sessionToken });
      } catch (error) {
        if (error instanceof QueueActionError && (error.status === 403 || error.status === 404)) {
          clearIdentity();
        }
        throw error;
      }
      await poll().catch(() => {});
    },
    [callQueueApi, poll],
  );

  const leave = useCallback(() => withIdentityAction("/api/queue/leave"), [withIdentityAction]);
  const confirmTurn = useCallback(
    () => withIdentityAction("/api/queue/confirm-turn"),
    [withIdentityAction],
  );
  const finish = useCallback(() => withIdentityAction("/api/queue/finish"), [withIdentityAction]);

  return {
    view,
    now,
    actions: { join, leave, confirmTurn, finish },
    connection,
    retryNow,
  };
}
