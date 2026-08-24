import { redis } from "./redis-client";
import { MAX_QUEUE_SEATS, applyHeatingCheckpoints, reapExpired } from "./engine";
import { QueueBusyError, type QueueState } from "./types";
import type { NotificationJob } from "../notifications/types";

const QUEUE_STATE_KEY = "queue:state";

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local currentVersion = "0"
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded.version then currentVersion = tostring(decoded.version) end
end
if currentVersion == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
else
  return 0
end
`;

function emptyState(): QueueState {
  return { version: 0, active: null, waiting: [], seatWaitlist: [] };
}

export async function getState(): Promise<QueueState> {
  const raw = await redis.get<QueueState>(QUEUE_STATE_KEY);
  return raw ?? emptyState();
}

export async function casWrite(
  key: string,
  expectedVersion: number,
  next: QueueState,
): Promise<boolean> {
  const result = await redis.eval(CAS_SCRIPT, [key], [String(expectedVersion), JSON.stringify(next)]);
  return result === 1;
}

const MAX_MUTATION_ATTEMPTS = 5;

function randomBackoffMs(): number {
  return Math.floor(Math.random() * 20) + 5; // 5-25ms
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Indirection object so tests can deterministically force CAS failure (e.g. via
// vi.spyOn(storeInternals, 'casWrite')) without racing real concurrent writers.
export const storeInternals = { getState, casWrite };

function seatCount(state: QueueState): number {
  return (state.active ? 1 : 0) + state.waiting.length;
}

// Maps any heating checkpoints that fired during this mutation (before `mutate`
// ran) to notification jobs targeting the active entry's subscription. A
// checkpoint with no subscribed active entry produces no job at all.
function buildCheckpointJobs(
  checkpointed: QueueState,
  fired: ReturnType<typeof applyHeatingCheckpoints>["fired"],
): NotificationJob[] {
  const subscription = checkpointed.active?.pushSubscription;
  if (!subscription) {
    return [];
  }
  return fired.map((scenario) => ({ scenario, recipients: [subscription] }));
}

// A turn-ready job fires when the post-mutate state's active entry just
// entered the confirming phase (either a brand-new active entry, or the same
// entry transitioning into confirming) and that entry has a subscription.
// Compared against `before` - the state as durably read at the start of this
// call, prior to this call's own reap - so a reap-driven promotion that
// happens earlier in this same call is detected too, not just a promotion
// caused by the `mutate` callback itself.
function buildTurnReadyJob(before: QueueState, next: QueueState): NotificationJob | null {
  if (next.active?.phase !== "confirming") {
    return null;
  }

  const justBecameConfirming =
    before.active?.id !== next.active.id || before.active?.phase !== "confirming";
  if (!justBecameConfirming) {
    return null;
  }

  const subscription = next.active.pushSubscription;
  if (!subscription) {
    return null;
  }

  return { scenario: "turn-ready", recipients: [subscription] };
}

// A seat-opened broadcast fires when the mutation drops the combined
// active+waiting count from at-or-above the cap to below it, addressed to
// every current seat-waitlist subscriber. Compared against `before` for the
// same reason as buildTurnReadyJob - a reap-driven timeout can itself be
// what frees the seat, not just an explicit leave/finish mutation.
function buildSeatOpenedJob(before: QueueState, next: QueueState): NotificationJob | null {
  const wasFull = seatCount(before) >= MAX_QUEUE_SEATS;
  const isFullNow = seatCount(next) >= MAX_QUEUE_SEATS;
  if (!wasFull || isFullNow) {
    return null;
  }

  const recipients = next.seatWaitlist.map((entry) => entry.subscription);
  if (recipients.length === 0) {
    return null;
  }

  return { scenario: "seat-opened", recipients };
}

export async function withQueueMutation<T>(
  mutate: (state: QueueState, now: number) => { next: QueueState; result: T },
): Promise<{ result: T; notificationJobs: NotificationJob[] }> {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt++) {
    const now = Date.now();
    const current = await storeInternals.getState();
    const reaped = reapExpired(current, now);
    const { state: checkpointed, fired } = applyHeatingCheckpoints(reaped, now);
    const { next, result } = mutate(checkpointed, now);

    // True no-op (e.g. a GET poll with nothing to reap and no mutation of its
    // own): skip the CAS write entirely instead of bumping the version - and
    // contending for the lock - on every idle poll. reapExpired/
    // applyHeatingCheckpoints return the same reference when they don't
    // change anything, so `next === current` here means nothing at all
    // changed across the whole call.
    if (next === current) {
      return { result, notificationJobs: [] };
    }

    const toWrite: QueueState = { ...next, version: checkpointed.version + 1 };

    const won = await storeInternals.casWrite(QUEUE_STATE_KEY, checkpointed.version, toWrite);
    if (won) {
      const notificationJobs: NotificationJob[] = [...buildCheckpointJobs(checkpointed, fired)];

      const turnReadyJob = buildTurnReadyJob(current, next);
      if (turnReadyJob) {
        notificationJobs.push(turnReadyJob);
      }

      const seatOpenedJob = buildSeatOpenedJob(current, next);
      if (seatOpenedJob) {
        notificationJobs.push(seatOpenedJob);
      }

      return { result, notificationJobs };
    }

    await sleep(randomBackoffMs());
  }

  throw new QueueBusyError();
}

export { QUEUE_STATE_KEY };
