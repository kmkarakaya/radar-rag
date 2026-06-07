import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryRequestRateLimiter, createRateLimitKey } from "../src/http/rateLimit.js";
import { emitOperationalLog, normalizeLogEvent } from "../src/observability/logger.js";
import {
  OperationAbortError,
  OperationTimeoutError,
  withTimeoutAndAbort,
} from "../src/observability/timeout.js";

describe("operational observability helpers", () => {
  it("builds rate limit keys from tenant, user, collection and operation", () => {
    const key = createRateLimitKey({
      tenantId: "tenant-a",
      userId: "user-b",
      collectionId: "collection-c",
      operation: "query",
    });
    assert.equal(key, JSON.stringify(["tenant-a", "user-b", "collection-c", "query"]));
  });

  it("keeps request rate limits isolated by operation", () => {
    const limiter = createInMemoryRequestRateLimiter({
      enabled: true,
      windowMs: 1000,
      maxRequestsPerWindow: 1,
    });
    const firstQuery = limiter.check({
      tenantId: "tenant-a",
      userId: "user-b",
      collectionId: "collection-c",
      operation: "query",
      nowMs: 1000,
    });
    const secondQuery = limiter.check({
      tenantId: "tenant-a",
      userId: "user-b",
      collectionId: "collection-c",
      operation: "query",
      nowMs: 1001,
    });
    const retrieve = limiter.check({
      tenantId: "tenant-a",
      userId: "user-b",
      collectionId: "collection-c",
      operation: "retrieve",
      nowMs: 1002,
    });

    assert.equal(firstQuery.allowed, true);
    assert.equal(secondQuery.allowed, false);
    assert.equal(retrieve.allowed, true);
  });

  it("normalizes structured log timestamps without dropping explicit fields", () => {
    const normalized = normalizeLogEvent({
      requestId: "req-1",
      tenantId: "tenant-a",
      userId: "user-b",
      collectionId: "collection-c",
      physicalCollection: "physical-c",
      jobId: "job-1",
      operation: "query",
      status: "succeeded",
      latencyMs: 12,
      errorCode: undefined,
    });

    assert.equal(typeof normalized.timestamp, "string");
    assert.equal(normalized.requestId, "req-1");
    assert.equal(normalized.physicalCollection, "physical-c");
    assert.equal(normalized.jobId, "job-1");
    assert.equal(normalized.latencyMs, 12);
  });

  it("does not throw when the operational log sink throws", () => {
    let capturedEvent: Parameters<typeof emitOperationalLog>[1] | undefined;

    assert.doesNotThrow(() => {
      emitOperationalLog((event) => {
        capturedEvent = event;
        throw new Error("sink exploded");
      }, {
        requestId: "req-1",
        operation: "query",
        status: "succeeded",
      });
    });

    assert.equal(capturedEvent?.requestId, "req-1");
    assert.equal(capturedEvent?.operation, "query");
    assert.equal(capturedEvent?.status, "succeeded");
    assert.equal(typeof capturedEvent?.timestamp, "string");
  });

  it("rejects operations that exceed the configured timeout", async () => {
    await assert.rejects(
      () => withTimeoutAndAbort({
        promise: new Promise((resolve) => setTimeout(resolve, 50)),
        timeoutMs: 1,
        label: "slow operation",
      }),
      OperationTimeoutError,
    );
  });

  it("rejects operations when the caller aborts", async () => {
    const controller = new AbortController();
    const promise = withTimeoutAndAbort({
      promise: new Promise((resolve) => setTimeout(resolve, 50)),
      timeoutMs: 1000,
      label: "abortable operation",
      abortSignal: controller.signal,
    });
    controller.abort();

    await assert.rejects(
      () => promise,
      OperationAbortError,
    );
  });
});
