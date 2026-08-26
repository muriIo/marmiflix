// Marmiflix push-handling service worker.
//
// Source for the compiled public/sw.js - run `npm run build:sw` (wired as a
// pre-step to dev/build) to regenerate it. A service worker is its own
// execution context, isolated from the page: it has no `window`/`document`,
// can run with zero tabs open, and can't reach the page's already-initialized
// Sentry Next.js client (instrumentation-client.ts). That's exactly the
// scenario push exists for - a closed/backgrounded tab - so this worker
// carries its own standalone @sentry/browser init instead of relying on any
// relay to the main thread, which wouldn't be running in that scenario. See
// https://docs.sentry.io/platforms/javascript/best-practices/web-workers/'s
// "worker-level initialization" section: no shared scope/user/tags with the
// page's Sentry client, by design - this init only ever needs to describe
// what happened inside the worker.
//
// A plain static file can't read process.env at runtime, and the bundler
// (esbuild) also doesn't do NEXT_PUBLIC_ substitution the way Next.js's own
// webpack build does - so the DSN is a literal here. That's fine: a DSN
// identifies a Sentry project, it isn't a secret.
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "https://7efa6966d95e664265a599c10307bba3@o4511978373971968.ingest.us.sentry.io/4511978408902656",
  enableLogs: true,
  tracesSampleRate: 0,
});

type LogAttributes = Record<string, string | number | boolean | undefined>;

// Sentry.logger attributes only accept string/number/boolean - drop
// undefined entries instead of sending them.
function compactAttributes(attributes: LogAttributes): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

interface PushPayload {
  scenario?: string;
  title?: string;
  body?: string;
}

// Channel selection lives here, not on the server (see AD-002 / design.md):
// the server always pushes to every subscribed recipient when a scenario
// fires, and this handler is the one place that can check live focus state
// at the moment of delivery. A focused tab suppresses the OS notification
// (its own polling loop already plays the sound/vibration cue) and instead
// gets the payload relayed via postMessage - this is a no-op for the three
// scenarios a focused tab already self-handles via polling, and is exactly
// what components/queue/QueueFull.tsx needs for the fourth (seat-opened),
// since a waitlisted visitor has no queue entry to poll for.
self.addEventListener("push", (event: PushEvent) => {
  let data: PushPayload = {};
  let parseError: string | undefined;
  if (event.data) {
    try {
      data = event.data.json() as PushPayload;
    } catch (error) {
      parseError = String(error);
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

      Sentry.logger.info(
        "sw_push_received",
        compactAttributes({
          scenario: data.scenario,
          parseError,
          focusedClients: focused.length,
          totalClients: clientList.length,
        }),
      );

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

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        await client.focus();
        return;
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow("/");
      }
    })(),
  );
});
