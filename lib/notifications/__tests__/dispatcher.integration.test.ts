import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_STATE_KEY, getState } from "../../queue/store";
import { redis } from "../../queue/redis-client";
import type { PushSubscriptionRecord, QueueState } from "../../queue/types";
import type { NotificationJob } from "../types";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
}));

async function importDispatcher() {
  return await import("../dispatcher");
}

function subscription(suffix: string): PushSubscriptionRecord {
  return {
    endpoint: `https://push.example/${suffix}`,
    keys: { p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` },
  };
}

beforeEach(async () => {
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  await redis.del(QUEUE_STATE_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Fix 4 / spec Edge Case: "a rejected/invalid subscription is discarded
// rather than retried". T31 wires dispatchAll's default prune step to
// actually persist the removal in QueueState via withQueueMutation, instead
// of being a dead optional callback. These tests exercise that wiring
// end-to-end against real Redis, mocking only the web-push transport.
describe("dispatchAll - default subscription pruning persists to QueueState (spec Edge Case, T31)", () => {
  it("removes an active entry's pushSubscription after its recipient rejects with statusCode 410", async () => {
    const invalid = subscription("active-invalid");
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: Date.now() - 1000,
        deadline: Date.now() + 300_000,
        pushSubscription: invalid,
      },
      waiting: [],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);
    sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));

    const { dispatchAll } = await importDispatcher();
    const jobs: NotificationJob[] = [{ scenario: "heating-ended", recipients: [invalid] }];
    await dispatchAll(jobs);

    const state = await getState();
    expect(state.active?.pushSubscription).toBeUndefined();
  });

  it("removes a matching seatWaitlist entry after its recipient rejects with statusCode 404", async () => {
    const invalid = subscription("waitlist-invalid");
    const seeded: QueueState = {
      version: 1,
      active: null,
      waiting: [],
      seatWaitlist: [
        { id: "wl1", tokenHash: "hash-wl1", subscription: invalid, registeredAt: Date.now() - 1000 },
      ],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);
    sendNotification.mockRejectedValue(Object.assign(new Error("Not Found"), { statusCode: 404 }));

    const { dispatchAll } = await importDispatcher();
    const jobs: NotificationJob[] = [{ scenario: "seat-opened", recipients: [invalid] }];
    await dispatchAll(jobs);

    const state = await getState();
    expect(state.seatWaitlist.find((entry) => entry.id === "wl1")).toBeUndefined();
  });

  it("prunes only the invalid recipient's subscription, leaving a healthy recipient's delivery and stored subscription untouched", async () => {
    const healthy = subscription("healthy-active");
    const invalid = subscription("invalid-waiting");
    const seeded: QueueState = {
      version: 1,
      active: {
        id: "a1",
        name: "Ana",
        sessionTokenHash: "hash-a1",
        phase: "heating",
        phaseStartedAt: Date.now() - 1000,
        deadline: Date.now() + 300_000,
        pushSubscription: healthy,
      },
      waiting: [
        {
          id: "b1",
          name: "Bruno",
          sessionTokenHash: "hash-b1",
          joinedAt: Date.now() - 500,
          pushSubscription: invalid,
        },
      ],
      seatWaitlist: [],
    };
    await redis.set(QUEUE_STATE_KEY, seeded);
    sendNotification.mockImplementation((recipient: PushSubscriptionRecord) => {
      if (recipient.endpoint === invalid.endpoint) {
        return Promise.reject(Object.assign(new Error("Gone"), { statusCode: 410 }));
      }
      return Promise.resolve({ statusCode: 201 });
    });

    const { dispatchAll } = await importDispatcher();
    const jobs: NotificationJob[] = [
      { scenario: "heating-ended", recipients: [healthy, invalid] },
    ];
    await dispatchAll(jobs);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const state = await getState();
    expect(state.active?.pushSubscription).toEqual(healthy);
    expect(state.waiting[0].pushSubscription).toBeUndefined();
  });
});
