import { randomUUID } from "node:crypto";
import { checkRateLimit } from "../../../../../lib/queue/rate-limit";
import { QueueBusyError, queueBusyResponse } from "../../../../../lib/queue/route-helpers";
import { generateSessionToken, hashToken } from "../../../../../lib/queue/session";
import { withQueueMutation } from "../../../../../lib/queue/store";
import type { PushSubscriptionRecord } from "../../../../../lib/queue/types";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

function isValidSubscription(value: unknown): value is PushSubscriptionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.endpoint !== "string") {
    return false;
  }
  if (!record.keys || typeof record.keys !== "object") {
    return false;
  }
  const keys = record.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const allowed = await checkRateLimit(`waitlist-join:${ip}`);
  if (!allowed) {
    return Response.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  let body: { subscription?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!isValidSubscription(body.subscription)) {
    return Response.json({ error: "Malformed subscription" }, { status: 400 });
  }
  const subscription = body.subscription;

  const id = randomUUID();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);

  try {
    await withQueueMutation((state, now) => {
      const next = {
        ...state,
        seatWaitlist: [
          ...state.seatWaitlist,
          { id, tokenHash, subscription, registeredAt: now },
        ],
      };
      return { next, result: next };
    });
  } catch (error) {
    if (error instanceof QueueBusyError) {
      return queueBusyResponse();
    }
    throw error;
  }

  return Response.json({ id, token }, { status: 200 });
}
