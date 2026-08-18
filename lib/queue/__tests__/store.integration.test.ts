import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../redis-client";
import { QUEUE_STATE_KEY, casWrite, getState } from "../store";
import type { QueueState } from "../types";

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
});

describe("getState", () => {
  it("returns a default empty state (version 0) when the key does not exist", async () => {
    const state = await getState();
    expect(state).toEqual({ version: 0, active: null, waiting: [] });
  });
});

describe("casWrite", () => {
  it("round-trips: getState -> mutate in memory -> casWrite succeeds -> getState reflects the change", async () => {
    const initial = await getState();
    const next: QueueState = {
      version: initial.version + 1,
      active: null,
      waiting: [{ id: "v1", name: "Ana", sessionTokenHash: "hash1", joinedAt: 1000 }],
    };

    const won = await casWrite(QUEUE_STATE_KEY, initial.version, next);
    expect(won).toBe(true);

    const reread = await getState();
    expect(reread).toEqual(next);
  });

  it("returns false and leaves the stored state untouched when expectedVersion is stale", async () => {
    const initial = await getState();
    const firstWrite: QueueState = {
      version: initial.version + 1,
      active: null,
      waiting: [{ id: "v1", name: "Ana", sessionTokenHash: "hash1", joinedAt: 1000 }],
    };
    await casWrite(QUEUE_STATE_KEY, initial.version, firstWrite);

    const staleAttempt: QueueState = {
      version: initial.version + 1,
      active: null,
      waiting: [{ id: "v2", name: "Bruno", sessionTokenHash: "hash2", joinedAt: 2000 }],
    };
    const won = await casWrite(QUEUE_STATE_KEY, initial.version, staleAttempt);
    expect(won).toBe(false);

    const reread = await getState();
    expect(reread).toEqual(firstWrite);
  });
});
