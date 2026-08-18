import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit } from "../rate-limit";
import { redis } from "../redis-client";

async function clearRateLimitKey(key: string): Promise<void> {
  await redis.del(`ratelimit:${key}`);
}

describe("checkRateLimit", () => {
  beforeEach(async () => {
    await clearRateLimitKey("test-key");
    await clearRateLimitKey("key-a");
    await clearRateLimitKey("key-b");
  });

  it("allows the first `limit` calls within the window and rejects the next one", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) {
      results.push(await checkRateLimit("test-key", 10, 10));
    }

    expect(results.slice(0, 10)).toEqual(new Array(10).fill(true));
    expect(results[10]).toBe(false);
  });

  it("resets the count and allows calls again after the window expires", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("test-key", 3, 1)).toBe(true);
    }
    expect(await checkRateLimit("test-key", 3, 1)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(await checkRateLimit("test-key", 3, 1)).toBe(true);
  });

  it("rate-limits two different keys independently", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("key-a", 3, 10)).toBe(true);
    }
    expect(await checkRateLimit("key-a", 3, 10)).toBe(false);

    expect(await checkRateLimit("key-b", 3, 10)).toBe(true);
  });
});
