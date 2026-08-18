import {
  DuplicateNameError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  WrongPhaseError,
  type QueueState,
} from "./types";

const CONFIRM_WINDOW_MS = 20_000;

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

export function reapExpired(state: QueueState, now: number): QueueState {
  if (!state.active || now <= state.active.deadline) {
    return state;
  }

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
    },
    waiting: rest,
  };
}

export interface JoinInput {
  name: string;
  id: string;
  sessionTokenHash: string;
}

export function applyJoin(state: QueueState, input: JoinInput, now: number): QueueState {
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
      },
    };
  }

  return {
    ...state,
    waiting: [
      ...state.waiting,
      { id: input.id, name: trimmedName, sessionTokenHash: input.sessionTokenHash, joinedAt: now },
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
