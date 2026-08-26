// @vitest-environment jsdom
import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPushSubscription } from "../client";

const ORIGINAL_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
// A real VAPID public key is a base64url-encoded uncompressed EC point - any
// base64url string works for this test's purposes, as long as it decodes
// cleanly (unpadded base64url is only ever valid at length % 4 of 0, 2, or 3).
const FAKE_VAPID_KEY = Buffer.from("fake-vapid-public-key-bytes").toString("base64url");

type StubRegistration = { pushManager: { subscribe: () => Promise<unknown> } };

function stubServiceWorkerSupport(options: {
  requestPermission: () => Promise<NotificationPermission>;
  subscribe?: () => Promise<unknown>;
  // What navigator.serviceWorker.ready resolves to - defaults to the same
  // registration register() returns, i.e. already active (no added delay),
  // so existing callers of this helper are unaffected by the ready wait.
  ready?: Promise<StubRegistration>;
  // When set, register() rejects with this instead of resolving - the
  // existing catch-all path, unaffected by this feature's wait-for-ready
  // step (which never runs if register() itself never resolves).
  registerError?: Error;
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

  const registration: StubRegistration = { pushManager: { subscribe } };
  const register = options.registerError
    ? vi.fn().mockRejectedValue(options.registerError)
    : vi.fn().mockResolvedValue(registration);
  const ready = options.ready ?? Promise.resolve(registration);

  Object.defineProperty(window.navigator, "serviceWorker", {
    value: { register, ready },
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

  it("returns null (never throws) when serviceWorker/PushManager/Notification are unsupported, logging reason=unsupported at info (SWREADY-05)", async () => {
    const loggerInfoSpy = vi.spyOn(Sentry.logger, "info");
    removeServiceWorkerSupport();

    await expect(requestPushSubscription()).resolves.toBeNull();
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "unsupported" }),
    );
  });

  it("returns null when the permission prompt is denied, logging reason=permission_denied at info (SWREADY-05)", async () => {
    const loggerInfoSpy = vi.spyOn(Sentry.logger, "info");
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("denied") });

    await expect(requestPushSubscription()).resolves.toBeNull();
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "permission_denied", detail: "denied" }),
    );
  });

  it("returns a PushSubscriptionRecord-shaped object on the granted/success path, logging reason=subscribed at info (SWREADY-05)", async () => {
    const loggerInfoSpy = vi.spyOn(Sentry.logger, "info");
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("granted") });

    const result = await requestPushSubscription();

    expect(result).toEqual({
      endpoint: "https://push.example/abc123",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "subscribed" }),
    );
  });

  it("returns null when NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset, logging reason=vapid_key_missing at warn (SWREADY-05)", async () => {
    const loggerWarnSpy = vi.spyOn(Sentry.logger, "warn");
    stubServiceWorkerSupport({ requestPermission: () => Promise.resolve("granted") });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    await expect(requestPushSubscription()).resolves.toBeNull();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "vapid_key_missing" }),
    );
  });

  it("returns null and logs subscribe_failed if register() itself rejects (spec.md Edge Case, unaffected by this feature)", async () => {
    const loggerErrorSpy = vi.spyOn(Sentry.logger, "error");
    const registerError = new Error("SW registration failed: network error");
    stubServiceWorkerSupport({
      requestPermission: () => Promise.resolve("granted"),
      registerError,
    });

    const result = await requestPushSubscription();

    expect(result).toBeNull();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "subscribe_failed", detail: registerError.message }),
    );
  });

  it("still calls subscribe() when the registration becomes active just before the 10s timeout (spec.md Edge Case, no off-by-one)", async () => {
    vi.useFakeTimers();
    try {
      const subscribe = vi.fn().mockResolvedValue({
        toJSON: () => ({
          endpoint: "https://push.example/near-boundary",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        }),
      });
      let resolveReady: (registration: StubRegistration) => void = () => {};
      const readyPromise = new Promise<StubRegistration>((resolve) => {
        resolveReady = resolve;
      });

      stubServiceWorkerSupport({
        requestPermission: () => Promise.resolve("granted"),
        ready: readyPromise,
      });

      const resultPromise = requestPushSubscription();

      // Advance to 1ms before the timeout, then resolve ready - the timer
      // must not have fired yet, so subscribe() should still be reachable.
      await vi.advanceTimersByTimeAsync(9_999);
      resolveReady({ pushManager: { subscribe } });
      await vi.advanceTimersByTimeAsync(1);

      const result = await resultPromise;
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        endpoint: "https://push.example/near-boundary",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the service worker registration to become active before calling subscribe (SWREADY-01, SWREADY-02)", async () => {
    vi.useFakeTimers();
    try {
      const subscribe = vi.fn().mockResolvedValue({
        toJSON: () => ({
          endpoint: "https://push.example/delayed-ready",
          keys: { p256dh: "p256dh-key", auth: "auth-key" },
        }),
      });
      let resolveReady: (registration: StubRegistration) => void = () => {};
      const readyPromise = new Promise<StubRegistration>((resolve) => {
        resolveReady = resolve;
      });

      stubServiceWorkerSupport({
        requestPermission: () => Promise.resolve("granted"),
        ready: readyPromise,
      });

      const resultPromise = requestPushSubscription();

      // Let register()/requestPermission() settle - subscribe must not have
      // been called yet, since the registration isn't active.
      await vi.advanceTimersByTimeAsync(0);
      expect(subscribe).not.toHaveBeenCalled();

      // The registration becomes active, well within the timeout window.
      resolveReady({ pushManager: { subscribe } });
      await vi.advanceTimersByTimeAsync(0);

      const result = await resultPromise;
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        endpoint: "https://push.example/delayed-ready",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null and logs subscribe_failed if subscribe() still throws once the registration is active (SWREADY-04)", async () => {
    const loggerErrorSpy = vi.spyOn(Sentry.logger, "error");
    const subscribeError = new Error("NotAllowedError: subscribe failed");
    const subscribe = vi.fn().mockRejectedValue(subscribeError);

    stubServiceWorkerSupport({
      requestPermission: () => Promise.resolve("granted"),
      subscribe,
    });

    const result = await requestPushSubscription();

    expect(result).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "push_subscription_outcome",
      expect.objectContaining({ reason: "subscribe_failed", detail: subscribeError.message }),
    );
  });

  it("times out after 10s if the service worker never becomes active, logging sw_not_ready and never calling subscribe (SWREADY-03)", async () => {
    vi.useFakeTimers();
    try {
      const loggerErrorSpy = vi.spyOn(Sentry.logger, "error");
      const subscribe = vi.fn();
      const neverResolvingReady = new Promise<StubRegistration>(() => {});

      stubServiceWorkerSupport({
        requestPermission: () => Promise.resolve("granted"),
        subscribe,
        ready: neverResolvingReady,
      });

      const resultPromise = requestPushSubscription();

      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;
      expect(result).toBeNull();
      expect(subscribe).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "push_subscription_outcome",
        expect.objectContaining({ reason: "sw_not_ready" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
