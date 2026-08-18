import { describe, expect, it } from "vitest";
import { applyConfirmTurn, applyJoin, applyLeave, reapExpired } from "../engine";
import {
  DuplicateNameError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  WrongPhaseError,
  type QueueState,
} from "../types";

const CONFIRM_WINDOW_MS = 20_000;
const HEATING_WINDOW_MS = 315_000;

function emptyState(): QueueState {
  return { version: 1, active: null, waiting: [] };
}

describe("reapExpired", () => {
  it("returns the state unchanged when there is no active entry", () => {
    const state = emptyState();
    const result = reapExpired(state, Date.now());
    expect(result).toEqual(state);
  });

  it("returns the state unchanged when the active entry has not yet passed its deadline", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now - 1000,
        deadline: now + 1000,
      },
      waiting: [],
    };
    const result = reapExpired(state, now);
    expect(result).toEqual(state);
  });

  it("drops an expired confirming active entry and promotes the next waiting entry with a fresh 20s deadline (QUEUE-11)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now - 21_000,
        deadline: now - 1,
      },
      waiting: [
        { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 },
        { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: now - 100 },
      ],
    };
    const result = reapExpired(state, now);

    expect(result.active).toEqual({
      id: "b1",
      name: "Bruno",
      sessionTokenHash: "hash-b1",
      phase: "confirming",
      phaseStartedAt: now,
      deadline: now + CONFIRM_WINDOW_MS,
    });
    expect(result.waiting).toEqual([
      { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: now - 100 },
    ]);
    // the original expired entry ("a1") must not survive anywhere in the new state
    expect(result.waiting.find((e) => e.id === "a1")).toBeUndefined();
  });

  it("drops an expired heating active entry (turn complete) and promotes the next waiting entry (QUEUE-15)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 320_000,
        deadline: now - 1,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 }],
    };
    const result = reapExpired(state, now);

    expect(result.active).toEqual({
      id: "b1",
      name: "Bruno",
      sessionTokenHash: "hash-b1",
      phase: "confirming",
      phaseStartedAt: now,
      deadline: now + CONFIRM_WINDOW_MS,
    });
    expect(result.waiting).toEqual([]);
  });

  it("leaves active as null when the expired entry has no one waiting to promote (QUEUE-17)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 320_000,
        deadline: now - 1,
      },
      waiting: [],
    };
    const result = reapExpired(state, now);

    expect(result.active).toBeNull();
    expect(result.waiting).toEqual([]);
  });

  it("does not mutate the input state object", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now - 21_000,
        deadline: now - 1,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 }],
    };
    const snapshot = structuredClone(state);
    reapExpired(state, now);
    expect(state).toEqual(snapshot);
  });
});

describe("applyJoin", () => {
  it("places the visitor directly into the confirming state when the queue and active slot are both empty (QUEUE-02)", () => {
    const now = 1_000_000;
    const state = emptyState();
    const result = applyJoin(state, { name: "Ana", id: "a1", sessionTokenHash: "hash-a1" }, now);

    expect(result.active).toEqual({
      id: "a1",
      name: "Ana",
      sessionTokenHash: "hash-a1",
      phase: "confirming",
      phaseStartedAt: now,
      deadline: now + CONFIRM_WINDOW_MS,
    });
    expect(result.waiting).toEqual([]);
  });

  it("appends the visitor to the end of the waiting list when the queue is occupied (QUEUE-03)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 1000,
        deadline: now + 300_000,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 }],
    };
    const result = applyJoin(state, { name: "Carla", id: "c1", sessionTokenHash: "hash-c1" }, now);

    expect(result.active).toEqual(state.active);
    expect(result.waiting).toEqual([
      { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 },
      { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: now },
    ]);
  });

  it("appends to the waiting list (not the active slot) when the queue is empty but someone is already active (QUEUE-03)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + CONFIRM_WINDOW_MS,
      },
      waiting: [],
    };
    const result = applyJoin(state, { name: "Bruno", id: "b1", sessionTokenHash: "hash-b1" }, now);

    expect(result.active).toEqual(state.active);
    expect(result.waiting).toEqual([
      { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now },
    ]);
  });

  it.each([
    ["exact match", "Ana"],
    ["case-insensitive match", "ana"],
    ["whitespace-padded match", "  Ana  "],
  ])("rejects a join with a %s of an already-active name (QUEUE-20)", (_label, attemptedName) => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 1000,
        deadline: now + 300_000,
      },
      waiting: [],
    };

    expect(() =>
      applyJoin(state, { name: attemptedName, id: "x1", sessionTokenHash: "hash-x1" }, now),
    ).toThrow(DuplicateNameError);
  });

  it("rejects a join with a name matching a waiting entry, case-insensitively (QUEUE-20)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: null,
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 }],
    };

    expect(() =>
      applyJoin(state, { name: "BRUNO", id: "x1", sessionTokenHash: "hash-x1" }, now),
    ).toThrow(DuplicateNameError);
  });

  it.each([["empty string", ""], ["whitespace only", "   "]])(
    "rejects a join with a %s name (QUEUE-04)",
    (_label, name) => {
      const now = 1_000_000;
      const state = emptyState();

      expect(() => applyJoin(state, { name, id: "x1", sessionTokenHash: "hash-x1" }, now)).toThrow(
        ValidationError,
      );
    },
  );

  it("does not mutate the input state object", () => {
    const now = 1_000_000;
    const state = emptyState();
    const snapshot = structuredClone(state);
    applyJoin(state, { name: "Ana", id: "a1", sessionTokenHash: "hash-a1" }, now);
    expect(state).toEqual(snapshot);
  });
});

describe("applyLeave", () => {
  function waitingState(): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: 1_000_000,
        deadline: 1_300_000,
      },
      waiting: [
        { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: 999_500 },
        { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: 999_900 },
      ],
    };
  }

  it("removes the matching waiting entry when id and token hash match (QUEUE-06)", () => {
    const state = waitingState();
    const result = applyLeave(state, { id: "b1", sessionTokenHash: "hash-b1" });

    expect(result.waiting).toEqual([{ id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: 999_900 }]);
    expect(result.active).toEqual(state.active);
  });

  it("throws NotFoundError when id matches nothing", () => {
    const state = waitingState();
    expect(() => applyLeave(state, { id: "ghost", sessionTokenHash: "whatever" })).toThrow(
      NotFoundError,
    );
  });

  it("throws ForbiddenError when id matches a waiting entry but the token hash doesn't", () => {
    const state = waitingState();
    expect(() => applyLeave(state, { id: "b1", sessionTokenHash: "wrong-hash" })).toThrow(
      ForbiddenError,
    );
  });

  it("throws WrongPhaseError when id matches the active entry", () => {
    const state = waitingState();
    expect(() => applyLeave(state, { id: "a1", sessionTokenHash: "hash-a1" })).toThrow(
      WrongPhaseError,
    );
  });

  it("does not mutate the input state object", () => {
    const state = waitingState();
    const snapshot = structuredClone(state);
    applyLeave(state, { id: "b1", sessionTokenHash: "hash-b1" });
    expect(state).toEqual(snapshot);
  });
});

describe("applyConfirmTurn", () => {
  function confirmingState(): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: 1_000_000,
        deadline: 1_000_000 + CONFIRM_WINDOW_MS,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: 999_500 }],
    };
  }

  it("transitions confirming to heating with a fresh 5:15 deadline (QUEUE-10)", () => {
    const state = confirmingState();
    const now = 1_000_010;
    const result = applyConfirmTurn(state, { id: "a1", sessionTokenHash: "hash-a1" }, now);

    expect(result.active).toEqual({
      id: "a1",
      name: "Ana",
      sessionTokenHash: "hash-a1",
      phase: "heating",
      phaseStartedAt: now,
      deadline: now + HEATING_WINDOW_MS,
    });
    expect(result.waiting).toEqual(state.waiting);
  });

  it("throws NotFoundError when id does not match the active entry", () => {
    const state = confirmingState();
    expect(() => applyConfirmTurn(state, { id: "b1", sessionTokenHash: "hash-b1" }, 1_000_010)).toThrow(
      NotFoundError,
    );
  });

  it("throws ForbiddenError when id matches but the token hash doesn't", () => {
    const state = confirmingState();
    expect(() =>
      applyConfirmTurn(state, { id: "a1", sessionTokenHash: "wrong-hash" }, 1_000_010),
    ).toThrow(ForbiddenError);
  });

  it("throws WrongPhaseError when the active entry is already heating", () => {
    const state = confirmingState();
    state.active = { ...state.active!, phase: "heating" };
    expect(() => applyConfirmTurn(state, { id: "a1", sessionTokenHash: "hash-a1" }, 1_000_010)).toThrow(
      WrongPhaseError,
    );
  });

  it("does not mutate the input state object", () => {
    const state = confirmingState();
    const snapshot = structuredClone(state);
    applyConfirmTurn(state, { id: "a1", sessionTokenHash: "hash-a1" }, 1_000_010);
    expect(state).toEqual(snapshot);
  });
});
