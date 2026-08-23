import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyConfirmTurn, applyFinishHeating, applyJoin, applyLeave } from "../engine";
import { redis } from "../redis-client";
import { QUEUE_STATE_KEY, getState, storeInternals, withQueueMutation } from "../store";
import { QueueBusyError, QueueFullError, type PushSubscriptionRecord, type QueueState } from "../types";

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

  it("allows exactly one of two concurrent joins to succeed at the 99/100 seat-cap boundary, holding the final count at 100 (NOTIF-18)", async () => {
    const now = Date.now();
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
    const seeded: QueueState = {
      version: 1,
      active: null,
      waiting,
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const joinCarla = () =>
      withQueueMutation((state, mutateNow) => {
        const next = applyJoin(
          state,
          { id: "carla-id", name: "Carla", sessionTokenHash: "carla-hash" },
          mutateNow,
        );
        return { next, result: next };
      });
    const joinDiego = () =>
      withQueueMutation((state, mutateNow) => {
        const next = applyJoin(
          state,
          { id: "diego-id", name: "Diego", sessionTokenHash: "diego-hash" },
          mutateNow,
        );
        return { next, result: next };
      });

    const results = await Promise.allSettled([joinCarla(), joinDiego()]);

    const fulfilled = results.filter(
      (settled): settled is PromiseFulfilledResult<Awaited<ReturnType<typeof joinCarla>>> =>
        settled.status === "fulfilled",
    );
    const rejected = results.filter(
      (settled): settled is PromiseRejectedResult => settled.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(QueueFullError);

    const finalState = await getState();
    expect((finalState.active ? 1 : 0) + finalState.waiting.length).toBe(100);
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

    const { result } = await withQueueMutation((state) => ({
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

describe("withQueueMutation - notification jobs", () => {
  it("produces a turn-ready job when a join lands directly into the confirming phase with a subscription (NOTIF-01)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/join",
      keys: { p256dh: "p", auth: "a" },
    };

    const { notificationJobs } = await withQueueMutation((state, now) => {
      const next = applyJoin(
        state,
        { id: "a1", name: "Ana", sessionTokenHash: "hash-a1", pushSubscription: subscription },
        now,
      );
      return { next, result: next };
    });

    expect(notificationJobs).toContainEqual({
      scenario: "turn-ready",
      recipients: [subscription],
    });
  });

  it("produces a turn-ready job for the newly promoted entry when a poll reaps an expired confirm-turn deadline (NOTIF-01)", async () => {
    const past = Date.now() - 1_000;
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/promoted",
      keys: { p256dh: "p", auth: "a" },
    };
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "expired-id",
        name: "Expirado",
        sessionTokenHash: "hash",
        phase: "confirming",
        phaseStartedAt: past - 61_000,
        deadline: past,
      },
      waiting: [
        {
          id: "next-id",
          name: "Proximo",
          sessionTokenHash: "hash2",
          joinedAt: past - 30_000,
          pushSubscription: subscription,
        },
      ],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs } = await withQueueMutation((state) => ({
      next: state,
      result: state,
    }));

    expect(notificationJobs).toContainEqual({
      scenario: "turn-ready",
      recipients: [subscription],
    });
  });

  it("produces a turn-ready job for the newly promoted entry when finishing heating (NOTIF-01)", async () => {
    const now = Date.now();
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/finish",
      keys: { p256dh: "p", auth: "a" },
    };
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: now - 60_000,
        deadline: now + 270_000,
      },
      waiting: [
        {
          id: "b1",
          name: "Bruno",
          sessionTokenHash: "hash-b1",
          joinedAt: now - 500,
          pushSubscription: subscription,
        },
      ],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs } = await withQueueMutation((state, mutateNow) => {
      const next = applyFinishHeating(state, { id: "a1", sessionTokenHash: "hash-a1" }, mutateNow);
      return { next, result: next };
    });

    expect(notificationJobs).toContainEqual({
      scenario: "turn-ready",
      recipients: [subscription],
    });
  });

  it("produces the heating checkpoint jobs when a poll crosses the 5:00 and 5:20 elapsed marks, and does not repeat them on a later poll (NOTIF-07, NOTIF-08)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/heating",
      keys: { p256dh: "p", auth: "a" },
    };
    const phaseStartedAt = Date.now() - 325_000; // past both the 5:00 and 5:20 marks
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt,
        deadline: phaseStartedAt + 330_000,
        pushSubscription: subscription,
      },
      waiting: [],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs: firstPoll } = await withQueueMutation((state) => ({
      next: state,
      result: state,
    }));

    expect(firstPoll).toContainEqual({ scenario: "heating-ended", recipients: [subscription] });
    expect(firstPoll).toContainEqual({
      scenario: "confirm-finish-ending",
      recipients: [subscription],
    });

    const { notificationJobs: secondPoll } = await withQueueMutation((state) => ({
      next: state,
      result: state,
    }));

    expect(secondPoll).toEqual([]);
  });

  it("produces a seat-opened job addressed to every current seatWaitlist subscriber when a leave drops the count from 100 to 99 (NOTIF-22)", async () => {
    const now = Date.now();
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
    const waitlistSub: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-1",
      keys: { p256dh: "p", auth: "a" },
    };
    const seeded: QueueState = {
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
      seatWaitlist: [
        { id: "wl1", tokenHash: "hash-wl1", subscription: waitlistSub, registeredAt: now - 5000 },
      ],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs } = await withQueueMutation((state) => {
      const next = applyLeave(state, { id: "w0", sessionTokenHash: "hash-w0" });
      return { next, result: next };
    });

    expect(notificationJobs).toContainEqual({
      scenario: "seat-opened",
      recipients: [waitlistSub],
    });
  });

  it("never produces a job with zero recipients when the transitioning entry has no push subscription (NOTIF-01)", async () => {
    const { notificationJobs } = await withQueueMutation((state, now) => {
      const next = applyJoin(state, { id: "a1", name: "Ana", sessionTokenHash: "hash-a1" }, now);
      return { next, result: next };
    });

    expect(notificationJobs).toEqual([]);
  });

  it("does not produce a seat-opened job when the count drops below the cap but the seat waitlist is empty", async () => {
    const now = Date.now();
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
    const seeded: QueueState = {
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
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs } = await withQueueMutation((state) => {
      const next = applyLeave(state, { id: "w0", sessionTokenHash: "hash-w0" });
      return { next, result: next };
    });

    expect(notificationJobs.find((job) => job.scenario === "seat-opened")).toBeUndefined();
  });

  it("does not produce a seat-opened job when a mutation leaves the count at exactly 100 (still full) (NOTIF-22)", async () => {
    const now = Date.now();
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
    const waitlistSub: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-still-full",
      keys: { p256dh: "p", auth: "a" },
    };
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "confirming",
        phaseStartedAt: now,
        deadline: now + 60_000,
      },
      waiting,
      seatWaitlist: [
        { id: "wl1", tokenHash: "hash-wl1", subscription: waitlistSub, registeredAt: now - 5000 },
      ],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);

    const { notificationJobs, result } = await withQueueMutation((state, mutateNow) => {
      const next = applyConfirmTurn(state, { id: "a1", sessionTokenHash: "hash-a1" }, mutateNow);
      return { next, result: next };
    });

    expect((result.active ? 1 : 0) + result.waiting.length).toBe(100);
    expect(notificationJobs.some((job) => job.scenario === "seat-opened")).toBe(false);
  });
});
