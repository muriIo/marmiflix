import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { dispatchAll } from "../../../../lib/notifications/dispatcher";
import type { NotificationJob } from "../../../../lib/notifications/types";
import { applyJoin } from "../../../../lib/queue/engine";
import { checkRateLimit } from "../../../../lib/queue/rate-limit";
import { QueueBusyError, queueBusyResponse } from "../../../../lib/queue/route-helpers";
import { generateSessionToken, hashToken } from "../../../../lib/queue/session";
import { withQueueMutation } from "../../../../lib/queue/store";
import {
  DuplicateNameError,
  QueueFullError,
  ValidationError,
  type PushSubscriptionRecord,
  type QueueState,
} from "../../../../lib/queue/types";
import { buildView } from "../../../../lib/queue/view";

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
  const allowed = await checkRateLimit(`join:${ip}`);
  if (!allowed) {
    return Response.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  let body: {
    name?: unknown;
    subscription?: unknown;
    waitlistId?: unknown;
    waitlistToken?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const name = typeof body.name === "string" ? body.name : "";
  const pushSubscription = isValidSubscription(body.subscription) ? body.subscription : undefined;
  const waitlistId = typeof body.waitlistId === "string" ? body.waitlistId : undefined;
  const waitlistToken = typeof body.waitlistToken === "string" ? body.waitlistToken : undefined;
  const waitlistCredentials =
    waitlistId && waitlistToken
      ? { id: waitlistId, tokenHash: hashToken(waitlistToken) }
      : undefined;

  const id = randomUUID();
  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashToken(sessionToken);

  let mutationResult: { state: QueueState; now: number };
  let notificationJobs: NotificationJob[];
  try {
    ({ result: mutationResult, notificationJobs } = await withQueueMutation((state, now) => {
      const next = applyJoin(
        state,
        { id, name, sessionTokenHash, pushSubscription, waitlistCredentials },
        now,
      );
      return { next, result: { state: next, now } };
    }));
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DuplicateNameError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof QueueFullError) {
      return Response.json({ error: error.message, code: "QUEUE_FULL" }, { status: 409 });
    }
    if (error instanceof QueueBusyError) {
      return queueBusyResponse();
    }
    throw error;
  }

  // A join landing directly into the confirming phase (empty queue) produces
  // a turn-ready job addressed to the joiner's own subscription - but the
  // joiner already has their result in this very response, so they are not a
  // notification target for their own action. Filter that specific job out;
  // a turn-ready job for anyone else (e.g. a reap-driven promotion that
  // happened earlier in this same call) still targets a different active id
  // and is dispatched normally.
  const jobsToDispatch =
    mutationResult.state.active?.id === id
      ? notificationJobs.filter((job) => job.scenario !== "turn-ready")
      : notificationJobs;

  if (jobsToDispatch.length > 0) {
    after(() => dispatchAll(jobsToDispatch));
  }

  const view = buildView(mutationResult.state, id, mutationResult.now);
  return Response.json({ id, sessionToken, view }, { status: 200 });
}
