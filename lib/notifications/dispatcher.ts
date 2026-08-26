import * as Sentry from "@sentry/nextjs";
import * as webpushModule from "web-push";
import { buildNotificationPayload } from "./strategies";
import type { NotificationJob } from "./types";
import { applyPruneSubscriptions } from "../queue/engine";
import { vapidPrivateKey, vapidPublicKey, vapidSubject } from "../queue/config";
import { withQueueMutation } from "../queue/store";
import type { PushSubscriptionRecord } from "../queue/types";

function configureVapid(): typeof webpushModule {
  const subject = vapidSubject();
  const publicKey = vapidPublicKey();
  const privateKey = vapidPrivateKey();

  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "Missing VAPID_SUBJECT, VAPID_PUBLIC_KEY, or VAPID_PRIVATE_KEY environment variable. See .env.example for where to get these values.",
    );
  }

  webpushModule.setVapidDetails(subject, publicKey, privateKey);
  return webpushModule;
}

let configured: typeof webpushModule | undefined;

function getWebPush(): typeof webpushModule {
  if (!configured) {
    configured = configureVapid();
  }
  return configured;
}

// Lazy proxy: importing this module must NOT require the VAPID env vars to be
// present, only actually calling a web-push method does - mirrors
// lib/queue/redis-client.ts's proxy so a missing env var doesn't break
// next build's page-data collection step.
const push = new Proxy({} as typeof webpushModule, {
  get(_target, prop) {
    const real = getWebPush();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

function isInvalidSubscriptionError(reason: unknown): boolean {
  const statusCode = (reason as { statusCode?: number } | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

// Structured Sentry logs for diagnosing "notification didn't fire" reports -
// console.error alone gave no way to tell a VAPID misconfig apart from
// expired subscriptions apart from genuine delivery failures. Endpoint is
// truncated (it's a push-service URL, not a secret, but still identifying)
// to a short suffix - enough to correlate repeat failures without logging it
// in full. Sentry.logger.* is a no-op until enableLogs: true is set in the
// runtime's init (sentry.server.config.ts for this module) - never throws
// either way, so this is safe to call unconditionally.
function endpointSuffix(endpoint: string): string {
  return endpoint.slice(-12);
}

type LogAttributes = Record<string, string | number | boolean | undefined>;

// Sentry.logger attributes only accept string/number/boolean - drop
// undefined entries (e.g. a rejection reason with no statusCode) instead of
// sending them and having the SDK silently discard the whole attribute.
function compactAttributes(attributes: LogAttributes): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Sends one notification job to every recipient, in parallel, tolerating
 * individual failures. Returns the subset of recipients whose subscription
 * came back 404/410 (expired/invalid), for the caller to prune. Never
 * rejects - an unexpected delivery failure (5xx, network error, missing
 * VAPID config) is logged and otherwise swallowed.
 */
export async function dispatchNotificationJob(
  job: NotificationJob,
): Promise<PushSubscriptionRecord[]> {
  const payload = JSON.stringify({
    scenario: job.scenario,
    ...buildNotificationPayload(job.scenario),
  });

  const results = await Promise.allSettled(
    job.recipients.map((recipient) => push.sendNotification(recipient, payload)),
  );

  const invalidRecipients: PushSubscriptionRecord[] = [];
  let delivered = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status !== "rejected") {
      delivered += 1;
      return;
    }
    if (isInvalidSubscriptionError(result.reason)) {
      invalidRecipients.push(job.recipients[index]);
    } else {
      failed += 1;
      const reason = result.reason as { statusCode?: number; message?: string } | undefined;
      Sentry.logger.warn(
        "notification_delivery_failed",
        compactAttributes({
          scenario: job.scenario,
          endpoint: endpointSuffix(job.recipients[index].endpoint),
          statusCode: reason?.statusCode,
          message: reason?.message,
        }),
      );
    }
  });

  Sentry.logger.info("notification_dispatch", {
    scenario: job.scenario,
    recipients: job.recipients.length,
    delivered,
    invalid: invalidRecipients.length,
    failed,
  });

  return invalidRecipients;
}

// Default prune step: discards every 404/410 endpoint from QueueState (active,
// waiting, and seatWaitlist entries) via the same CAS mutation path as every
// other state change. Every dispatchAll call site gets this "for free" unless
// it supplies its own pruneInvalidSubscriptions callback (e.g. in tests).
async function pruneInvalidSubscriptionsFromState(invalidEndpoints: string[]): Promise<void> {
  await withQueueMutation((state) => ({
    next: applyPruneSubscriptions(state, invalidEndpoints),
    result: null,
  }));
}

/**
 * Dispatches every job, then hands the combined list of invalid (404/410)
 * recipient endpoints to the given prune callback (defaulting to discarding
 * them from QueueState), if any invalid endpoints were found. Never throws.
 */
export async function dispatchAll(
  jobs: NotificationJob[],
  pruneInvalidSubscriptions: (
    invalidEndpoints: string[],
  ) => void | Promise<void> = pruneInvalidSubscriptionsFromState,
): Promise<void> {
  try {
    const invalidLists = await Promise.all(jobs.map((job) => dispatchNotificationJob(job)));
    const invalidEndpoints = invalidLists.flat().map((recipient) => recipient.endpoint);

    if (invalidEndpoints.length > 0) {
      await pruneInvalidSubscriptions(invalidEndpoints);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.includes("VAPID") ? "vapid_not_configured" : "unexpected_error";
    Sentry.logger.error("notification_dispatch_error", {
      scenarios: jobs.map((job) => job.scenario).join(","),
      reason,
      message,
    });
    // A whole dispatch batch failing (not just one recipient) is unexpected
    // and actionable - captured as an issue too, not just a log line, so it
    // actually pages/alerts instead of requiring someone to go searching logs.
    Sentry.captureException(error instanceof Error ? error : new Error(message), {
      tags: { reason },
    });
  }
}
