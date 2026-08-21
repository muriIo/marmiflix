import { describe, expect, it } from "vitest";
import {
  applyAttachPushSubscription,
  applyConfirmTurn,
  applyFinishHeating,
  applyHeatingCheckpoints,
  applyJoin,
  applyLeave,
  applyPruneSubscriptions,
  reapExpired,
} from "../engine";
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
} from "../types";

const CONFIRM_WINDOW_MS = 60_000;
const HEATING_WINDOW_MS = 330_000;

function emptyState(): QueueState {
  return { version: 1, active: null, waiting: [], seatWaitlist: [] };
}

function subscription(suffix: string): PushSubscriptionRecord {
  return {
    endpoint: `https://push.example/${suffix}`,
    keys: { p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` },
  };
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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

  it("throws QueueFullError when the queue is already at the 100-seat cap (NOTIF-17, NOTIF-18)", () => {
    const now = 1_000_000;
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
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
      waiting,
      seatWaitlist: [],
    };

    expect(state.waiting.length + 1).toBe(100);
    expect(() =>
      applyJoin(state, { name: "Newcomer", id: "x1", sessionTokenHash: "hash-x1" }, now),
    ).toThrow(QueueFullError);
  });

  it("does not throw QueueFullError when the queue is at 99 seats, one below the cap (NOTIF-17)", () => {
    const now = 1_000_000;
    const waiting = Array.from({ length: 98 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
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
      waiting,
      seatWaitlist: [],
    };

    expect(state.waiting.length + 1).toBe(99);
    expect(() =>
      applyJoin(state, { name: "Newcomer", id: "x1", sessionTokenHash: "hash-x1" }, now),
    ).not.toThrow();
  });

  it("stores a provided push subscription on the active entry created for an empty-queue join (NOTIF-01)", () => {
    const now = 1_000_000;
    const state = emptyState();
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    };
    const result = applyJoin(
      state,
      { name: "Ana", id: "a1", sessionTokenHash: "hash-a1", pushSubscription: subscription },
      now,
    );

    expect(result.active?.pushSubscription).toEqual(subscription);
  });

  it("stores a provided push subscription on the waiting entry created for a join into an occupied queue (NOTIF-01)", () => {
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
      seatWaitlist: [],
    };
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/def",
      keys: { p256dh: "p256dh-key-2", auth: "auth-key-2" },
    };
    const result = applyJoin(
      state,
      { name: "Bruno", id: "b1", sessionTokenHash: "hash-b1", pushSubscription: subscription },
      now,
    );

    expect(result.waiting[0].pushSubscription).toEqual(subscription);
  });

  it("uses a 60-second confirm-turn deadline for a fresh join into an empty queue (NOTIF-05)", () => {
    const now = 1_000_000;
    const state = emptyState();
    const result = applyJoin(state, { name: "Ana", id: "a1", sessionTokenHash: "hash-a1" }, now);

    expect(result.active?.deadline).toBe(now + 60_000);
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
      seatWaitlist: [],
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
      seatWaitlist: [],
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

  it("uses a 330-second (5:30) heating auto-end deadline (NOTIF-10)", () => {
    const state = confirmingState();
    const now = 1_000_010;
    const result = applyConfirmTurn(state, { id: "a1", sessionTokenHash: "hash-a1" }, now);

    expect(result.active?.deadline).toBe(now + 330_000);
  });
});

describe("applyFinishHeating", () => {
  function heatingState(): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: 1_000_000,
        deadline: 1_000_000 + HEATING_WINDOW_MS,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: 999_500 }],
      seatWaitlist: [],
    };
  }

  it("clears active and promotes the next waiting entry into confirming with a fresh deadline (QUEUE-14)", () => {
    const state = heatingState();
    const now = 1_000_030;
    const result = applyFinishHeating(state, { id: "a1", sessionTokenHash: "hash-a1" }, now);

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

  it("leaves the queue empty when finishing as the last person (QUEUE-17)", () => {
    const state = heatingState();
    state.waiting = [];
    const now = 1_000_030;
    const result = applyFinishHeating(state, { id: "a1", sessionTokenHash: "hash-a1" }, now);

    expect(result.active).toBeNull();
    expect(result.waiting).toEqual([]);
  });

  it("throws NotFoundError when id does not match the active entry", () => {
    const state = heatingState();
    expect(() =>
      applyFinishHeating(state, { id: "b1", sessionTokenHash: "hash-b1" }, 1_000_030),
    ).toThrow(NotFoundError);
  });

  it("throws ForbiddenError when id matches but the token hash doesn't", () => {
    const state = heatingState();
    expect(() =>
      applyFinishHeating(state, { id: "a1", sessionTokenHash: "wrong-hash" }, 1_000_030),
    ).toThrow(ForbiddenError);
  });

  it("throws WrongPhaseError when the active entry is still confirming", () => {
    const state = heatingState();
    state.active = { ...state.active!, phase: "confirming" };
    expect(() =>
      applyFinishHeating(state, { id: "a1", sessionTokenHash: "hash-a1" }, 1_000_030),
    ).toThrow(WrongPhaseError);
  });

  it("does not mutate the input state object", () => {
    const state = heatingState();
    const snapshot = structuredClone(state);
    applyFinishHeating(state, { id: "a1", sessionTokenHash: "hash-a1" }, 1_000_030);
    expect(state).toEqual(snapshot);
  });
});

describe("applyHeatingCheckpoints", () => {
  function heatingActiveState(
    phaseStartedAt: number,
    notifiedCheckpoints?: HeatingCheckpoint[],
  ): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt,
        deadline: phaseStartedAt + 330_000,
        ...(notifiedCheckpoints ? { notifiedCheckpoints } : {}),
      },
      waiting: [],
      seatWaitlist: [],
    };
  }

  it("returns the same state reference and no fired checkpoints when there is no active entry (NOTIF-07, NOTIF-08)", () => {
    const state = emptyState();
    const result = applyHeatingCheckpoints(state, 1_000_000);

    expect(result.state).toBe(state);
    expect(result.fired).toEqual([]);
  });

  it("returns the same state reference and no fired checkpoints when the active entry is not in the heating phase (NOTIF-07, NOTIF-08)", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + 60_000,
      },
      waiting: [],
      seatWaitlist: [],
    };
    const result = applyHeatingCheckpoints(state, now + 400_000);

    expect(result.state).toBe(state);
    expect(result.fired).toEqual([]);
  });

  it("fires heating-ended exactly once when elapsed crosses 300,000ms, not again on a later call with the same notifiedCheckpoints (NOTIF-07)", () => {
    const phaseStartedAt = 1_000_000;
    const state = heatingActiveState(phaseStartedAt);

    const firstCall = applyHeatingCheckpoints(state, phaseStartedAt + 300_000);
    expect(firstCall.fired).toEqual(["heating-ended"]);
    expect(firstCall.state.active?.notifiedCheckpoints).toEqual(["heating-ended"]);

    const secondCall = applyHeatingCheckpoints(firstCall.state, phaseStartedAt + 310_000);
    expect(secondCall.fired).toEqual([]);
  });

  it("fires confirm-finish-ending exactly once when elapsed crosses 320,000ms (NOTIF-08)", () => {
    const phaseStartedAt = 1_000_000;
    const state = heatingActiveState(phaseStartedAt, ["heating-ended"]);

    const result = applyHeatingCheckpoints(state, phaseStartedAt + 320_000);
    expect(result.fired).toEqual(["confirm-finish-ending"]);
    expect(result.state.active?.notifiedCheckpoints).toEqual([
      "heating-ended",
      "confirm-finish-ending",
    ]);

    const secondCall = applyHeatingCheckpoints(result.state, phaseStartedAt + 325_000);
    expect(secondCall.fired).toEqual([]);
  });

  it("fires both checkpoints together when elapsed is checked for the first time past 320,000ms, e.g. after a gap (NOTIF-07, NOTIF-08)", () => {
    const phaseStartedAt = 1_000_000;
    const state = heatingActiveState(phaseStartedAt);

    const result = applyHeatingCheckpoints(state, phaseStartedAt + 325_000);

    expect(result.fired).toEqual(["heating-ended", "confirm-finish-ending"]);
    expect(result.state.active?.notifiedCheckpoints).toEqual([
      "heating-ended",
      "confirm-finish-ending",
    ]);
  });
});

describe("applyAttachPushSubscription", () => {
  function stateWithActiveAndWaiting(): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: 1_000_000,
        deadline: 1_330_000,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: 999_500 }],
      seatWaitlist: [],
    };
  }

  it("attaches the subscription to the active entry when the id matches active (NOTIF-03)", () => {
    const state = stateWithActiveAndWaiting();
    const sub = subscription("active");
    const result = applyAttachPushSubscription(state, {
      id: "a1",
      sessionTokenHash: "hash-a1",
      subscription: sub,
    });

    expect(result.active?.pushSubscription).toEqual(sub);
    expect(result.waiting[0].pushSubscription).toBeUndefined();
  });

  it("attaches the subscription to the matching waiting entry when the id does not match active (NOTIF-03)", () => {
    const state = stateWithActiveAndWaiting();
    const sub = subscription("waiting");
    const result = applyAttachPushSubscription(state, {
      id: "b1",
      sessionTokenHash: "hash-b1",
      subscription: sub,
    });

    expect(result.waiting[0].pushSubscription).toEqual(sub);
    expect(result.active?.pushSubscription).toBeUndefined();
  });

  it("throws NotFoundError when the id matches neither the active entry nor any waiting entry", () => {
    const state = stateWithActiveAndWaiting();
    expect(() =>
      applyAttachPushSubscription(state, {
        id: "ghost",
        sessionTokenHash: "whatever",
        subscription: subscription("ghost"),
      }),
    ).toThrow(NotFoundError);
  });

  it("throws ForbiddenError when the id matches the active entry but the token hash doesn't", () => {
    const state = stateWithActiveAndWaiting();
    expect(() =>
      applyAttachPushSubscription(state, {
        id: "a1",
        sessionTokenHash: "wrong-hash",
        subscription: subscription("active"),
      }),
    ).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when the id matches a waiting entry but the token hash doesn't", () => {
    const state = stateWithActiveAndWaiting();
    expect(() =>
      applyAttachPushSubscription(state, {
        id: "b1",
        sessionTokenHash: "wrong-hash",
        subscription: subscription("waiting"),
      }),
    ).toThrow(ForbiddenError);
  });

  it("does not mutate the input state object", () => {
    const state = stateWithActiveAndWaiting();
    const snapshot = structuredClone(state);
    applyAttachPushSubscription(state, {
      id: "a1",
      sessionTokenHash: "hash-a1",
      subscription: subscription("active"),
    });
    expect(state).toEqual(snapshot);
  });
});

describe("applyPruneSubscriptions", () => {
  function stateWithSubscriptions(): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: 1_000_000,
        deadline: 1_330_000,
        pushSubscription: subscription("active"),
      },
      waiting: [
        {
          id: "b1",
          name: "Bruno",
          sessionTokenHash: "hash-b1",
          joinedAt: 999_500,
          pushSubscription: subscription("waiting"),
        },
        { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: 999_900 },
      ],
      seatWaitlist: [
        {
          id: "w1",
          tokenHash: "hash-w1",
          subscription: subscription("waitlist"),
          registeredAt: 999_000,
        },
      ],
    };
  }

  it("strips a matching pushSubscription from the active entry, leaving the rest of the entry untouched", () => {
    const state = stateWithSubscriptions();
    const result = applyPruneSubscriptions(state, [subscription("active").endpoint]);

    expect(result.active?.pushSubscription).toBeUndefined();
    expect(result.active).toMatchObject({ id: "a1", name: "Ana", phase: "heating" });
  });

  it("strips a matching pushSubscription from a waiting entry, leaving the rest of the entry untouched", () => {
    const state = stateWithSubscriptions();
    const result = applyPruneSubscriptions(state, [subscription("waiting").endpoint]);

    expect(result.waiting[0].pushSubscription).toBeUndefined();
    expect(result.waiting[0]).toMatchObject({ id: "b1", name: "Bruno" });
  });

  it("removes a matching seatWaitlist entry entirely", () => {
    const state = stateWithSubscriptions();
    const result = applyPruneSubscriptions(state, [subscription("waitlist").endpoint]);

    expect(result.seatWaitlist).toEqual([]);
  });

  it("leaves everything else untouched when an invalid endpoint matches nothing in state", () => {
    const state = stateWithSubscriptions();
    const result = applyPruneSubscriptions(state, ["https://push.example/unrelated"]);

    expect(result).toEqual(state);
  });

  it("returns the same state reference when invalidEndpoints is empty", () => {
    const state = stateWithSubscriptions();
    const result = applyPruneSubscriptions(state, []);

    expect(result).toBe(state);
  });

  it("does not mutate the input state object", () => {
    const state = stateWithSubscriptions();
    const snapshot = structuredClone(state);
    applyPruneSubscriptions(state, [subscription("active").endpoint]);
    expect(state).toEqual(snapshot);
  });
});
