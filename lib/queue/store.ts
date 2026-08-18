import { redis } from "./redis-client";
import type { QueueState } from "./types";

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

export { QUEUE_STATE_KEY };
