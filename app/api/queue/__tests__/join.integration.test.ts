import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import { redis } from "../../../../lib/queue/redis-client";
import type { PushSubscriptionRecord, QueueState } from "../../../../lib/queue/types";
import { POST as join } from "../join/route";

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));
vi.mock("../../../../lib/notifications/dispatcher", () => ({
  dispatchAll: vi.fn(),
}));

const { dispatchAll } = await import("../../../../lib/notifications/dispatcher");

function joinRequest(name: string, ip = "1.2.3.4", subscription?: PushSubscriptionRecord): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(subscription ? { name, subscription } : { name }),
  });
}

function joinRequestRaw(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const TEST_IPS = [
  "10.0.0.1",
  "10.0.0.2",
  "10.0.0.3",
  "10.0.0.4",
  "10.0.0.5",
  "10.0.0.6",
  "10.0.0.7",
  "10.0.0.8",
  "10.0.0.9",
  "10.0.0.10",
];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(TEST_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
  vi.mocked(dispatchAll).mockClear();
});

describe("POST /api/queue/join", () => {
  it("joins directly into the confirming phase when the queue is empty (QUEUE-02)", async () => {
    const response = await join(joinRequest("Ana", "10.0.0.1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.id).toBe("string");
    expect(typeof body.sessionToken).toBe("string");
    expect(body.view.self.phase).toBe("confirming");
  });

  it("joins into the waiting phase when someone is already active (QUEUE-03)", async () => {
    await join(joinRequest("Ana", "10.0.0.2"));
    const response = await join(joinRequest("Bruno", "10.0.0.3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.view.self.phase).toBe("waiting");
    expect(body.view.self.position).toBe(1);
  });

  it("returns 409 when the name is already active in the queue (QUEUE-20)", async () => {
    await join(joinRequest("Ana", "10.0.0.4"));
    const response = await join(joinRequest("Ana", "10.0.0.5"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when the name is empty (QUEUE-04)", async () => {
    const response = await join(joinRequest("", "10.0.0.6"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("returns 429 when the same IP exceeds the join rate limit", async () => {
    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await join(joinRequest(`Visitor${i}`, "10.0.0.7"));
    }

    expect(lastResponse!.status).toBe(429);
  });

  it("returns 409 with code QUEUE_FULL when the queue is already at the 100-seat cap (NOTIF-17, NOTIF-19)", async () => {
    const now = Date.now();
    const waiting = Array.from({ length: 99 }, (_, i) => ({
      id: `w${i}`,
      name: `Visitor${i}`,
      sessionTokenHash: `hash-w${i}`,
      joinedAt: now - i,
    }));
    const fullState: QueueState = {
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
    await redis.set(QUEUE_STATE_KEY, fullState);

    const response = await join(joinRequest("Latecomer", "10.0.0.8"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("QUEUE_FULL");
  });

  it("stores a well-formed subscription on the created entry (NOTIF-20)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/join-sub",
      keys: { p256dh: "p", auth: "a" },
    };

    const response = await join(joinRequest("Ana", "10.0.0.9", subscription));
    const body = await response.json();

    expect(response.status).toBe(200);
    const state = await getState();
    expect(state.active?.id).toBe(body.id);
    expect(state.active?.pushSubscription).toEqual(subscription);
  });

  it("succeeds exactly as before when the subscription field is malformed or missing (NOTIF-20)", async () => {
    const response = await join(joinRequestRaw({ name: "Ana", subscription: { bogus: true } }, "10.0.0.10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    const state = await getState();
    expect(state.active?.id).toBe(body.id);
    expect(state.active?.pushSubscription).toBeUndefined();
  });

  it("does not dispatch any notification when joining into an empty queue with a subscription (no one else to notify) (NOTIF-01)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/join-empty",
      keys: { p256dh: "p", auth: "a" },
    };

    const response = await join(joinRequest("Ana", "10.0.0.1", subscription));

    expect(response.status).toBe(200);
    expect(dispatchAll).not.toHaveBeenCalled();
  });
});
