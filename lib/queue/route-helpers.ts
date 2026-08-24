import { verifyToken } from "./session";
import { getState } from "./store";
import { QueueBusyError, type QueueState } from "./types";

export interface EntryLookup {
  id: string;
  sessionTokenHash: string;
}

export type AuthResult = { ok: true; entry: EntryLookup } | { ok: false; status: 404 | 403 };

function findEntry(state: QueueState, id: string): EntryLookup | null {
  if (state.active?.id === id) {
    return { id: state.active.id, sessionTokenHash: state.active.sessionTokenHash };
  }
  const waiting = state.waiting.find((entry) => entry.id === id);
  return waiting ? { id: waiting.id, sessionTokenHash: waiting.sessionTokenHash } : null;
}

// Shared "auth gate" for leave/confirm-turn/finish: looks up the entry by id
// (404 if it doesn't exist) and verifies the caller's raw sessionToken against
// its stored hash via constant-time comparison (403 if it doesn't match) -
// BEFORE any mutation is attempted. Each route still handles its own
// phase-specific domain errors (e.g. WrongPhaseError) from the mutation itself.
export async function authorizeEntry(id: string, sessionToken: string): Promise<AuthResult> {
  const state = await getState();
  const entry = findEntry(state, id);

  if (!entry) {
    return { ok: false, status: 404 };
  }

  if (!verifyToken(sessionToken, entry.sessionTokenHash)) {
    return { ok: false, status: 403 };
  }

  return { ok: true, entry };
}

// Shared response for QueueBusyError (withQueueMutation exhausted its CAS
// retries) - every route that mutates queue state should map this to a 503
// instead of letting it fall through as an unhandled 500.
export function queueBusyResponse(): Response {
  return Response.json(
    { error: "A fila está ocupada no momento. Tente novamente.", code: "QUEUE_BUSY" },
    { status: 503 },
  );
}

export { QueueBusyError };
