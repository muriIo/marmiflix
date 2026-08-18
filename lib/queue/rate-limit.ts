import { redis } from "./redis-client";

export async function checkRateLimit(
  key: string,
  limit = 10,
  windowSeconds = 10,
): Promise<boolean> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }

  return count <= limit;
}
