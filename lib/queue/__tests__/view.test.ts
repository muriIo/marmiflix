import { describe, expect, it } from "vitest";
import { HEATING_WINDOW_MS } from "../engine";
import { buildView } from "../view";
import type { QueueState } from "../types";

const FIVE_MIN_MS = 5 * 60 * 1000;

function emptyState(): QueueState {
  return { version: 1, active: null, waiting: [] };
}

describe("buildView - anonymous / landing (QUEUE-01)", () => {
  it("returns zero count and zero wait for an empty queue", () => {
    const view = buildView(emptyState(), null, 1_000_000);
    expect(view.queueCount).toBe(0);
    expect(view.estimatedWaitMs).toBe(0);
  });

  it("returns the active turn's remaining time as the wait when only someone active", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 60_000,
        deadline: now + 120_000,
      },
      waiting: [],
    };
    const view = buildView(state, null, now);
    expect(view.queueCount).toBe(1);
    expect(view.estimatedWaitMs).toBe(120_000);
  });

  it("estimates the confirm-window remainder plus a full heating turn for a hypothetical new joiner while the active entry is still confirming, not just the short confirm-window remainder", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + 20_000,
      },
      waiting: [],
    };
    const view = buildView(state, null, now);
    expect(view.queueCount).toBe(1);
    expect(view.estimatedWaitMs).toBe(20_000 + HEATING_WINDOW_MS);
  });

  it("keeps the estimate continuous across the confirming -> heating transition (no upward jump right when the active entry confirms)", () => {
    const confirmDeadline = 1_020_000;
    const stateJustBeforeConfirm: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: 1_000_000,
        deadline: confirmDeadline,
      },
      waiting: [],
    };
    const stateJustAfterConfirm: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: confirmDeadline,
        deadline: confirmDeadline + HEATING_WINDOW_MS,
      },
      waiting: [],
    };

    const before = buildView(stateJustBeforeConfirm, null, confirmDeadline);
    const after = buildView(stateJustAfterConfirm, null, confirmDeadline);

    expect(before.estimatedWaitMs).toBe(after.estimatedWaitMs);
  });

  it("adds 5 minutes per waiting person on top of the active turn's remaining time for a hypothetical new joiner", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 60_000,
        deadline: now + 120_000,
      },
      waiting: [
        { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 },
        { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: now - 100 },
      ],
    };
    const view = buildView(state, null, now);
    expect(view.queueCount).toBe(3);
    expect(view.estimatedWaitMs).toBe(120_000 + 2 * FIVE_MIN_MS);
  });

  it("includes serverTime equal to now", () => {
    const view = buildView(emptyState(), null, 1_234_567);
    expect(view.serverTime).toBe(1_234_567);
  });

  it("returns the anonymous shape (self: null) when viewerId matches nothing in state, e.g. a since-reaped id", () => {
    const view = buildView(emptyState(), "ghost-id", 1_000_000);
    expect(view.self).toBeNull();
    expect(view.queueCount).toBe(0);
  });
});

describe("buildView - waiting viewer (QUEUE-05, QUEUE-21)", () => {
  function stateWithThreeWaiting(now: number): QueueState {
    return {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 60_000,
        deadline: now + 60_000,
      },
      waiting: [
        { id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 },
        { id: "c1", name: "Carla", sessionTokenHash: "hash-c1", joinedAt: now - 400 },
        { id: "d1", name: "Duda", sessionTokenHash: "hash-d1", joinedAt: now - 300 },
      ],
    };
  }

  it("returns the viewer's 1-based live position and an ETA relative to their position", () => {
    const now = 1_000_000;
    const state = stateWithThreeWaiting(now);
    const view = buildView(state, "c1", now);

    expect(view.self).toMatchObject({ id: "c1", phase: "waiting", position: 2 });
    // active remaining (60_000) + 1 person ahead (Bruno) * 5 min
    expect(view.self?.estimatedWaitMs).toBe(60_000 + FIVE_MIN_MS);
    expect(view.estimatedWaitMs).toBe(60_000 + FIVE_MIN_MS);
  });

  it("estimates the confirm-window remainder plus a full heating turn for a waiting viewer while the active entry ahead of them is still confirming", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + 20_000,
      },
      waiting: [{ id: "b1", name: "Bruno", sessionTokenHash: "hash-b1", joinedAt: now - 500 }],
    };
    const view = buildView(state, "b1", now);

    expect(view.self).toMatchObject({ id: "b1", phase: "waiting", position: 1 });
    expect(view.self?.estimatedWaitMs).toBe(20_000 + HEATING_WINDOW_MS);
  });

  it("lists the display names of everyone strictly ahead, in join order, for the 3rd person (QUEUE-21)", () => {
    const now = 1_000_000;
    const state = stateWithThreeWaiting(now);
    const view = buildView(state, "d1", now);

    expect(view.namesAhead).toEqual(["Bruno", "Carla"]);
  });

  it("returns an empty namesAhead for the first waiting person", () => {
    const now = 1_000_000;
    const state = stateWithThreeWaiting(now);
    const view = buildView(state, "b1", now);

    expect(view.namesAhead).toEqual([]);
    expect(view.self).toMatchObject({ position: 1 });
  });
});

describe("buildView - active viewer", () => {
  it("returns the viewer's phase and deadline when they are the active entry", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + 20_000,
      },
      waiting: [],
    };
    const view = buildView(state, "a1", now);

    expect(view.self).toEqual({ id: "a1", phase: "confirming", deadline: now + 20_000 });
  });
});

describe("buildView - never-leak invariant", () => {
  it("never includes any other entry's id or sessionTokenHash anywhere in the returned view, for any viewer", () => {
    const now = 1_000_000;
    const state: QueueState = {
      version: 1,
      active: {
        id: "a1-secret-id",
        name: "Ana",
        sessionTokenHash: "hash-a1-secret",
        phase: "heating",
        phaseStartedAt: now - 60_000,
        deadline: now + 60_000,
      },
      waiting: [
        { id: "b1-secret-id", name: "Bruno", sessionTokenHash: "hash-b1-secret", joinedAt: now - 500 },
        { id: "c1-secret-id", name: "Carla", sessionTokenHash: "hash-c1-secret", joinedAt: now - 400 },
      ],
    };

    for (const viewerId of [null, "b1-secret-id", "c1-secret-id", "a1-secret-id"]) {
      const view = buildView(state, viewerId, now);
      const serialized = JSON.stringify(view);

      // every entry's token hash must never appear, for any viewer, including their own
      expect(serialized).not.toContain("hash-a1-secret");
      expect(serialized).not.toContain("hash-b1-secret");
      expect(serialized).not.toContain("hash-c1-secret");

      // another entry's id must never appear (the viewer's own id in `self.id` is fine)
      const otherIds = ["a1-secret-id", "b1-secret-id", "c1-secret-id"].filter(
        (id) => id !== viewerId,
      );
      for (const otherId of otherIds) {
        expect(serialized).not.toContain(otherId);
      }
    }
  });
});
