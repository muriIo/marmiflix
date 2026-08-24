// Waiting-related timings, overridable via env vars (in seconds) so ops can
// retune them without a rebuild - just a redeploy/restart with new env vars.
function secondsFromEnv(name: string, defaultSeconds: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultSeconds;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultSeconds;
  }
  return parsed;
}

export const CONFIRM_WINDOW_MS =
  secondsFromEnv("QUEUE_CONFIRM_WINDOW_SECONDS", 60) * 1000;

export const HEATING_NOMINAL_MS =
  secondsFromEnv("QUEUE_HEATING_NOMINAL_SECONDS", 300) * 1000;

export const HEATING_URGENCY_MS =
  secondsFromEnv("QUEUE_HEATING_URGENCY_SECONDS", 30) * 1000;

export const PER_PERSON_WAIT_MS =
  secondsFromEnv("QUEUE_PER_PERSON_WAIT_SECONDS", 300) * 1000;
