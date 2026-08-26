"use client";

import { useEffect, useState } from "react";

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function useNotificationPermission(): NotificationPermissionState {
  // Starts at "unsupported" on every render, server included, so the first
  // client render matches the server-rendered markup exactly; the real
  // value (which only exists in the browser) is read after mount instead,
  // avoiding a hydration mismatch.
  const [permission, setPermission] = useState<NotificationPermissionState>("unsupported");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }
    setPermission(Notification.permission);

    const handleChange = () => setPermission(Notification.permission);

    // The Permissions API lets us react when the visitor flips the setting
    // from the browser's own site-settings UI, without a page reload -
    // Notification.permission alone has no change event of its own.
    let permissionStatus: PermissionStatus | undefined;
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((status) => {
        permissionStatus = status;
        status.addEventListener("change", handleChange);
      })
      .catch(() => {});

    return () => {
      permissionStatus?.removeEventListener("change", handleChange);
    };
  }, []);

  return permission;
}
