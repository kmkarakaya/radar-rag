import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp, type AppDependencies } from "../../src/app.js";
import { createSqliteCollectionRegistry } from "../../src/collections/sqliteRegistry.js";
import { resolveReadableCollection as actualResolveReadableCollection } from "../../src/collections/resolveReadableCollection.js";
import type { CollectionRegistry, RagCollection } from "../../src/collections/types.js";
import { config } from "../../src/config.js";
import type { IndexJobRunner } from "../../src/indexing/jobRunner.js";
import type { RateLimitInput, RequestRateLimiter } from "../../src/http/rateLimit.js";
import type { OperationalLogEvent } from "../../src/observability/logger.js";
import { RagQueryError } from "../../src/rag.js";

let server: Server;
let baseUrl: string;
let registry: CollectionRegistry;
let jobRunner: IndexJobRunner;
const readablePhysicalCollections = new Map<string, number>();
const retrieveCalls: Array<Record<string, unknown>> = [];
const answerCalls: Array<Record<string, unknown>> = [];
const operationalLogs: OperationalLogEvent[] = [];
let resolveReadableCollectionOverride: typeof actualResolveReadableCollection | undefined;
let retrieveOverride: AppRagRetrieveHandler | undefined;
let answerOverride: AppRagAnswerHandler | undefined;
let availableOllamaModels = ["gemma3:4b-cloud", "bge-m3", "chat-collection-specific", "embed-collection-specific"];
let chromaHealthCalls = 0;
let ollamaHealthCalls = 0;

type AppRagHandlers = NonNullable<AppDependencies["ragHandlers"]>;
type AppRagRetrieveHandler = NonNullable<AppRagHandlers["retrieveSources"]>;
type AppRagAnswerHandler = NonNullable<AppRagHandlers["answerQuestion"]>;

before(async () => {
  registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
  jobRunner = {
    start: () => {},
    drain: async () => {},
    shutdown: async () => {},
    abort: async (jobId: string) => {
      await registry.cancelIndexJob(jobId);
    },
  };
  const app = createApp({
    registry,
    jobRunner,
    ragHandlers: {
      retrieveSources: async (question, options) => {
        if (retrieveOverride) {
          return retrieveOverride(question, options);
        }
        retrieveCalls.push({ ...options });
        return {
          distanceScoreThreshold: options.retrievalDistanceThreshold ?? -1,
          sources: [],
        };
      },
      answerQuestion: async (question, options) => {
        if (answerOverride) {
          return answerOverride(question, options);
        }
        answerCalls.push({ ...options });
        return {
          answer: "stub-answer",
          distanceScoreThreshold: options.retrievalDistanceThreshold ?? -1,
          sources: [],
        };
      },
      resolveReadableCollection: async (req, deps, runtimeConfig, options) => {
        if (resolveReadableCollectionOverride) {
          return resolveReadableCollectionOverride(req, deps, runtimeConfig, options);
        }

        return actualResolveReadableCollection(req, deps, runtimeConfig, options);
      },
    },
    healthChecks: {
      checkOllamaHealth: async () => {
        ollamaHealthCalls += 1;
        return {
          ok: true,
          latencyMs: 1,
          details: {
            reachable: true,
            availableModels: availableOllamaModels,
            missingModels: [],
            chatModelAvailable: true,
            embeddingModelAvailable: true,
          },
        };
      },
      checkChromaHealth: async (_runtimeConfig, options) => {
        chromaHealthCalls += 1;
        if (!options?.collectionName) {
          return {
            ok: true,
            latencyMs: 1,
            details: {
              reachable: true,
            },
          };
        }

        const count = readablePhysicalCollections.get(options.collectionName);
        if (typeof count === "number") {
          return {
            ok: true,
            latencyMs: 1,
            details: {
              reachable: true,
              collectionReadable: true,
              collectionCount: count,
            },
          };
        }

        return {
          ok: false,
          latencyMs: 1,
          error: "collection not readable",
          details: {
            reachable: true,
            collectionReadable: false,
          },
        };
      },
    },
    logEvent: (event) => {
      operationalLogs.push(event);
    },
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

after(async () => {
  await jobRunner.shutdown();
  registry.close?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

async function startEphemeralApp(deps: AppDependencies): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(deps);
  let ephemeralServer!: Server;
  await new Promise<void>((resolve) => {
    ephemeralServer = app.listen(0, () => resolve());
  });

  const address = ephemeralServer.address();
  assert.ok(address && typeof address !== "string");

  return {
    server: ephemeralServer,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
}

async function stopServer(serverToStop: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    serverToStop.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("v1 admin and rag api endpoints", () => {
  let createdCollection: RagCollection;
  let activeJobId: string;

  it("POST /v1/admin/collections creates a collection", async () => {
    const response = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "API Test Collection",
        description: "Test description",
        sourcePath: "data/api-test",
        ozelgeDataPath: "data/ozelge_veri.json",
        distanceMetric: "cosine",
      }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 201);
    assert.equal(body.collection.displayName, "API Test Collection");
    assert.equal(body.collection.status, "creating");
    
    // Save for subsequent tests
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "test" };
    const saved = await registry.getVisibleCollection(ctx, body.collection.id);
    assert.ok(saved);
    createdCollection = saved;
  });

  it("POST /v1/admin/collections auto-fills defaults from config", async () => {
    const response = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Defaults Test Collection",
        // sourcePath and ozelgeDataPath are omitted to test auto-fill
      }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 201);
    
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "test" };
    const saved = await registry.getVisibleCollection(ctx, body.collection.id);
    assert.ok(saved);
    
    assert.equal(saved.displayName, "Defaults Test Collection");
    // Assert auto-filled paths from config
    assert.equal(saved.sourcePath, config.collectionDefaults.sourcePath);
    assert.equal(saved.ozelgeDataPath, config.collectionDefaults.ozelgeDataPath);
    
    // Assert defaults from config
    assert.equal(saved.chunkSize, config.collectionDefaults.chunkSize);
    assert.equal(saved.chunkOverlap, config.collectionDefaults.chunkOverlap);
    assert.equal(saved.retrievalK, config.collectionDefaults.retrievalK);
    assert.equal(saved.retrievalDistanceThreshold, config.collectionDefaults.retrievalDistanceThreshold);
    assert.equal(saved.distanceMetric, config.collectionDefaults.distanceMetric);
    assert.equal(saved.embeddingModel, config.ollamaEmbeddingModel);
    assert.equal(saved.chatModel, config.ollamaChatModel);
  });

  it("GET /v1/rag/collections lists collections", async () => {
    retrieveCalls.length = 0;
    answerCalls.length = 0;
    chromaHealthCalls = 0;
    ollamaHealthCalls = 0;
    const response = await request("/v1/rag/collections");
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.collections));
    const found = body.collections.find((c: any) => c.id === createdCollection.id);
    assert.ok(found);
    assert.equal(found.displayName, "API Test Collection");
    assert.equal(found.description, "Test description");
    assert.equal(found.status, "creating");
    assert.equal(found.activeVersion, null);
    assert.equal(found.chunkCount, null);
    assert.equal(typeof found.updatedAt, "string");
    assert.equal("capabilities" in found, false);
    assert.equal(found.readyUrl, `/v1/rag/collections/${createdCollection.id}/ready`);
    assert.equal(found.queryUrl, `/v1/rag/collections/${createdCollection.id}/query`);
    assert.equal(found.retrieveUrl, `/v1/rag/collections/${createdCollection.id}/retrieve`);
    assert.equal(retrieveCalls.length, 0);
    assert.equal(answerCalls.length, 0);
    assert.equal(chromaHealthCalls, 0);
    assert.equal(ollamaHealthCalls, 0);
  });

  it("GET /v1/rag/collections only returns collections visible to the request tenant", async () => {
    const response = await request("/v1/rag/collections", {
      headers: { "x-tenant-id": "other-tenant" },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.collections));
    assert.equal(body.collections.length, 0);
  });

  it("missing collection query/retrieve -> 404 without calling rag handlers", async () => {
    retrieveCalls.length = 0;
    answerCalls.length = 0;

    for (const endpoint of ["query", "retrieve"]) {
      const response = await request(`/v1/rag/collections/non-existent-123/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hello?" }),
      });

      const body = await response.json() as any;
      assert.equal(response.status, 404);
      assert.equal(body.code, "COLLECTION_NOT_FOUND");
    }

    assert.equal(retrieveCalls.length, 0);
    assert.equal(answerCalls.length, 0);
  });

  it("existing collection from another tenant -> 403 COLLECTION_FORBIDDEN", async () => {
    const response = await request(`/v1/rag/collections/${createdCollection.id}/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "other-tenant",
      },
      body: JSON.stringify({ question: "hello?" }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 403);
    assert.equal(body.code, "COLLECTION_FORBIDDEN");
  });

  it("no active version -> 404 COLLECTION_NOT_READY or 503 COLLECTION_INDEXING", async () => {
    const response = await request(`/v1/rag/collections/${createdCollection.id}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "hello?" }),
    });

    const body = await response.json() as any;
    // status is 'creating', activePhysicalCollection is undefined -> should be 503 COLLECTION_INDEXING
    assert.equal(response.status, 503);
    assert.equal(body.code, "COLLECTION_INDEXING");
  });

  it("old /rag/query and /rag/retrieve -> 404", async () => {
    for (const route of ["/rag/query", "/rag/retrieve"]) {
      const response = await request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "hello?" }),
      });
      assert.equal(response.status, 404);
    }
  });

  it("collection ready reports queued job without an active physical as not queryable", async () => {
    operationalLogs.length = 0;
    const response = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 202);
    activeJobId = body.job.id;
    const reindexLog = operationalLogs.find((event) => event.operation === "reindex" && event.jobId === activeJobId);
    assert.ok(reindexLog);
    assert.equal(reindexLog.collectionId, createdCollection.id);
    assert.equal(reindexLog.physicalCollection, body.job.targetPhysicalCollection);

    const readyResponse = await request(`/v1/rag/collections/${createdCollection.id}/ready`);
    const readyBody = await readyResponse.json() as any;

    assert.equal(readyResponse.status, 200);
    assert.strictEqual(readyBody.hasActivePhysicalCollection, false);
    assert.ok(!("activePhysicalCollection" in readyBody));
    assert.equal(readyBody.activeVersion, null);
    assert.deepEqual(readyBody.activeJob, { id: activeJobId, status: "queued" });
    assert.equal(readyBody.chromaReadable, false);
    assert.equal(readyBody.chromaCount, -1);
    assert.deepEqual(readyBody.capabilities, {
      query: false,
      retrieve: false,
      reindex: true,
    });
  });

  it("collection ready keeps query and retrieve available during rebuild when the active physical stays readable", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "ready-test" };
    const activePhysicalCollection = "api-test-active-physical";
    readablePhysicalCollections.set(activePhysicalCollection, 42);

    await registry.updateCollection(ctx, createdCollection.id, {
      status: "indexing",
      activePhysicalCollection,
      activeVersion: "v-active-1",
    });

    const response = await request(`/v1/rag/collections/${createdCollection.id}/ready`);
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.status, "indexing");
    assert.strictEqual(body.hasActivePhysicalCollection, true);
    assert.ok(!("activePhysicalCollection" in body));
    assert.equal(body.activeVersion, "v-active-1");
    assert.deepEqual(body.activeJob, { id: activeJobId, status: "queued" });
    assert.equal(body.chromaReadable, true);
    assert.equal(body.chromaCount, 42);
    assert.deepEqual(body.capabilities, {
      query: true,
      retrieve: true,
      reindex: true,
    });
    assert.deepEqual(body.modelAvailability, {
      embeddingModel: createdCollection.embeddingModel,
      embeddingModelAvailable: true,
      chatModel: createdCollection.chatModel,
      chatModelAvailable: true,
    });
  });

  it("collection ready disables query capability when collection-specific models are unavailable", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "ready-models" };
    const activePhysicalCollection = "api-test-missing-models";
    readablePhysicalCollections.set(activePhysicalCollection, 12);

    await registry.updateCollection(ctx, createdCollection.id, {
      status: "ready",
      activePhysicalCollection,
      activeVersion: "v-missing-models",
      embeddingModel: "missing-embed-model",
      chatModel: "missing-chat-model",
    });

    availableOllamaModels = ["gemma3:4b-cloud", "bge-m3"];
    try {
      const response = await request(`/v1/rag/collections/${createdCollection.id}/ready`);
      const body = await response.json() as any;

      assert.equal(response.status, 200);
      assert.deepEqual(body.modelAvailability, {
        embeddingModel: "missing-embed-model",
        embeddingModelAvailable: false,
        chatModel: "missing-chat-model",
        chatModelAvailable: false,
      });
      assert.deepEqual(body.capabilities, {
        query: false,
        retrieve: false,
        reindex: true,
      });
    } finally {
      availableOllamaModels = ["gemma3:4b-cloud", "bge-m3", "chat-collection-specific", "embed-collection-specific"];
    }
  });

  it("query and retrieve forward collection-specific models and thresholds to the rag core", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "route-settings" };
    const activePhysicalCollection = "api-test-route-settings";
    readablePhysicalCollections.set(activePhysicalCollection, 7);
    operationalLogs.length = 0;
    retrieveCalls.length = 0;
    answerCalls.length = 0;

    await registry.updateCollection(ctx, createdCollection.id, {
      status: "ready",
      activePhysicalCollection,
      activeVersion: "v-route-settings",
      embeddingModel: "embed-collection-specific",
      chatModel: "chat-collection-specific",
      retrievalK: 7,
      retrievalDistanceThreshold: 0.42,
    });

    resolveReadableCollectionOverride = async (req, deps, _runtimeConfig) => {
      const collectionId = req.params.collectionId as string;
      const collection = await deps.registry.getVisibleCollection(ctx, collectionId);
      assert.ok(collection);
      return collection;
    };

    try {
      const retrieveResponse = await request(`/v1/rag/collections/${createdCollection.id}/retrieve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "retrieve-log-test",
        },
        body: JSON.stringify({ question: "threshold?", k: 3 }),
      });
      const retrieveBody = await retrieveResponse.json() as any;

      assert.equal(retrieveResponse.status, 200);
      assert.equal(retrieveBody.question, "threshold?");
      assert.equal(retrieveBody.k, 3);
      assert.equal(retrieveBody.sourceCount, 0);
      assert.equal(retrieveBody.distanceScoreThreshold, 0.42);
      assert.equal(retrieveBody.collectionId, createdCollection.id);
      assert.equal(retrieveBody.activeVersion, "v-route-settings");
      assert.equal("debug" in retrieveBody, false);
      assert.equal(retrieveCalls.length, 1);
      assert.equal(retrieveCalls[0]?.collectionName, activePhysicalCollection);
      assert.equal(retrieveCalls[0]?.collectionId, createdCollection.id);
      assert.equal(retrieveCalls[0]?.embeddingModel, "embed-collection-specific");
      assert.equal(retrieveCalls[0]?.retrievalDistanceThreshold, 0.42);
      assert.equal(retrieveCalls[0]?.k, 3);

      const queryResponse = await request(`/v1/rag/collections/${createdCollection.id}/query`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "query-log-test",
        },
        body: JSON.stringify({ question: "models?" }),
      });
      const queryBody = await queryResponse.json() as any;

      assert.equal(queryResponse.status, 200);
      assert.equal(queryBody.distanceScoreThreshold, 0.42);
      assert.equal(queryBody.collectionId, createdCollection.id);
      assert.equal(queryBody.activeVersion, "v-route-settings");
      assert.equal("debug" in queryBody, false);
      assert.equal(answerCalls.length, 1);
      assert.equal(answerCalls[0]?.collectionName, activePhysicalCollection);
      assert.equal(answerCalls[0]?.collectionId, createdCollection.id);
      assert.equal(answerCalls[0]?.embeddingModel, "embed-collection-specific");
      assert.equal(answerCalls[0]?.chatModel, "chat-collection-specific");
      assert.equal(answerCalls[0]?.retrievalDistanceThreshold, 0.42);
      assert.equal(answerCalls[0]?.retrievalK, 7);
      assert.equal(answerCalls[0]?.includeDebugTimings, false);

      const retrieveLog = operationalLogs.find((event) => event.operation === "retrieve" && event.requestId === "retrieve-log-test");
      assert.ok(retrieveLog);
      assert.equal(retrieveLog.collectionId, createdCollection.id);
      assert.equal(retrieveLog.physicalCollection, activePhysicalCollection);
      assert.equal(retrieveLog.status, "succeeded");
      assert.equal(typeof retrieveLog.latencyMs, "number");

      const queryLog = operationalLogs.find((event) => event.operation === "query" && event.requestId === "query-log-test");
      assert.ok(queryLog);
      assert.equal(queryLog.collectionId, createdCollection.id);
      assert.equal(queryLog.physicalCollection, activePhysicalCollection);
      assert.equal(queryLog.status, "succeeded");
      assert.equal(typeof queryLog.latencyMs, "number");
    } finally {
      resolveReadableCollectionOverride = undefined;
    }
  });

  it("rate limits query, retrieve and reindex by tenant, user, collection and operation", async () => {
    const capturedInputs: RateLimitInput[] = [];
    const rateLimitLogs: OperationalLogEvent[] = [];
    const limiter: RequestRateLimiter = {
      check: (input) => {
        capturedInputs.push(input);
        return {
          allowed: false,
          key: `${input.tenantId}:${input.userId}:${input.collectionId}:${input.operation}`,
          limit: 1,
          remaining: 0,
          resetAt: "2026-06-05T12:00:05.000Z",
          retryAfterMs: 5000,
        };
      },
    };
    const started = await startEphemeralApp({
      runtimeConfig: {
        ...config,
        rateLimitWindowMs: 5000,
        rateLimitMaxRequestsPerWindow: 1,
      },
      rateLimiter: limiter,
      logEvent: (event) => {
        rateLimitLogs.push(event);
      },
    });

    try {
      const targets = [
        ["/v1/rag/collections/rate-limit-col/query", "query"],
        ["/v1/rag/collections/rate-limit-col/retrieve", "retrieve"],
        ["/v1/admin/collections/rate-limit-col/reindex", "reindex"],
      ] as const;

      for (const [path, operation] of targets) {
        const response = await fetch(`${started.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": `rate-${operation}`,
            "x-tenant-id": "tenant-rate",
            "x-user-id": "user-rate",
          },
          body: JSON.stringify({ question: "limited?" }),
        });
        const body = await response.json() as any;

        assert.equal(response.status, 429);
        assert.equal(body.code, "RATE_LIMIT_EXCEEDED");
        assert.equal(response.headers.get("retry-after"), "5");
      }

      assert.deepEqual(capturedInputs.map((input) => ({
        tenantId: input.tenantId,
        userId: input.userId,
        collectionId: input.collectionId,
        operation: input.operation,
      })), [
        {
          tenantId: "tenant-rate",
          userId: "user-rate",
          collectionId: "rate-limit-col",
          operation: "query",
        },
        {
          tenantId: "tenant-rate",
          userId: "user-rate",
          collectionId: "rate-limit-col",
          operation: "retrieve",
        },
        {
          tenantId: "tenant-rate",
          userId: "user-rate",
          collectionId: "rate-limit-col",
          operation: "reindex",
        },
      ]);
      assert.ok(rateLimitLogs.some((event) => (
        event.operation === "query"
        && event.status === "rejected"
        && event.errorCode === "RATE_LIMIT_EXCEEDED"
        && event.collectionId === "rate-limit-col"
      )));
    } finally {
      await stopServer(started.server);
    }
  });

  it("includes debug latency only when includeDebugTimings is enabled", async () => {
    const debugRegistry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const debugContext = { tenantId: "default", userId: "local-dev", requestId: "debug-test" };
    let debugCollection = await debugRegistry.createCollection(debugContext, {
      displayName: "Debug Collection",
      sourcePath: "data/debug",
      ozelgeDataPath: "data/ozelge_veri.json",
      embeddingModel: "embed-debug",
      chatModel: "chat-debug",
      distanceMetric: "cosine",
      chunkSize: 100,
      chunkOverlap: 0,
      retrievalK: 4,
      retrievalDistanceThreshold: 0.4,
    });
    debugCollection = await debugRegistry.updateCollection(debugContext, debugCollection.id, {
      status: "ready",
      activePhysicalCollection: "debug-active-physical",
      activeVersion: "debug_version_001",
    });
    const started = await startEphemeralApp({
      registry: debugRegistry,
      jobRunner,
      runtimeConfig: {
        ...config,
        includeDebugTimings: true,
      },
      ragHandlers: {
        resolveReadableCollection: async () => debugCollection,
        answerQuestion: async (_question, options) => {
          assert.equal(options.includeDebugTimings, true);
          return {
            answer: "debug-answer",
            distanceScoreThreshold: 0.4,
            sources: [],
            debug: {
              latency: {
                retrievalMs: 1,
                generationMs: 2,
                totalMs: 3,
              },
            },
          };
        },
      },
      logEvent: () => {},
    });

    try {
      const response = await fetch(`${started.baseUrl}/v1/rag/collections/${debugCollection.id}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "debug?" }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 200);
      assert.deepEqual(body.debug, {
        latency: {
          retrievalMs: 1,
          generationMs: 2,
          totalMs: 3,
        },
      });
    } finally {
      await stopServer(started.server);
      debugRegistry.close?.();
    }
  });

  it("admin collection update persists all supported patch fields and returns the updated collection payload", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "API Patched Collection",
        description: null,
        sourcePath: "data/api-test-updated",
        ozelgeDataPath: "data/api-test-updated-ozelge.json",
        embeddingModel: "embed-patched-http",
        chatModel: "chat-patched-http",
        distanceMetric: "ip",
        chunkSize: 321,
        chunkOverlap: 12,
        retrievalK: 11,
        retrievalDistanceThreshold: 0.33,
      }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.collection.displayName, "API Patched Collection");
    assert.equal(body.collection.sourcePath, "data/api-test-updated");
    assert.equal(body.collection.ozelgeDataPath, "data/api-test-updated-ozelge.json");
    assert.equal(body.collection.embeddingModel, "embed-patched-http");
    assert.equal(body.collection.chatModel, "chat-patched-http");
    assert.equal(body.collection.distanceMetric, "ip");
    assert.equal(body.collection.chunkSize, 321);
    assert.equal(body.collection.chunkOverlap, 12);
    assert.equal(body.collection.retrievalK, 11);
    assert.equal(body.collection.retrievalDistanceThreshold, 0.33);
    assert.deepEqual(body.collection.chromaCollectionConfiguration, {
      hnsw: {
        space: "ip",
      },
    });
    assert.equal("description" in body.collection, false);

    const ctx = { tenantId: "default", userId: "local-dev", requestId: "patch-check" };
    const saved = await registry.getVisibleCollection(ctx, createdCollection.id);
    assert.equal(saved?.displayName, "API Patched Collection");
    assert.equal(saved?.description, undefined);
    assert.equal(saved?.sourcePath, "data/api-test-updated");
    assert.equal(saved?.ozelgeDataPath, "data/api-test-updated-ozelge.json");
    assert.equal(saved?.embeddingModel, "embed-patched-http");
    assert.equal(saved?.chatModel, "chat-patched-http");
    assert.equal(saved?.distanceMetric, "ip");
    assert.equal(saved?.chunkSize, 321);
    assert.equal(saved?.chunkOverlap, 12);
    assert.equal(saved?.retrievalK, 11);
    assert.equal(saved?.retrievalDistanceThreshold, 0.33);
  });

  it("admin collection detail returns the full editable collection DTO", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}`);
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.collection.id, createdCollection.id);
    assert.equal(body.collection.displayName, "API Patched Collection");
    assert.equal(body.collection.sourcePath, "data/api-test-updated");
    assert.equal(body.collection.ozelgeDataPath, "data/api-test-updated-ozelge.json");
    assert.equal(body.collection.embeddingModel, "embed-patched-http");
    assert.equal(body.collection.chatModel, "chat-patched-http");
    assert.equal(body.collection.distanceMetric, "ip");
    assert.equal(body.collection.chunkSize, 321);
    assert.equal(body.collection.chunkOverlap, 12);
    assert.equal(body.collection.retrievalK, 11);
    assert.equal(body.collection.retrievalDistanceThreshold, 0.33);
    assert.deepEqual(body.collection.chromaCollectionConfiguration, {
      hnsw: {
        space: "ip",
      },
    });
  });

  it("admin collection update returns 404 for an unknown collection", async () => {
    const response = await request("/v1/admin/collections/unknown-collection-404", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Missing" }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 404);
    assert.equal(body.code, "COLLECTION_NOT_FOUND");
  });

  it("admin collection update rejects unknown body keys with INVALID_REQUEST_BODY", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Valid", unknownPatchKey: true }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST_BODY");
    assert.ok(Array.isArray(body.details?.issues));
  });

  it("admin collection detail is tenant-scoped and returns 403 for another tenant", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}`, {
      headers: {
        "x-tenant-id": "other-tenant",
      },
    });

    const body = await response.json() as any;
    assert.equal(response.status, 403);
    assert.equal(body.code, "COLLECTION_FORBIDDEN");
  });

  it("admin collection update is tenant-scoped and returns 403 for another tenant", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "other-tenant",
      },
      body: JSON.stringify({ displayName: "Should Fail" }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 403);
    assert.equal(body.code, "COLLECTION_FORBIDDEN");
  });

  it("admin job lookup is tenant-scoped", async () => {
    const response = await request(`/v1/admin/jobs/${activeJobId}`, {
      headers: { "x-tenant-id": "other-tenant" },
    });

    const body = await response.json() as any;
    assert.equal(response.status, 404);
    assert.equal(body.code, "ROUTE_NOT_FOUND");
  });

  it("admin job lookup returns the target physical collection and emits it in structured logs", async () => {
    operationalLogs.length = 0;
    const response = await request(`/v1/admin/jobs/${activeJobId}`);
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.job.id, activeJobId);
    assert.equal(typeof body.job.targetPhysicalCollection, "string");

    const jobLog = operationalLogs.find((event) => event.operation === "job" && event.jobId === activeJobId);
    assert.ok(jobLog);
    assert.equal(jobLog.collectionId, createdCollection.id);
    assert.equal(jobLog.physicalCollection, body.job.targetPhysicalCollection);
  });

  it("GET /v1/admin/jobs lists tenant jobs with filters and cursor pagination", async () => {
    async function createQueuedJob(displayName: string, tenantId = "default") {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (tenantId !== "default") headers["x-tenant-id"] = tenantId;

      const createResponse = await request("/v1/admin/collections", {
        method: "POST",
        headers,
        body: JSON.stringify({ displayName }),
      });
      const createBody = await createResponse.json() as any;
      assert.equal(createResponse.status, 201);

      const reindexResponse = await request(`/v1/admin/collections/${createBody.collection.id}/reindex`, {
        method: "POST",
        headers,
      });
      const reindexBody = await reindexResponse.json() as any;
      assert.equal(reindexResponse.status, 202);

      return {
        collectionId: createBody.collection.id,
        jobId: reindexBody.job.id,
        targetPhysicalCollection: reindexBody.job.targetPhysicalCollection as string,
        targetVersion: reindexBody.job.targetVersion as string,
        tenantId,
      };
    }

    const queuedDefault = await createQueuedJob("Jobs List Queued");
    const runningDefault = await createQueuedJob("Jobs List Running");
    const succeededDefault = await createQueuedJob("Jobs List Succeeded");
    const otherTenantQueued = await createQueuedJob("Jobs List Other Tenant", "other-tenant");

    await registry.markIndexJobRunning(runningDefault.jobId);

    const runningJob = await registry.getJob(runningDefault.jobId);
    assert.ok(runningJob);
    await registry.markIndexJobRunning(succeededDefault.jobId);

    const succeededRunningJob = await registry.getJob(succeededDefault.jobId);
    assert.ok(succeededRunningJob);
    await registry.createPhysicalCollectionRecord({
      name: succeededRunningJob.targetPhysicalCollection,
      tenantId: "default",
      collectionId: succeededDefault.collectionId,
      version: succeededRunningJob.targetVersion,
      chromaConfiguration: succeededRunningJob.targetChromaConfiguration,
    });
    await registry.completeIndexJob(succeededDefault.jobId, {
      activePhysicalCollection: succeededRunningJob.targetPhysicalCollection,
      activeVersion: succeededRunningJob.targetVersion,
      documentCount: 3,
      chunkCount: 9,
      retentionMs: 0,
    });

    const firstPageResponse = await request("/v1/admin/jobs?limit=2");
    const firstPage = await firstPageResponse.json() as any;
    assert.equal(firstPageResponse.status, 200);
    assert.equal(Array.isArray(firstPage.jobs), true);
    assert.equal(firstPage.jobs.length, 2);
    assert.equal(typeof firstPage.nextCursor, "string");
    assert.equal(firstPage.jobs.every((entry: any) => entry.job.tenantId === "default"), true);
    assert.equal(firstPage.jobs.every((entry: any) => entry.collection && entry.collection.id === entry.job.collectionId), true);

    const firstPageIds = new Set(firstPage.jobs.map((entry: any) => entry.job.id));
    assert.equal(firstPageIds.has(succeededDefault.jobId), true);

    const secondPageResponse = await request(`/v1/admin/jobs?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    const secondPage = await secondPageResponse.json() as any;
    assert.equal(secondPageResponse.status, 200);
    assert.equal(Array.isArray(secondPage.jobs), true);
    assert.equal(secondPage.jobs.every((entry: any) => !firstPageIds.has(entry.job.id)), true);

    const combinedIds = new Set([...firstPage.jobs, ...secondPage.jobs].map((entry: any) => entry.job.id));
    assert.equal(combinedIds.has(queuedDefault.jobId), true);
    assert.equal(combinedIds.has(runningDefault.jobId), true);
    assert.equal(combinedIds.has(succeededDefault.jobId), true);

    const runningResponse = await request("/v1/admin/jobs?status=running");
    const runningBody = await runningResponse.json() as any;
    assert.equal(runningResponse.status, 200);
    assert.equal(runningBody.jobs.every((entry: any) => entry.job.status === "running"), true);
    assert.equal(runningBody.jobs.some((entry: any) => entry.job.id === runningDefault.jobId), true);

    const collectionResponse = await request(`/v1/admin/jobs?collectionId=${succeededDefault.collectionId}`);
    const collectionBody = await collectionResponse.json() as any;
    assert.equal(collectionResponse.status, 200);
    assert.equal(collectionBody.jobs.length, 1);
    assert.equal(collectionBody.jobs[0]?.job.collectionId, succeededDefault.collectionId);
    assert.equal(collectionBody.jobs[0]?.collection?.displayName, "Jobs List Succeeded");
    assert.equal(collectionBody.jobs[0]?.collection?.status, "ready");

    const otherTenantResponse = await request("/v1/admin/jobs?limit=10", {
      headers: {
        "x-tenant-id": "other-tenant",
      },
    });
    const otherTenantBody = await otherTenantResponse.json() as any;
    assert.equal(otherTenantResponse.status, 200);
    assert.equal(otherTenantBody.jobs.some((entry: any) => entry.job.id === otherTenantQueued.jobId), true);
    assert.equal(otherTenantBody.jobs.some((entry: any) => entry.job.collectionId === queuedDefault.collectionId), false);
  });

  it("duplicate reindex -> 409", async () => {

    const res2 = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    
    assert.equal(res2.status, 409);
    const body2 = await res2.json() as any;
    assert.equal(body2.code, "COLLECTION_INDEX_ALREADY_RUNNING");
  });

  it("maps RAG MODEL_BACKPRESSURE errors to HTTP 503", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "backpressure" };
    const activePhysicalCollection = "api-test-backpressure";

    await registry.updateCollection(ctx, createdCollection.id, {
      status: "ready",
      activePhysicalCollection,
      activeVersion: "v-backpressure",
      embeddingModel: "embed-collection-specific",
      chatModel: "chat-collection-specific",
    });

    resolveReadableCollectionOverride = async (req, deps, _runtimeConfig) => {
      const collectionId = req.params.collectionId as string;
      const collection = await deps.registry.getVisibleCollection(ctx, collectionId);
      assert.ok(collection);
      return collection;
    };
    answerOverride = async () => {
      throw new RagQueryError("MODEL_BACKPRESSURE", "model queue timed out", 503);
    };

    try {
      const response = await request(`/v1/rag/collections/${createdCollection.id}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "overload?" }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 503);
      assert.equal(body.code, "MODEL_BACKPRESSURE");
      assert.equal(body.message, "model queue timed out");
    } finally {
      resolveReadableCollectionOverride = undefined;
      answerOverride = undefined;
    }
  });

  it("maps storage inconsistency errors to HTTP 503", async () => {
    resolveReadableCollectionOverride = async () => {
      throw new RagQueryError(
        "COLLECTION_STORAGE_INCONSISTENT",
        "active physical collection missing",
        503,
        { collectionId: createdCollection.id },
      );
    };

    try {
      const response = await request(`/v1/rag/collections/${createdCollection.id}/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "storage?" }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 503);
      assert.equal(body.code, "COLLECTION_STORAGE_INCONSISTENT");
      assert.equal(body.details?.collectionId, createdCollection.id);
    } finally {
      resolveReadableCollectionOverride = undefined;
    }
  });

  it("forbidden collection query/retrieve still returns 403 COLLECTION_FORBIDDEN after Prompt 24", async () => {
    for (const endpoint of ["query", "retrieve"]) {
      const response = await request(`/v1/rag/collections/${createdCollection.id}/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": "other-tenant",
        },
        body: JSON.stringify({ question: "hello?" }),
      });

      const body = await response.json() as any;
      assert.equal(response.status, 403);
      assert.equal(body.code, "COLLECTION_FORBIDDEN");
    }
  });

  // ---------------------------------------------------------------------------
  // Prompt 24: Query Resolve Abort and Timeout Propagation
  // ---------------------------------------------------------------------------

  it('resolveReadableCollection forwards abortSignal to Chroma readability guard', async () => {
    const ctx = { tenantId: 'default', userId: 'local-dev', requestId: 'p24-signal-forward' };
    const activePhysicalCollection = 'p24-signal-forward-physical';
    readablePhysicalCollections.set(activePhysicalCollection, 10);

    // Ensure registry has the collection for this test specifically
    const created = await registry.createCollection(ctx, {
      displayName: 'Signal Test',
      sourcePath: 'data/signal',
      ozelgeDataPath: 'data/signal.json',
      embeddingModel: 'embed-test',
      chatModel: 'chat-test',
      distanceMetric: 'cosine',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalK: 4,
      retrievalDistanceThreshold: 0.5,
    });
    const collectionId = created.id;

    await registry.updateCollection(ctx, collectionId, {
      status: 'ready',
      activePhysicalCollection,
      activeVersion: 'v-p24-signal',
    });

    let resolveCalled = false;
    let signalCapturedInGuard: AbortSignal | undefined;
    resolveReadableCollectionOverride = async (req: any, deps: any, runtimeConfig: any, options?: any) => {
      resolveCalled = true;
      signalCapturedInGuard = options?.abortSignal;
      
      if (signalCapturedInGuard) {
        // If signal exists, we can wait a bit to ensure we see the abort
        if (signalCapturedInGuard.aborted) return { id: collectionId, status: 'ready', activePhysicalCollection, activeVersion: 'v-p24-signal' } as any;
        
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 100); // Max wait 100ms
          signalCapturedInGuard!.addEventListener('abort', () => {
            clearTimeout(timeout);
            resolve(true);
          }, { once: true });
        });
      }

      return {
        id: collectionId,
        status: 'ready',
        activePhysicalCollection,
        activeVersion: 'v-p24-signal',
      } as any;
    };

    const controller = new AbortController();
    try {
      const fetchPromise = request(`/v1/rag/collections/${collectionId}/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "signal?" }),
        signal: controller.signal,
      });

      // Give it a bit more time to reach the handler and start waiting
      await new Promise(resolve => setTimeout(resolve, 20));
      
      controller.abort();
      
      await fetchPromise;
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      resolveReadableCollectionOverride = undefined;
    }

    for (let i = 0; i < 20 && !signalCapturedInGuard?.aborted; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(resolveCalled, 'resolveReadableCollectionOverride should have been called');
    assert.ok(signalCapturedInGuard, 'Signal should have been captured in guard (req.signal might be missing in this Node/Express version)');
    assert.ok(signalCapturedInGuard?.aborted, 'Captured signal should be aborted');
  });

  it("normal retrieve requests do not abort RAG work when the request body is closed", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "normal-retrieve-signal" };
    const activePhysicalCollection = "normal-retrieve-signal-physical";
    readablePhysicalCollections.set(activePhysicalCollection, 3);

    const created = await registry.createCollection(ctx, {
      displayName: "Normal Signal Test",
      sourcePath: "data/normal-signal",
      ozelgeDataPath: "data/normal-signal.json",
      embeddingModel: "embed-test",
      chatModel: "chat-test",
      distanceMetric: "cosine",
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalK: 4,
      retrievalDistanceThreshold: 0.5,
    });

    await registry.updateCollection(ctx, created.id, {
      status: "ready",
      activePhysicalCollection,
      activeVersion: "v-normal-signal",
    });

    let signalAtHandler: AbortSignal | undefined;
    let signalAbortedAfterRequestBodyClose: boolean | undefined;

    resolveReadableCollectionOverride = async (req, deps) => {
      const collection = await deps.registry.getVisibleCollection(ctx, req.params.collectionId as string);
      assert.ok(collection);
      return collection;
    };

    retrieveOverride = async (_question, options) => {
      signalAtHandler = options.abortSignal;
      await new Promise((resolve) => setTimeout(resolve, 50));
      signalAbortedAfterRequestBodyClose = options.abortSignal?.aborted;

      return {
        distanceScoreThreshold: options.retrievalDistanceThreshold ?? -1,
        sources: [],
      };
    };

    try {
      const response = await request(`/v1/rag/collections/${created.id}/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "normal signal?" }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 200);
      assert.equal(body.collectionId, created.id);
    } finally {
      retrieveOverride = undefined;
      resolveReadableCollectionOverride = undefined;
    }

    assert.ok(signalAtHandler, "retrieve handler should receive an abort signal");
    assert.equal(signalAtHandler?.aborted, false);
    assert.equal(signalAbortedAfterRequestBodyClose, false);
  });

  // ---------------------------------------------------------------------------
  // Prompt 25: Active Embedding Model Snapshot
  // ---------------------------------------------------------------------------

  it('query and retrieve use the snapshotted activeEmbeddingModel until a new reindex completes', async () => {
    const ctx = { tenantId: 'default', userId: 'local-dev', requestId: 'p25-test' };
    const activePhysicalCollection = 'p25-active-physical';
    readablePhysicalCollections.set(activePhysicalCollection, 5);
    retrieveCalls.length = 0;

    // 1. Create collection with v1 model
    const created = await registry.createCollection(ctx, {
      displayName: 'Snapshot Test',
      sourcePath: 'data/p25',
      ozelgeDataPath: 'data/p25.json',
      embeddingModel: 'embed-v1',
      chatModel: 'chat-v1',
      distanceMetric: 'cosine',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalK: 4,
      retrievalDistanceThreshold: 0.5,
    });
    const collectionId = created.id;

    // 2. Mock a successful reindex that was built with v1
    await registry.updateCollection(ctx, collectionId, {
      status: 'ready',
      activePhysicalCollection,
      activeVersion: 'v-p25-1',
      activeEmbeddingModel: 'embed-v1', // Snapshot the model used for build
    });
    
    // We need to override resolveReadableCollection to avoid real Chroma calls
    resolveReadableCollectionOverride = async (req: any, deps: any, _runtimeConfig: any) => {
      const collection = await deps.registry.getVisibleCollection(ctx, req.params.collectionId);
      assert.ok(collection);
      return collection;
    };

    try {
      // We need to verify what the router sends to the RAG handler
      const responseV1 = await request(`/v1/rag/collections/${collectionId}/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "v1?" }),
      });
      assert.equal(responseV1.status, 200);
      assert.equal(retrieveCalls.length, 1);
      assert.equal(retrieveCalls[0].embeddingModel, 'embed-v1');

      // 3. Admin PATCH to v2 model
      const patchResponse = await request(`/v1/admin/collections/${collectionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ embeddingModel: 'embed-v2' }),
      });
      assert.equal(patchResponse.status, 200);

      // 4. Verify query still uses v1 because reindex hasn't finished
      const responseStillV1 = await request(`/v1/rag/collections/${collectionId}/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "still v1?" }),
      });
      assert.equal(responseStillV1.status, 200);
      assert.equal(retrieveCalls.length, 2);
      // THIS IS THE FAILING ASSERTION before fix: it will likely be 'embed-v2'
      assert.equal(retrieveCalls[1].embeddingModel, 'embed-v1', 'Should still use v1 model even after patch');
    } finally {
      resolveReadableCollectionOverride = undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // Prompt 26: Public Collection Detail DTO Sanitization
  // ---------------------------------------------------------------------------

  it('GET /v1/rag/collections/:collectionId returns a sanitized public DTO', async () => {
    const ctx = { tenantId: 'default', userId: 'local-dev', requestId: 'p26-test' };
    
    // 1. Create a collection with some internal fields
    const created = await registry.createCollection(ctx, {
      displayName: 'Sanitization Test',
      description: 'Public description',
      sourcePath: 'internal/path',
      ozelgeDataPath: 'internal/data.json',
      embeddingModel: 'embed-internal',
      chatModel: 'chat-internal',
      distanceMetric: 'cosine',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalK: 4,
      retrievalDistanceThreshold: 0.5,
    });
    const collectionId = created.id;

    // 2. Fetch the collection via public detail endpoint
    const response = await request(`/v1/rag/collections/${collectionId}`);
    assert.equal(response.status, 200);
    
    const body = await response.json() as any;
    const collection = body.collection;

    // 3. Assert public fields exist
    assert.equal(collection.id, collectionId);
    assert.equal(collection.displayName, 'Sanitization Test');
    assert.equal(collection.description, 'Public description');
    assert.equal(collection.status, 'creating');
    assert.ok('chunkCount' in collection);
    assert.ok('activeVersion' in collection);
    assert.ok('updatedAt' in collection);
    assert.equal(collection.readyUrl, `/v1/rag/collections/${collectionId}/ready`);
    assert.equal(collection.queryUrl, `/v1/rag/collections/${collectionId}/query`);
    assert.equal(collection.retrieveUrl, `/v1/rag/collections/${collectionId}/retrieve`);

    // 4. Assert internal fields are NOT present
    const forbiddenFields = [
      'tenantId',
      'createdBy',
      'sourcePath',
      'ozelgeDataPath',
      'embeddingModel',
      'chatModel',
      'distanceMetric',
      'chromaCollectionConfiguration',
      'activePhysicalCollection',
      'activeEmbeddingModel'
    ];

    for (const field of forbiddenFields) {
      assert.ok(!(field in collection), `Field "${field}" should not be in public response`);
    }
  });

  it("soft-delete: DELETE /v1/admin/collections/:id returns 204 and hides collection from public and admin API", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "soft-delete-api" };
    
    // 1. Create a collection
    const createRes = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Soft Delete API Test",
      }),
    });
    const createBody = await createRes.json() as any;
    const collectionId = createBody.collection.id;
    
    // 2. DELETE it
    const deleteRes = await request(`/v1/admin/collections/${collectionId}`, {
      method: "DELETE",
    });
    assert.equal(deleteRes.status, 204);
    
    // 3. Verify subsequent public calls return 404
    const getPublic = await request(`/v1/rag/collections/${collectionId}`);
    assert.equal(getPublic.status, 404);
    const getPublicBody = await getPublic.json() as any;
    assert.equal(getPublicBody.code, "COLLECTION_NOT_FOUND");
    
    const listPublic = await request("/v1/rag/collections");
    const listPublicBody = await listPublic.json() as any;
    assert.ok(!listPublicBody.collections.find((c: any) => c.id === collectionId));
    
    // 4. Verify admin calls also return 404
    const patchAdmin = await request(`/v1/admin/collections/${collectionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Will Fail" }),
    });
    assert.equal(patchAdmin.status, 404);
  });

  it('DELETE /v1/admin/collections/:collectionId aborts running jobs', async () => {
    const ctx = { tenantId: 'default', userId: 'local-dev', requestId: 'p36-test' };
    const collection = await registry.createCollection(ctx, {
      displayName: 'Abort Test',
      sourcePath: 'data',
      ozelgeDataPath: 'data/ozelge.json',
      embeddingModel: 'embed',
      chatModel: 'chat',
      distanceMetric: 'l2',
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const job = await registry.beginIndexJob(ctx, collection.id);
    await registry.markIndexJobRunning(job.id);

    let abortedJobId: string | undefined;
    const originalAbort = jobRunner.abort;
    jobRunner.abort = async (jobId) => {
      abortedJobId = jobId;
    };

    try {
      const response = await request(`/v1/admin/collections/${collection.id}`, {
        method: "DELETE",
      });
      assert.equal(response.status, 204);
      assert.equal(abortedJobId, job.id, 'Running job should have been aborted');
    } finally {
      jobRunner.abort = originalAbort;
    }
  });

  it('POST /v1/admin/jobs/:jobId/cancel for a queued job restores collection status', async () => {
    const ctx = { tenantId: 'default', userId: 'local-dev', requestId: 'p38-api-test' };
    
    // 1. Create a new collection
    const created = await registry.createCollection(ctx, {
      displayName: 'API Cancel Test',
      sourcePath: 'data',
      ozelgeDataPath: 'data/ozelge.json',
      embeddingModel: 'embed',
      chatModel: 'chat',
      distanceMetric: 'l2',
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });
    
    // 2. Start a job (queued)
    const reindexRes = await request(`/v1/admin/collections/${created.id}/reindex`, {
      method: "POST",
    });
    const reindexBody = await reindexRes.json() as any;
    const jobId = reindexBody.job.id;
    
    const indexing = await registry.getVisibleCollection(ctx, created.id);
    assert.equal(indexing?.status, 'indexing');
    
    // 3. Cancel the job via API
    const cancelRes = await request(`/v1/admin/jobs/${jobId}/cancel`, {
      method: "POST",
    });
    assert.equal(cancelRes.status, 204);
    
    // 4. Verify collection status is restored to 'failed' (since it was the first job)
    const restored = await registry.getVisibleCollection(ctx, created.id);
    assert.equal(restored?.status, 'failed');
    
    const cancelledJob = await registry.getJob(jobId);
    assert.equal(cancelledJob?.status, 'cancelled');
  });
});
