import { describe, expect, it } from "vitest";
import { reapExpired } from "../engine";
import type { QueueState } from "../types";

const CONFIRM_WINDOW_MS = 20_000;

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
