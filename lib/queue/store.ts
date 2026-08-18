import { redis } from "./redis-client";
import { reapExpired } from "./engine";
import { QueueBusyError, type QueueState } from "./types";

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
  return { version: 0, active: null, waiting: [] };
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

export async function withQueueMutation<T>(
  mutate: (state: QueueState, now: number) => { next: QueueState; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt++) {
    const now = Date.now();
    const current = await storeInternals.getState();
    const reaped = reapExpired(current, now);
    const { next, result } = mutate(reaped, now);
    const toWrite: QueueState = { ...next, version: reaped.version + 1 };

    const won = await storeInternals.casWrite(QUEUE_STATE_KEY, reaped.version, toWrite);
    if (won) {
      return result;
    }

    await sleep(randomBackoffMs());
  }

  throw new QueueBusyError();
}

export { QUEUE_STATE_KEY };
