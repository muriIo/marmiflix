import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";

describe("redis integration harness", () => {
  it("round-trips a SET/GET through the local serverless-redis-http proxy", async () => {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    const key = "smoke-test-key";
    await redis.set(key, "hello");
    const value = await redis.get<string>(key);

    expect(value).toBe("hello");
  });
});
