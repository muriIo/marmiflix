import { nextPublicVapidPublicKey } from "../queue/config";
import type { PushSubscriptionRecord } from "../queue/types";

// Standard Push API ecosystem helper (MDN / web.dev): a VAPID application
// server key is base64url-encoded, but PushManager.subscribe() wants raw
// bytes.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Every early-exit and failure path below used to collapse into a bare
// `null`, indistinguishable from every other reason a caller saw no
// subscription. Logging the reason (browser console today; wire to a real
// client-error sink later if it proves useful) is what lets "notification
// never fired" reports be told apart: never granted, unsupported browser,
// missing server config, vs. subscribe() itself throwing.
function logSubscriptionOutcome(reason: string, detail?: unknown): void {
  console.log(JSON.stringify({ event: "push_subscription_outcome", reason, detail: String(detail ?? "") }));
}

/**
 * Registers the service worker and requests a push subscription, tied to the
 * caller's own gesture (never invoked on page load - see context.md's
 * permission-trigger decision). Never throws: any unsupported browser,
 * denied permission, or missing server config degrades to `null`, and the
 * caller proceeds without a push subscription (design.md's Error Handling
 * Strategy - this is an optional enhancement, not a blocking requirement).
 */
export async function requestPushSubscription(): Promise<PushSubscriptionRecord | null> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof window === "undefined" ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    logSubscriptionOutcome("unsupported");
    return null;
  }

  const vapidPublicKey = nextPublicVapidPublicKey();
  if (!vapidPublicKey) {
    logSubscriptionOutcome("vapid_key_missing");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      logSubscriptionOutcome("permission_denied", permission);
      return null;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    logSubscriptionOutcome("subscribed");
    return subscription.toJSON() as unknown as PushSubscriptionRecord;
  } catch (error) {
    logSubscriptionOutcome("subscribe_failed", error instanceof Error ? error.message : error);
    return null;
  }
}
