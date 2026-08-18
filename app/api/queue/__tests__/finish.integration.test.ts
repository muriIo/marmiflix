import { beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../../../lib/queue/redis-client";
import { QUEUE_STATE_KEY, getState } from "../../../../lib/queue/store";
import { POST as confirmTurn } from "../confirm-turn/route";
import { POST as finish } from "../finish/route";
import { POST as join } from "../join/route";

function joinRequest(name: string, ip: string): Request {
  return new Request("http://localhost/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

function actionRequest(path: string, id: string, sessionToken: string): Request {
  return new Request(`http://localhost/api/queue/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, sessionToken }),
  });
}

const JOIN_IPS = ["10.30.0.1", "10.30.0.2", "10.30.0.3", "10.30.0.4", "10.30.0.5", "10.30.0.6"];
const RATE_LIMIT_IDS = ["missing-id", "rl-target"];

beforeEach(async () => {
  await redis.del(QUEUE_STATE_KEY);
  await Promise.all(JOIN_IPS.map((ip) => redis.del(`ratelimit:join:${ip}`)));
  await Promise.all(RATE_LIMIT_IDS.map((id) => redis.del(`ratelimit:finish:${id}`)));
});

describe("POST /api/queue/finish", () => {
  it("promotes the next waiting entry into confirming (QUEUE-14)", async () => {
    const ana = await (await join(joinRequest("Ana", "10.30.0.1"))).json();
    const bruno = await (await join(joinRequest("Bruno", "10.30.0.2"))).json();
    await confirmTurn(actionRequest("confirm-turn", ana.id, ana.sessionToken));

    const response = await finish(actionRequest("finish", ana.id, ana.sessionToken));
    expect(response.status).toBe(200);

    const state = await getState();
    expect(state.active?.id).toBe(bruno.id);
    expect(state.active?.phase).toBe("confirming");
    expect(state.waiting).toHaveLength(0);
  });

  it("leaves the queue empty when finishing as the last person (QUEUE-17)", async () => {
    const ana = await (await join(joinRequest("Ana", "10.30.0.3"))).json();
    await confirmTurn(actionRequest("confirm-turn", ana.id, ana.sessionToken));

    const response = await finish(actionRequest("finish", ana.id, ana.sessionToken));
    expect(response.status).toBe(200);

    const state = await getState();
    expect(state.active).toBeNull();
    expect(state.waiting).toHaveLength(0);
  });

  it("returns 404 when the id does not exist", async () => {
    const response = await finish(actionRequest("finish", "does-not-exist", "whatever"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("returns 403 when the sessionToken does not match", async () => {
    const ana = await (await join(joinRequest("Ana", "10.30.0.4"))).json();

    const response = await finish(actionRequest("finish", ana.id, "totally-wrong-token"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
  });

  it("returns 409 when finish is called before confirming the turn", async () => {
    const ana = await (await join(joinRequest("Ana", "10.30.0.5"))).json();
    expect(ana.view.self.phase).toBe("confirming");

    const response = await finish(actionRequest("finish", ana.id, ana.sessionToken));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBeTruthy();
  });

  it("returns 429 when the same id exceeds the finish rate limit", async () => {
    let lastResponse: Response | undefined;
    for (let i = 0; i < 11; i++) {
      lastResponse = await finish(actionRequest("finish", "rl-target", "irrelevant-token"));
    }

    expect(lastResponse!.status).toBe(429);
  });
});
