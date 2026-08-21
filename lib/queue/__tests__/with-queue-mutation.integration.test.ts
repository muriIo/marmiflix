import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyJoin } from "../engine";
import { redis } from "../redis-client";
import { QUEUE_STATE_KEY, getState, storeInternals, withQueueMutation } from "../store";
import { QueueBusyError, type QueueState } from "../types";

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
});

describe("withQueueMutation", () => {
  it("never lets two concurrent joins against an empty queue both become active (QUEUE-19)", async () => {
    const joinAna = () =>
      withQueueMutation((state, now) => {
        const next = applyJoin(
          state,
          { id: "ana-id", name: "Ana", sessionTokenHash: "ana-hash" },
          now,
        );
        return { next, result: next };
      });
    const joinBruno = () =>
      withQueueMutation((state, now) => {
        const next = applyJoin(
          state,
          { id: "bruno-id", name: "Bruno", sessionTokenHash: "bruno-hash" },
          now,
        );
        return { next, result: next };
      });

    await Promise.all([joinAna(), joinBruno()]);

    const finalState = await getState();
    expect(finalState.active).not.toBeNull();
    expect(finalState.waiting).toHaveLength(1);

    const activeName = finalState.active!.name;
    const waitingName = finalState.waiting[0].name;
    const names = [activeName, waitingName].sort();
    expect(names).toEqual(["Ana", "Bruno"]);
    expect(finalState.waiting[0].id).not.toBe(finalState.active!.id);
  });

  it("sees the reaped/promoted state, not the stale one, when the active turn's deadline already passed", async () => {
    const past = Date.now() - 1_000;
    const staleActiveState: QueueState = {
      version: 1,
      active: {
        id: "expired-id",
        name: "Expirado",
        sessionTokenHash: "hash",
        phase: "confirming",
        phaseStartedAt: past - 21_000,
        deadline: past,
      },
      waiting: [{ id: "next-id", name: "Proximo", sessionTokenHash: "hash2", joinedAt: past - 30_000 }],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, staleActiveState);

    const result = await withQueueMutation((state) => ({
      next: state,
      result: state,
    }));

    expect(result.active?.id).toBe("next-id");
    expect(result.active?.phase).toBe("confirming");
    expect(result.waiting).toHaveLength(0);
  });

  it("throws QueueBusyError after exhausting retries when casWrite keeps losing (simulated persistent concurrent writer)", async () => {
    const casWriteSpy = vi.spyOn(storeInternals, "casWrite").mockResolvedValue(false);

    await expect(
      withQueueMutation((state) => ({
        next: { ...state, waiting: [...state.waiting] },
        result: null,
      })),
    ).rejects.toThrow(QueueBusyError);

    expect(casWriteSpy).toHaveBeenCalledTimes(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
