import {
  DuplicateNameError,
  ForbiddenError,
  NotFoundError,
  QueueFullError,
  ValidationError,
  WrongPhaseError,
  type HeatingCheckpoint,
  type PushSubscriptionRecord,
  type QueueState,
} from "./types";

const CONFIRM_WINDOW_MS = 60_000;

export const MAX_QUEUE_SEATS = 100;

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function isNameTaken(state: QueueState, trimmedName: string): boolean {
  const target = normalizedName(trimmedName);
  if (state.active && normalizedName(state.active.name) === target) {
    return true;
  }
  return state.waiting.some((entry) => normalizedName(entry.name) === target);
}

function promoteNextToActive(state: QueueState, now: number): QueueState {
  const [next, ...rest] = state.waiting;

  if (!next) {
    return { ...state, active: null, waiting: [] };
  }

  return {
    ...state,
    active: {
      id: next.id,
      name: next.name,
      sessionTokenHash: next.sessionTokenHash,
      phase: "confirming",
      phaseStartedAt: now,
      deadline: now + CONFIRM_WINDOW_MS,
      // SPEC_DEVIATION: carrying the waiting entry's pushSubscription through
      // to the promoted active entry wasn't in T2's stated scope, but T9's
      // Done-when requires a reap/finish-heating promotion to produce a
      // turn-ready job for the promoted entry's subscription - which is only
      // possible if promoteNextToActive doesn't silently drop it here.
      ...(next.pushSubscription ? { pushSubscription: next.pushSubscription } : {}),
    },
    waiting: rest,
  };
}

export function reapExpired(state: QueueState, now: number): QueueState {
  if (!state.active || now <= state.active.deadline) {
    return state;
  }

  return promoteNextToActive(state, now);
}

export interface JoinInput {
  name: string;
  id: string;
  sessionTokenHash: string;
  pushSubscription?: PushSubscriptionRecord;
}

export function applyJoin(state: QueueState, input: JoinInput, now: number): QueueState {
  const currentSeatCount = (state.active ? 1 : 0) + state.waiting.length;
  if (currentSeatCount >= MAX_QUEUE_SEATS) {
    throw new QueueFullError();
  }

  const trimmedName = input.name.trim();

  if (!trimmedName) {
    throw new ValidationError("Display name must not be empty");
  }

  if (isNameTaken(state, trimmedName)) {
    throw new DuplicateNameError(trimmedName);
  }

  if (!state.active && state.waiting.length === 0) {
    return {
      ...state,
      active: {
        id: input.id,
        name: trimmedName,
        sessionTokenHash: input.sessionTokenHash,
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + CONFIRM_WINDOW_MS,
        ...(input.pushSubscription ? { pushSubscription: input.pushSubscription } : {}),
      },
    };
  }

  return {
    ...state,
    waiting: [
      ...state.waiting,
      {
        id: input.id,
        name: trimmedName,
        sessionTokenHash: input.sessionTokenHash,
        joinedAt: now,
        ...(input.pushSubscription ? { pushSubscription: input.pushSubscription } : {}),
      },
    ],
  };
}

export interface IdentifiedInput {
  id: string;
  sessionTokenHash: string;
}

export function applyLeave(state: QueueState, input: IdentifiedInput): QueueState {
  if (state.active?.id === input.id) {
    throw new WrongPhaseError(
      "Cannot leave an active turn - only finishing it is supported",
    );
  }

  const target = state.waiting.find((entry) => entry.id === input.id);

  if (!target) {
    throw new NotFoundError(input.id);
  }

  if (target.sessionTokenHash !== input.sessionTokenHash) {
    throw new ForbiddenError(input.id);
  }

  return {
    ...state,
    waiting: state.waiting.filter((entry) => entry.id !== input.id),
  };
}

export const HEATING_NOMINAL_MS = 300_000; // 5:00 nominal heating time
export const HEATING_URGENCY_MS = 30_000; // grace window after the nominal time, visually flagged as urgent
export const HEATING_WINDOW_MS = HEATING_NOMINAL_MS + HEATING_URGENCY_MS; // 5:30 total auto-end deadline

export function applyConfirmTurn(
  state: QueueState,
  input: IdentifiedInput,
  now: number,
): QueueState {
  if (state.active?.id !== input.id) {
    throw new NotFoundError(input.id);
  }

  if (state.active.phase !== "confirming") {
    throw new WrongPhaseError(
      `Cannot confirm turn: active entry is in "${state.active.phase}" phase, not "confirming"`,
    );
  }

  if (state.active.sessionTokenHash !== input.sessionTokenHash) {
    throw new ForbiddenError(input.id);
  }

  return {
    ...state,
    active: {
      ...state.active,
      phase: "heating",
      phaseStartedAt: now,
      deadline: now + HEATING_WINDOW_MS,
    },
  };
}

export function applyFinishHeating(
  state: QueueState,
  input: IdentifiedInput,
  now: number,
): QueueState {
  if (state.active?.id !== input.id) {
    throw new NotFoundError(input.id);
  }

  if (state.active.phase !== "heating") {
    throw new WrongPhaseError(
      `Cannot finish: active entry is in "${state.active.phase}" phase, not "heating"`,
    );
  }

  if (state.active.sessionTokenHash !== input.sessionTokenHash) {
    throw new ForbiddenError(input.id);
  }

  return promoteNextToActive(state, now);
}

const CONFIRM_FINISH_ENDING_MS = HEATING_WINDOW_MS - 10_000; // 10s before the 5:30 auto-end

export function applyHeatingCheckpoints(
  state: QueueState,
  now: number,
): { state: QueueState; fired: HeatingCheckpoint[] } {
  if (!state.active || state.active.phase !== "heating") {
    return { state, fired: [] };
  }

  const elapsed = now - state.active.phaseStartedAt;
  const alreadyFired = state.active.notifiedCheckpoints ?? [];
  const fired: HeatingCheckpoint[] = [];

  if (elapsed >= HEATING_NOMINAL_MS && !alreadyFired.includes("heating-ended")) {
    fired.push("heating-ended");
  }
  if (elapsed >= CONFIRM_FINISH_ENDING_MS && !alreadyFired.includes("confirm-finish-ending")) {
    fired.push("confirm-finish-ending");
  }

  if (fired.length === 0) {
    return { state, fired: [] };
  }

  return {
    state: {
      ...state,
      active: {
        ...state.active,
        notifiedCheckpoints: [...alreadyFired, ...fired],
      },
    },
    fired,
  };
}

export function applyAttachPushSubscription(
  state: QueueState,
  input: IdentifiedInput & { subscription: PushSubscriptionRecord },
): QueueState {
  if (state.active?.id === input.id) {
    if (state.active.sessionTokenHash !== input.sessionTokenHash) {
      throw new ForbiddenError(input.id);
    }

    return {
      ...state,
      active: { ...state.active, pushSubscription: input.subscription },
    };
  }

  const target = state.waiting.find((entry) => entry.id === input.id);

  if (!target) {
    throw new NotFoundError(input.id);
  }

  if (target.sessionTokenHash !== input.sessionTokenHash) {
    throw new ForbiddenError(input.id);
  }

  return {
    ...state,
    waiting: state.waiting.map((entry) =>
      entry.id === input.id ? { ...entry, pushSubscription: input.subscription } : entry,
    ),
  };
}

function withoutPushSubscription<T extends { pushSubscription?: PushSubscriptionRecord }>(
  entry: T,
): T {
  const copy = { ...entry };
  delete copy.pushSubscription;
  return copy;
}

export function applyPruneSubscriptions(
  state: QueueState,
  invalidEndpoints: string[],
): QueueState {
  if (invalidEndpoints.length === 0) {
    return state;
  }

  const invalid = new Set(invalidEndpoints);

  const active =
    state.active?.pushSubscription && invalid.has(state.active.pushSubscription.endpoint)
      ? withoutPushSubscription(state.active)
      : state.active;

  const waiting = state.waiting.map((entry) =>
    entry.pushSubscription && invalid.has(entry.pushSubscription.endpoint)
      ? withoutPushSubscription(entry)
      : entry,
  );

  const seatWaitlist = state.seatWaitlist.filter(
    (entry) => !invalid.has(entry.subscription.endpoint),
  );

  return { ...state, active, waiting, seatWaitlist };
}
