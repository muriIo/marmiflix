// Marmiflix push-handling service worker.
//
// Channel selection lives here, not on the server (see AD-002 / design.md):
// the server always pushes to every subscribed recipient when a scenario
// fires, and this handler is the one place that can check live focus state
// at the moment of delivery. A focused tab suppresses the OS notification
// (its own polling loop already plays the sound/vibration cue) and instead
// gets the payload relayed via postMessage - this is a no-op for the three
// scenarios a focused tab already self-handles via polling, and is exactly
// what components/queue/QueueFull.tsx needs for the fourth (seat-opened),
// since a waitlisted visitor has no queue entry to poll for.
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = {};
    }
  }

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = clientList.filter((client) => client.focused);

      if (focused.length > 0) {
        focused.forEach((client) => client.postMessage(data));
        return;
      }

      await self.registration.showNotification(data.title || "Marmiflix", {
        body: data.body,
        tag: data.scenario,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow("/");
      }
    })(),
  );
});
