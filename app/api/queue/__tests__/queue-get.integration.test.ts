import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY } from "../../../../lib/queue/store";
import type { QueueState } from "../../../../lib/queue/types";
import { POST as join } from "../join/route";
import { GET as getQueue } from "../route";

function joinRequest(name: string, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

function getRequest(id?: string): Request {
  const url = id
    ? `http://localhost/api/queue?id=${encodeURIComponent(id)}`
    : "http://localhost/api/queue";
  return new Request(url, { method: "GET" });
}

const JOIN_IPS = ["10.40.0.1", "10.40.0.2", "10.40.0.3"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(JOIN_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
});

describe("GET /api/queue", () => {
  it("returns the anonymous landing view (count + estimated wait) with no id (QUEUE-01)", async () => {
    await join(joinRequest("Ana", "10.40.0.1"));

    const response = await getQueue(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queueCount).toBe(1);
    expect(typeof body.estimatedWaitMs).toBe("number");
    expect(body.self).toBeNull();
    expect(typeof body.serverTime).toBe("number");
  });

  it("returns the waiting-visitor view: position, ETA, namesAhead (QUEUE-05, QUEUE-21)", async () => {
    // Ana becomes active (confirming) immediately since the queue starts empty -
    // she is being served, not "waiting", so she must NOT appear in namesAhead.
    await join(joinRequest("Ana", "10.40.0.2"));
    await join(joinRequest("Bruno", "10.40.0.3"));
    const carla = await (await join(joinRequest("Carla", "10.40.0.1"))).json();

    const response = await getQueue(getRequest(carla.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.self.phase).toBe("waiting");
    expect(body.self.position).toBe(2);
    expect(body.namesAhead).toEqual(["Bruno"]);
  });

  it("returns the active-visitor view: phase and deadline", async () => {
    const ana = await (await join(joinRequest("Ana", "10.40.0.1"))).json();

    const response = await getQueue(getRequest(ana.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.self.phase).toBe("confirming");
    expect(typeof body.self.deadline).toBe("number");
  });

  it("reaps an expired confirming turn on read alone, with no other action taken (QUEUE-11, QUEUE-18)", async () => {
    const past = Date.now() - 1_000;
    const expiredState: QueueState = {
      version: 1,
      active: {
        id: "expired-id",
        name: "Expirado",
        sessionTokenHash: "hash",
        phase: "confirming",
        phaseStartedAt: past - 21_000,
        deadline: past,
      },
      waiting: [],
    };
    await redis.set(QUEUE_STATE_KEY, expiredState);

    const response = await getQueue(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queueCount).toBe(0);
  });
});
