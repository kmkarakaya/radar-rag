import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryRequestRateLimiter, createRateLimitKey } from "../src/http/rateLimit.js";

describe("rate limit key collision and hardening", () => {
  it("prevents collisions when fields contain separator characters", () => {
    const limiter = createInMemoryRequestRateLimiter({
      enabled: true,
      windowMs: 1000,
      maxRequestsPerWindow: 1,
    });

    const tuple1 = {
      tenantId: "a:b",
      userId: "c",
      collectionId: "d",
      operation: "query" as const,
      nowMs: 1000,
    };

    const tuple2 = {
      tenantId: "a",
      userId: "b:c",
      collectionId: "d",
      operation: "query" as const,
      nowMs: 1000,
    };

    // Both of these would join to "a:b:c:d:query" in the current implementation
    const firstResult = limiter.check(tuple1);
    const secondResult = limiter.check(tuple2);

    assert.equal(firstResult.allowed, true, "First unique tuple should be allowed");
    // THIS IS THE FAILING ASSERTION in the current implementation
    assert.equal(secondResult.allowed, true, "Second unique tuple should be allowed even if combined parts match");
    assert.notEqual(firstResult.key, secondResult.key, "Keys for different tuples should be unique");
  });

  it("handles empty values safely", () => {
    const key1 = createRateLimitKey({
      tenantId: "",
      userId: "a",
      collectionId: "b",
      operation: "query",
    });
    const key2 = createRateLimitKey({
      tenantId: "a",
      userId: "",
      collectionId: "b",
      operation: "query",
    });

    assert.notEqual(key1, key2);
  });

  it("prunes expired buckets periodically", () => {
    // We can't easily access the private 'buckets' map, but we can test the behavior
    // and assume pruning happens if we can still check after many simulated resets.
    const limiter = createInMemoryRequestRateLimiter({
      enabled: true,
      windowMs: 1000,
      maxRequestsPerWindow: 1,
    });

    // 1. Create a bucket at t=1000, expires at t=2000
    limiter.check({ tenantId: "t1", userId: "u1", collectionId: "c1", operation: "query", nowMs: 1000 });
    
    // 2. Advance time past reset but before prune interval (default 60s)
    // Checking again should create a new bucket (resetAt=2500+1000)
    const resultBeforePrune = limiter.check({ tenantId: "t1", userId: "u1", collectionId: "c1", operation: "query", nowMs: 2500 });
    assert.equal(resultBeforePrune.allowed, true);

    // 3. Advance time past prune interval (t=1000 + 60001 = 61001)
    // This check should trigger pruning of old entries
    const resultAfterPrune = limiter.check({ tenantId: "t2", userId: "u2", collectionId: "c2", operation: "query", nowMs: 61001 });
    assert.equal(resultAfterPrune.allowed, true);

    // If we were using a leak-detection tool or could peek into Map size, we'd see it's pruned.
    // For now, this confirms the logic doesn't crash during pruning.
  });
});
