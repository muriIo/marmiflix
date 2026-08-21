import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import { hashToken } from "../../../../lib/queue/session";
import type { PushSubscriptionRecord } from "../../../../lib/queue/types";
import { POST as waitlistJoin } from "../waitlist/join/route";

function waitlistJoinRequest(subscription: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/queue/waitlist/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ subscription }),
  });
}

const TEST_IPS = ["10.60.0.1", "10.60.0.2", "10.60.0.3", "10.60.0.4", "10.60.0.5"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(TEST_IPS.map((ip) => redis.del(`ratelimit:waitlist-join:${ip}`)));
});

describe("POST /api/queue/waitlist/join", () => {
  it("registers a well-formed subscription and returns 200 { id, token } (NOTIF-21)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-join-1",
      keys: { p256dh: "p", auth: "a" },
    };

    const response = await waitlistJoin(waitlistJoinRequest(subscription, "10.60.0.1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.id).toBe("string");
    expect(typeof body.token).toBe("string");

    const state = await getState();
    const entry = state.seatWaitlist.find((e) => e.id === body.id);
    expect(entry).toBeDefined();
    expect(entry?.subscription).toEqual(subscription);
    expect(entry?.tokenHash).toBe(hashToken(body.token));
  });

  it("returns 400 when the subscription shape is malformed", async () => {
    const response = await waitlistJoin(waitlistJoinRequest({ bogus: true }, "10.60.0.2"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("creates two distinct entries when registering twice with two different subscriptions (no dedup)", async () => {
    const subscriptionA: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-join-a",
      keys: { p256dh: "p", auth: "a" },
    };
    const subscriptionB: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-join-b",
      keys: { p256dh: "p", auth: "a" },
    };

    const responseA = await waitlistJoin(waitlistJoinRequest(subscriptionA, "10.60.0.3"));
    const bodyA = await responseA.json();
    const responseB = await waitlistJoin(waitlistJoinRequest(subscriptionB, "10.60.0.4"));
    const bodyB = await responseB.json();

    expect(bodyA.id).not.toBe(bodyB.id);
    const state = await getState();
    expect(state.seatWaitlist).toHaveLength(2);
  });

  it("returns 429 when the same IP exceeds the waitlist-join rate limit", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-join-rl",
      keys: { p256dh: "p", auth: "a" },
    };

    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await waitlistJoin(waitlistJoinRequest(subscription, "10.60.0.5"));
    }

    expect(lastResponse!.status).toBe(429);
  });
});
