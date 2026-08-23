import { beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { hashToken } from "../../../../lib/queue/session";
import { QUEUE_STATE_KEY } from "../../../../lib/queue/store";
import type { PushSubscriptionRecord, QueueState } from "../../../../lib/queue/types";
import { POST as join } from "../join/route";
import { POST as leave } from "../leave/route";

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));
vi.mock("../../../../lib/notifications/dispatcher", () => ({
  dispatchAll: vi.fn(),
}));

const { dispatchAll } = await import("../../../../lib/notifications/dispatcher");

function joinRequest(name: string, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

function leaveRequest(id: string, sessionToken: string, rlKey = "test"): Request {
  return new Request("http://localhost/api/queue/leave", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": rlKey },
    body: JSON.stringify({ id, sessionToken }),
  });
}

const RATE_LIMIT_IDS = ["waiting-id", "missing-id", "wrong-token-id", "active-id", "rl-target"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(
    ["10.10.0.1", "10.10.0.2", "10.10.0.3", "10.10.0.4", "10.10.0.5"].map((ip) =>
      redis.del(`ratelimit:join:${ip}`),
    ),
  );
  await Promise.all(RATE_LIMIT_IDS.map((id) => redis.del(`ratelimit:leave:${id}`)));
  vi.mocked(dispatchAll).mockClear();
});

describe("POST /api/queue/leave", () => {
  it("removes a waiting entry (QUEUE-06)", async () => {
    await join(joinRequest("Ana", "10.10.0.1"));
    const bruno = await (await join(joinRequest("Bruno", "10.10.0.2"))).json();

    const response = await leave(leaveRequest(bruno.id, bruno.sessionToken));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns 404 when the id does not exist", async () => {
    const response = await leave(leaveRequest("does-not-exist", "whatever-token"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("returns 403 when the sessionToken does not match", async () => {
    await join(joinRequest("Ana", "10.10.0.3"));
    const bruno = await (await join(joinRequest("Bruno", "10.10.0.4"))).json();

    const response = await leave(leaveRequest(bruno.id, "totally-wrong-token"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  it("returns 409 when targeting the active entry (leaving an active turn is unsupported)", async () => {
    const ana = await (await join(joinRequest("Ana", "10.10.0.5"))).json();
    expect(ana.view.self.phase).toBe("confirming");

    const response = await leave(leaveRequest(ana.id, ana.sessionToken));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBeTruthy();
  });

  it("returns 429 when the same id exceeds the leave rate limit", async () => {
    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await leave(leaveRequest("rl-target", "irrelevant-token"));
    }

    expect(lastResponse!.status).toBe(429);
  });

  it("dispatches a seat-opened broadcast job to the current waitlist when leave drops the count from 100 to 99 (NOTIF-22)", async () => {
    const now = Date.now();
    const leaverToken = "leaver-token";
    const waiting = [
      { id: "w0", name: "Visitor0", sessionTokenHash: hashToken(leaverToken), joinedAt: now },
      ...Array.from({ length: 98 }, (_, i) => ({
        id: `w${i + 1}`,
        name: `Visitor${i + 1}`,
        sessionTokenHash: `hash-w${i + 1}`,
        joinedAt: now - i,
      })),
    ];
    const waitlistSub: PushSubscriptionRecord = {
      endpoint: "https://push.example/leave-waitlist",
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

    const response = await leave(leaveRequest("w0", leaverToken));

    expect(response.status).toBe(200);
    expect(dispatchAll).toHaveBeenCalledWith([
      { scenario: "seat-opened", recipients: [waitlistSub] },
    ]);
  });
});
