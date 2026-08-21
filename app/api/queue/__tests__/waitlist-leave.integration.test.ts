import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import type { PushSubscriptionRecord } from "../../../../lib/queue/types";
import { POST as waitlistJoin } from "../waitlist/join/route";
import { POST as waitlistLeave } from "../waitlist/leave/route";

function waitlistJoinRequest(subscription: unknown, ip: string): Request {
  return new Request("http://localhost/api/queue/waitlist/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ subscription }),
  });
}

function waitlistLeaveRequest(id: string, token: string): Request {
  return new Request("http://localhost/api/queue/waitlist/leave", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, token }),
  });
}

const JOIN_IPS = ["10.61.0.1", "10.61.0.2"];
const RATE_LIMIT_IDS = ["missing-id", "rl-target"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(JOIN_IPS.map((ip) => redis.del(`ratelimit:waitlist-join:${ip}`)));
  await Promise.all(RATE_LIMIT_IDS.map((id) => redis.del(`ratelimit:waitlist-leave:${id}`)));
});

describe("POST /api/queue/waitlist/leave", () => {
  it("removes a valid id/token registration and returns 200 { ok: true } (NOTIF-26)", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-leave-1",
      keys: { p256dh: "p", auth: "a" },
    };
    const registration = await (
      await waitlistJoin(waitlistJoinRequest(subscription, "10.61.0.1"))
    ).json();

    const response = await waitlistLeave(waitlistLeaveRequest(registration.id, registration.token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    const state = await getState();
    expect(state.seatWaitlist.find((e) => e.id === registration.id)).toBeUndefined();
  });

  it("returns 404 when the id does not exist", async () => {
    const response = await waitlistLeave(waitlistLeaveRequest("does-not-exist", "whatever-token"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("returns 403 and does not remove the entry when the token does not match", async () => {
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://push.example/waitlist-leave-2",
      keys: { p256dh: "p", auth: "a" },
    };
    const registration = await (
      await waitlistJoin(waitlistJoinRequest(subscription, "10.61.0.2"))
    ).json();

    const response = await waitlistLeave(
      waitlistLeaveRequest(registration.id, "totally-wrong-token"),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
    const state = await getState();
    expect(state.seatWaitlist.find((e) => e.id === registration.id)).toBeDefined();
  });

  it("returns 429 when the same id exceeds the waitlist-leave rate limit", async () => {
    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await waitlistLeave(waitlistLeaveRequest("rl-target", "irrelevant-token"));
    }

    expect(lastResponse!.status).toBe(429);
  });
});
