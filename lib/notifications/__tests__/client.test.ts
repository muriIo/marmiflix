// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPushSubscription } from "../client";

const ORIGINAL_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
// A real VAPID public key is a base64url-encoded uncompressed EC point - any
// base64url string works for this test's purposes, as long as it decodes
// cleanly (unpadded base64url is only ever valid at length % 4 of 0, 2, or 3).
const FAKE_VAPID_KEY = Buffer.from("fake-vapid-public-key-bytes").toString("base64url");

function stubServiceWorkerSupport(options: {
  requestPermission: () => Promise<NotificationPermission>;
  subscribe?: () => Promise<unknown>;
}) {
  const subscribe =
    options.subscribe ??
    (() =>
      Promise.resolve({
        toJSON: () => ({
          endpoint: "https://push.example/abc123",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        }),
      }));

  const register = vi.fn().mockResolvedValue({
    pushManager: { subscribe },
  });

  Object.defineProperty(window.navigator, "serviceWorker", {
    value: { register },
    configurable: true,
  });
  Object.defineProperty(window, "PushManager", {
    value: class {},
    configurable: true,
  });
  Object.defineProperty(window, "Notification", {
    value: { requestPermission: options.requestPermission },
    configurable: true,
  });

  return { register };
}

function removeServiceWorkerSupport() {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(window, "Notification");
}

describe("requestPushSubscription (NOTIF-03, NOTIF-28)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = FAKE_VAPID_KEY;
  });

  afterEach(() => {
    removeServiceWorkerSupport();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = ORIGINAL_VAPID_KEY;
    vi.restoreAllMocks();
  });

  it("returns null (never throws) when serviceWorker/PushManager/Notification are unsupported", async () => {
    removeServiceWorkerSupport();

    await expect(requestPushSubscription()).resolves.toBeNull();
  });

  it("returns null when the permission prompt is denied", async () => {
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("denied") });

    await expect(requestPushSubscription()).resolves.toBeNull();
  });

  it("returns a PushSubscriptionRecord-shaped object on the granted/success path", async () => {
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("granted") });

    const result = await requestPushSubscription();

    expect(result).toEqual({
      endpoint: "https://push.example/abc123",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
  });

  it("returns null when NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset", async () => {
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("granted") });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    await expect(requestPushSubscription()).resolves.toBeNull();
  });
});
