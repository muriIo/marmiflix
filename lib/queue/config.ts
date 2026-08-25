// Waiting-related timings, overridable via env vars (in seconds) so ops can
// retune them without a rebuild - just a redeploy/restart with new env vars.
function secondsFromString(raw: string | undefined, defaultSeconds: number): number {
  if (!raw) {
    return defaultSeconds;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultSeconds;
  }
  return parsed;
}

function secondsFromEnv(name: string, defaultSeconds: number): number {
  return secondsFromString(process.env[name], defaultSeconds);
}

export const CONFIRM_WINDOW_MS =
  secondsFromEnv("QUEUE_CONFIRM_WINDOW_SECONDS", 60) * 1000;

export const HEATING_NOMINAL_MS =
  secondsFromEnv("QUEUE_HEATING_NOMINAL_SECONDS", 300) * 1000;

export const HEATING_URGENCY_MS =
  secondsFromEnv("QUEUE_HEATING_URGENCY_SECONDS", 30) * 1000;

export const PER_PERSON_WAIT_MS =
  secondsFromEnv("QUEUE_PER_PERSON_WAIT_SECONDS", 300) * 1000;

// IDLE-02: read client-side (the idle-standby screen's timeout). This can't
// reuse `secondsFromEnv("NEXT_PUBLIC_...", 180)` above - Next.js only inlines
// a NEXT_PUBLIC_ var into the client bundle when it appears as a literal
// `process.env.NEXT_PUBLIC_X` expression at build time; `secondsFromEnv`'s
// dynamic `process.env[name]` lookup can't be statically analyzed, so that
// path would silently always fall back to the default in production. Calling
// `secondsFromString` directly keeps the one literal access this needs while
// still sharing all the parsing/validation logic with `secondsFromEnv` above -
// changing this value needs a rebuild, not just a redeploy/restart.
export const IDLE_TIMEOUT_MS =
  secondsFromString(process.env.NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS, 180) * 1000;

// Redis (queue state store) and Web Push / VAPID (queue-notifications
// feature), server-side. Functions, not plain consts like IDLE_TIMEOUT_MS
// above: a top-level const snapshots process.env once, at whichever moment
// this module first happens to load - in dispatcher.integration.test.ts,
// that's the file's static `import { redis } from "../../queue/redis-client"`
// at parse time, BEFORE the first test's `beforeEach` stubs VAPID_SUBJECT
// etc. (only `afterEach`'s vi.resetModules() forces a fresh read, so a const
// would come back correct from the second test onward but wrongly undefined
// on the first). A function sidesteps that ordering entirely by reading
// process.env live on every call. Deliberately unvalidated here - presence
// is checked and thrown on lazily, on first real use rather than on import,
// by lib/queue/redis-client.ts and lib/notifications/dispatcher.ts, so
// `next build`'s page-data collection step (which imports every route module
// transitively) doesn't fail without production secrets present at build
// time.
export function upstashRedisRestUrl(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_URL;
}

export function upstashRedisRestToken(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_TOKEN;
}

export function vapidSubject(): string | undefined {
  return process.env.VAPID_SUBJECT;
}

export function vapidPublicKey(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY;
}

export function vapidPrivateKey(): string | undefined {
  return process.env.VAPID_PRIVATE_KEY;
}

// Web Push / VAPID public key, client-side (lib/notifications/client.ts).
// Same live-read reasoning as above - client.test.ts also mutates
// process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY directly per test. Safe to sit in
// a module also imported by server code: everything above this line is a
// real secret, but Next.js's client bundler only ever inlines NEXT_PUBLIC_-
// prefixed vars with their real value - any other reference in client-bundled
// code resolves to undefined, so this file can't leak VAPID_PRIVATE_KEY etc.
// to the browser just by being imported from a client component.
export function nextPublicVapidPublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}
