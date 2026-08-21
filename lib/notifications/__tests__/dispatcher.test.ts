import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSubscriptionRecord } from "../../queue/types";
import type { NotificationJob, NotificationScenario } from "../types";

const SCENARIOS: NotificationScenario[] = [
  "turn-ready",
  "heating-ended",
  "confirm-finish-ending",
  "seat-opened",
];

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
}));

async function importDispatcher() {
  return await import("../dispatcher");
}

function makeSubscription(suffix: string): PushSubscriptionRecord {
  return {
    endpoint: `https://push.example/${suffix}`,
    keys: { p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` },
  };
}

beforeEach(() => {
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  sendNotification.mockReset();
  setVapidDetails.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dispatchNotificationJob", () => {
  it("calls webpush.sendNotification once per recipient with the strategy-built payload as JSON", async () => {
    const { dispatchNotificationJob } = await importDispatcher();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const recipients = [makeSubscription("a"), makeSubscription("b")];
    const job: NotificationJob = { scenario: "turn-ready", recipients };

    await dispatchNotificationJob(job);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [firstRecipientArg, firstPayloadArg] = sendNotification.mock.calls[0];
    expect(firstRecipientArg).toEqual(recipients[0]);
    const parsedPayload = JSON.parse(firstPayloadArg as string);
    expect(parsedPayload.scenario).toBe(job.scenario);
    expect(typeof parsedPayload.title).toBe("string");
    expect(parsedPayload.title.length).toBeGreaterThan(0);
    expect(typeof parsedPayload.body).toBe("string");
  });

  it.each(SCENARIOS)(
    "includes scenario %s in the serialized payload sent to sendNotification (NOTIF-23)",
    async (scenario) => {
      const { dispatchNotificationJob } = await importDispatcher();
      sendNotification.mockResolvedValue({ statusCode: 201 });

      const recipient = makeSubscription("scenario-check");
      await dispatchNotificationJob({ scenario, recipients: [recipient] });

      const [, payloadArg] = sendNotification.mock.calls[0];
      const parsedPayload = JSON.parse(payloadArg as string);
      expect(parsedPayload.scenario).toBe(scenario);
    },
  );

  it("returns a recipient whose sendNotification rejection carries statusCode 410 as invalid", async () => {
    const { dispatchNotificationJob } = await importDispatcher();
    const recipient = makeSubscription("expired");
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );

    const invalid = await dispatchNotificationJob({
      scenario: "turn-ready",
      recipients: [recipient],
    });

    expect(invalid).toEqual([recipient]);
  });

  it("returns a recipient whose sendNotification rejection carries statusCode 404 as invalid", async () => {
    const { dispatchNotificationJob } = await importDispatcher();
    const recipient = makeSubscription("missing");
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    );

    const invalid = await dispatchNotificationJob({
      scenario: "turn-ready",
      recipients: [recipient],
    });

    expect(invalid).toEqual([recipient]);
  });

  it("swallows a statusCode 500 rejection: not returned as invalid, and does not throw", async () => {
    const { dispatchNotificationJob } = await importDispatcher();
    const recipient = makeSubscription("server-error");
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Internal Server Error"), { statusCode: 500 }),
    );

    const invalid = await dispatchNotificationJob({
      scenario: "turn-ready",
      recipients: [recipient],
    });

    expect(invalid).toEqual([]);
  });
});

describe("dispatchAll", () => {
  it("never rejects even when every recipient fails", async () => {
    const { dispatchAll } = await importDispatcher();
    sendNotification.mockRejectedValue(
      Object.assign(new Error("Internal Server Error"), { statusCode: 500 }),
    );

    const jobs: NotificationJob[] = [
      { scenario: "turn-ready", recipients: [makeSubscription("x")] },
    ];

    await expect(dispatchAll(jobs)).resolves.toBeUndefined();
  });

  it("calls the provided prune callback with the combined invalid endpoints across jobs", async () => {
    const { dispatchAll } = await importDispatcher();
    const staleA = makeSubscription("stale-a");
    const staleB = makeSubscription("stale-b");
    sendNotification.mockImplementation((recipient: PushSubscriptionRecord) => {
      if (recipient.endpoint === staleA.endpoint || recipient.endpoint === staleB.endpoint) {
        return Promise.reject(Object.assign(new Error("Gone"), { statusCode: 410 }));
      }
      return Promise.resolve({ statusCode: 201 });
    });

    const jobs: NotificationJob[] = [
      { scenario: "turn-ready", recipients: [staleA] },
      { scenario: "seat-opened", recipients: [staleB, makeSubscription("healthy")] },
    ];

    const pruneInvalidSubscriptions = vi.fn();
    await dispatchAll(jobs, pruneInvalidSubscriptions);

    expect(pruneInvalidSubscriptions).toHaveBeenCalledTimes(1);
    const [invalidEndpoints] = pruneInvalidSubscriptions.mock.calls[0];
    expect(new Set(invalidEndpoints)).toEqual(new Set([staleA.endpoint, staleB.endpoint]));
  });

  it("does not call the prune callback when no recipient is invalid", async () => {
    const { dispatchAll } = await importDispatcher();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const jobs: NotificationJob[] = [
      { scenario: "turn-ready", recipients: [makeSubscription("healthy")] },
    ];

    const pruneInvalidSubscriptions = vi.fn();
    await dispatchAll(jobs, pruneInvalidSubscriptions);

    expect(pruneInvalidSubscriptions).not.toHaveBeenCalled();
  });
});
