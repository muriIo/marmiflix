import { randomUUID } from "node:crypto";
import { applyJoin } from "../../../../lib/queue/engine";
import { checkRateLimit } from "../../../../lib/queue/rate-limit";
import { generateSessionToken, hashToken } from "../../../../lib/queue/session";
import { withQueueMutation } from "../../../../lib/queue/store";
import { DuplicateNameError, ValidationError, type QueueState } from "../../../../lib/queue/types";
import { buildView } from "../../../../lib/queue/view";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(`join:${ip}`);
  if (!allowed) {
    return Response.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  let body: { name?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const name = typeof body.name === "string" ? body.name : "";

  const id = randomUUID();
  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashToken(sessionToken);

  let mutationResult: { state: QueueState; now: number };
  try {
    mutationResult = await withQueueMutation((state, now) => {
      const next = applyJoin(state, { id, name, sessionTokenHash }, now);
      return { next, result: { state: next, now } };
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DuplicateNameError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  const view = buildView(mutationResult.state, id, mutationResult.now);
  return Response.json({ id, sessionToken, view }, { status: 200 });
}
