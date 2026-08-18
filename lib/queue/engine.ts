import type { QueueState } from "./types";

const CONFIRM_WINDOW_MS = 20_000;

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
