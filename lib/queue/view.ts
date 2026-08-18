import type { QueueState, QueueView } from "./types";

const PER_PERSON_WAIT_MS = 5 * 60 * 1000;

function remainingActiveMs(state: QueueState, now: number): number {
  if (!state.active) {
    return 0;
  }
  return Math.max(0, state.active.deadline - now);
}

export function buildView(state: QueueState, viewerId: string | null, now: number): QueueView {
  const queueCount = state.waiting.length + (state.active ? 1 : 0);
  const baseWaitMs = remainingActiveMs(state, now);

  if (viewerId) {
    const waitingIndex = state.waiting.findIndex((entry) => entry.id === viewerId);

    if (waitingIndex !== -1) {
      const position = waitingIndex + 1;
      return {
        queueCount,
        estimatedWaitMs: baseWaitMs + waitingIndex * PER_PERSON_WAIT_MS,
        namesAhead: state.waiting.slice(0, waitingIndex).map((entry) => entry.name),
        self: {
          id: viewerId,
          phase: "waiting",
          position,
          estimatedWaitMs: baseWaitMs + waitingIndex * PER_PERSON_WAIT_MS,
        },
        serverTime: now,
      };
    }

    if (state.active?.id === viewerId) {
      return {
        queueCount,
        estimatedWaitMs: baseWaitMs,
        namesAhead: [],
        self: {
          id: viewerId,
          phase: state.active.phase,
          deadline: state.active.deadline,
        },
        serverTime: now,
      };
    }
  }

  return {
    queueCount,
    estimatedWaitMs: baseWaitMs + state.waiting.length * PER_PERSON_WAIT_MS,
    namesAhead: [],
    self: null,
    serverTime: now,
  };
}
