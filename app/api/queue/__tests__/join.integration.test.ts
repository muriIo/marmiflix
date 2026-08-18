import { beforeEach, describe, expect, it } from "vitest";
import { QUEUE_STATE_KEY } from "../../../../lib/queue/store";
import { redis } from "../../../../lib/queue/redis-client";
import { POST as join } from "../join/route";

function joinRequest(name: string, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

const TEST_IPS = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6", "10.0.0.7"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(TEST_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
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
});
