import * as webpushModule from "web-push";
import { buildNotificationPayload } from "./strategies";
import type { NotificationJob } from "./types";
import type { PushSubscriptionRecord } from "../queue/types";

function configureVapid(): typeof webpushModule {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

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
  const payload = JSON.stringify(buildNotificationPayload(job.scenario));

  const results = await Promise.allSettled(
    job.recipients.map((recipient) => push.sendNotification(recipient, payload)),
  );

  const invalidRecipients: PushSubscriptionRecord[] = [];

  results.forEach((result, index) => {
    if (result.status !== "rejected") {
      return;
    }
    if (isInvalidSubscriptionError(result.reason)) {
      invalidRecipients.push(job.recipients[index]);
    } else {
      console.error(
        `web-push delivery failed for scenario "${job.scenario}"`,
        result.reason,
      );
    }
  });

  return invalidRecipients;
}

/**
 * Dispatches every job, then hands the combined list of invalid (404/410)
 * recipient endpoints to the given prune callback, if any invalid endpoints
 * were found and a callback was provided. Never throws.
 */
export async function dispatchAll(
  jobs: NotificationJob[],
  pruneInvalidSubscriptions?: (invalidEndpoints: string[]) => void | Promise<void>,
): Promise<void> {
  try {
    const invalidLists = await Promise.all(jobs.map((job) => dispatchNotificationJob(job)));
    const invalidEndpoints = invalidLists.flat().map((recipient) => recipient.endpoint);

    if (invalidEndpoints.length > 0 && pruneInvalidSubscriptions) {
      await pruneInvalidSubscriptions(invalidEndpoints);
    }
  } catch (error) {
    console.error("dispatchAll failed", error);
  }
}
