import { Redis } from "@upstash/redis";
import { upstashRedisRestToken, upstashRedisRestUrl } from "./config";

function createRedisClient(): Redis {
  const url = upstashRedisRestUrl();
  const token = upstashRedisRestToken();

  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variable. See .env.example for where to get these values.",
    );
  }

  return new Redis({ url, token });
}

let client: Redis | undefined;

function getClient(): Redis {
  if (!client) {
    client = createRedisClient();
  }
  return client;
}

// Lazy proxy: importing this module must NOT require the env vars to be
// present, only actually calling a Redis method does. Next.js's build-time
// "collect page data" step imports every route module (and everything it
// transitively imports) to statically analyze it, without executing request
// handlers - an eager `new Redis(...)` at module load time would make
// `next build` fail without production secrets available at build time.
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
