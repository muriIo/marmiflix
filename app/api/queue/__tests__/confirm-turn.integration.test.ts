import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import { POST as confirmTurn } from "../confirm-turn/route";
import { POST as join } from "../join/route";

function joinRequest(name: string, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

function confirmTurnRequest(id: string, sessionToken: string): Request {
  return new Request("http://localhost/api/queue/confirm-turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, sessionToken }),
  });
}

const JOIN_IPS = ["10.20.0.1", "10.20.0.2", "10.20.0.3", "10.20.0.4", "10.20.0.5", "10.20.0.6"];
const RATE_LIMIT_IDS = ["missing-id", "rl-target"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(JOIN_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
  await Promise.all(RATE_LIMIT_IDS.map((id) => redis.del(`ratelimit:confirm-turn:${id}`)));
});

describe("POST /api/queue/confirm-turn", () => {
  it("transitions confirming -> heating (QUEUE-10)", async () => {
    const ana = await (await join(joinRequest("Ana", "10.20.0.1"))).json();
    expect(ana.view.self.phase).toBe("confirming");

    const response = await confirmTurn(confirmTurnRequest(ana.id, ana.sessionToken));
    expect(response.status).toBe(200);

    const state = await getState();
    expect(state.active?.id).toBe(ana.id);
    expect(state.active?.phase).toBe("heating");
  });

  it("returns 404 when the id belongs to a waiting entry (not the active one)", async () => {
    await join(joinRequest("Ana", "10.20.0.2"));
    const bruno = await (await join(joinRequest("Bruno", "10.20.0.3"))).json();
    expect(bruno.view.self.phase).toBe("waiting");

    const response = await confirmTurn(confirmTurnRequest(bruno.id, bruno.sessionToken));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("returns 403 when the sessionToken does not match", async () => {
    const ana = await (await join(joinRequest("Ana", "10.20.0.4"))).json();

    const response = await confirmTurn(confirmTurnRequest(ana.id, "totally-wrong-token"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  it("returns 409 when the active entry is already past the confirming phase", async () => {
    const ana = await (await join(joinRequest("Ana", "10.20.0.5"))).json();
    await confirmTurn(confirmTurnRequest(ana.id, ana.sessionToken));

    const response = await confirmTurn(confirmTurnRequest(ana.id, ana.sessionToken));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBeTruthy();
  });

  it("returns 429 when the same id exceeds the confirm-turn rate limit", async () => {
    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await confirmTurn(confirmTurnRequest("rl-target", "irrelevant-token"));
    }

    expect(lastResponse!.status).toBe(429);
  });
});
