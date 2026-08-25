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

// IDLE-02: read client-side (the idle-standby screen's timeout), so this
// needs the literal `process.env.NEXT_PUBLIC_...` form - Next.js inlines
// NEXT_PUBLIC_ vars into the client bundle at BUILD time via static text
// substitution, which only works on a literal member expression, not the
// dynamic `process.env[name]` lookup `secondsFromEnv` uses above. Changing
// this one needs a rebuild, not just a redeploy/restart.
export const IDLE_TIMEOUT_MS =
  secondsFromString(process.env.NEXT_PUBLIC_QUEUE_IDLE_TIMEOUT_SECONDS, 180) * 1000;
