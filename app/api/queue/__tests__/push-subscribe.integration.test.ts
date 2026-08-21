import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import type { PushSubscriptionRecord } from "../../../../lib/queue/types";
import { POST as join } from "../join/route";
import { POST as pushSubscribe } from "../push-subscribe/route";

function joinRequest(name: string, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

function pushSubscribeRequest(id: string, sessionToken: string, subscription: unknown): Request {
  return new Request("http://localhost/api/queue/push-subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, sessionToken, subscription }),
  });
}

const JOIN_IPS = ["10.50.0.1", "10.50.0.2", "10.50.0.3", "10.50.0.4"];
const RATE_LIMIT_IDS = ["missing-id", "rl-target"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(JOIN_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
  await Promise.all(RATE_LIMIT_IDS.map((id) => redis.del(`ratelimit:push-subscribe:${id}`)));
});

describe("POST /api/queue/push-subscribe", () => {
  it("attaches a well-formed subscription to an existing entry and returns 200 (NOTIF-03)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/subscribe-1",
      keys: { p256dh: "p", auth: "a" },
    };
    const ana = await (await join(joinRequest("Ana", "10.50.0.1"))).json();

    const response = await pushSubscribe(
      pushSubscribeRequest(ana.id, ana.sessionToken, subscription),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    const state = await getState();
    expect(state.active?.pushSubscription).toEqual(subscription);
  });

  it("returns 404 when the id does not exist", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/subscribe-2",
      keys: { p256dh: "p", auth: "a" },
    };

    const response = await pushSubscribe(
      pushSubscribeRequest("does-not-exist", "whatever-token", subscription),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("returns 403 when the sessionToken does not match", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/subscribe-3",
      keys: { p256dh: "p", auth: "a" },
    };
    const ana = await (await join(joinRequest("Ana", "10.50.0.2"))).json();

    const response = await pushSubscribe(
      pushSubscribeRequest(ana.id, "totally-wrong-token", subscription),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when the subscription shape is malformed", async () => {
    const ana = await (await join(joinRequest("Ana", "10.50.0.3"))).json();

    const response = await pushSubscribe(
      pushSubscribeRequest(ana.id, ana.sessionToken, { bogus: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("returns 429 when the same id exceeds the push-subscribe rate limit", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/subscribe-rl",
      keys: { p256dh: "p", auth: "a" },
    };

    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await pushSubscribe(
        pushSubscribeRequest("rl-target", "irrelevant-token", subscription),
      );
    }

    expect(lastResponse!.status).toBe(429);
  });
});
