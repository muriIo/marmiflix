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
    return null;
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return null;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    return subscription.toJSON() as unknown as PushSubscriptionRecord;
  } catch {
    return null;
  }
}
