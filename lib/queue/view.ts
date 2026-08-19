import { HEATING_WINDOW_MS } from "./engine";
import type { QueueState, QueueView } from "./types";

const PER_PERSON_WAIT_MS = 5 * 60 * 1000;

// While the active entry is still confirming, heating hasn't started yet, so
// its remaining time is the rest of the confirm window plus a full heating
// turn - not just the confirm deadline (that would ignore the heating time
// entirely) and not a flat estimate either (that would make the number jump
// upward right when they confirm and the real heating deadline kicks in).
// This way the estimate ticks down continuously across the phase change.
function remainingActiveMs(state: QueueState, now: number): number {
  if (!state.active) {
    return 0;
  }
  const remainingInPhase = Math.max(0, state.active.deadline - now);
  if (state.active.phase === "confirming") {
    return remainingInPhase + HEATING_WINDOW_MS;
  }
  return remainingInPhase;
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
