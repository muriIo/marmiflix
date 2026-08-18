import { Redis } from "@upstash/redis";

function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variable. See .env.example for where to get these values.",
    );
  }

  return new Redis({ url, token });
}

export const redis = createRedisClient();
