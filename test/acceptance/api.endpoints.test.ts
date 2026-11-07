import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp, type AppDependencies } from "../../src/app.js";
import { createSqliteCollectionRegistry } from "../../src/collections/sqliteRegistry.js";
import { resolveReadableCollection as actualResolveReadableCollection } from "../../src/collections/resolveReadableCollection.js";
import type { CollectionRegistry, RagCollection } from "../../src/collections/types.js";
import { config as loadedConfig } from "../../src/config.js";
import type { IndexJobRunner } from "../../src/indexing/jobRunner.js";
import type { RateLimitInput, RequestRateLimiter } from "../../src/http/rateLimit.js";
import type { OperationalLogEvent } from "../../src/observability/logger.js";
import { RagQueryError } from "../../src/rag.js";

// These tests exercise the API contract, so they must not depend on operator choices that
// `npm run onboard` writes to config/rag.config.yaml (models, rate limit, debug timings, admin auth).
// Admin auth itself is covered in test/admin.auth.test.ts. Every `config.*` reference below uses
// this pinned copy, which the Ollama stub (availableOllamaModels) is built to match.
const config = {
  ...loadedConfig,
  ollamaEmbeddingModel: "bge-m3",
  ollamaChatModel: "gemma3:4b-cloud",
  rateLimitEnabled: true,
  includeDebugTimings: false,
  adminAuth: { ...loadedConfig.adminAuth, enabled: false },
};
const testRuntimeConfig = config;

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
let availableOllamaModels = ["gemma3:4b", "gemma3:4b-cloud", "gpt-oss:120b-cloud", "bge-m3:latest", "glm-5:cloud", "qwen3.5:cloud"];
const ollamaModelCapabilities: Record<string, string[]> = {
  "gemma3:4b": ["completion"],
  "gemma3:4b-cloud": ["completion", "vision"],
  "gpt-oss:120b-cloud": ["completion", "tools", "thinking"],
  "bge-m3": ["embedding"],
  "bge-m3:latest": ["embedding"],
  "glm-5:cloud": ["completion", "tools", "thinking"],
  "qwen3.5:cloud": ["completion", "tools", "thinking", "vision"],
  "chat-collection-specific": ["completion"],
  "embed-collection-specific": ["embedding"],
};
let ollamaModelDiscoveryReachable = true;
let chromaHealthCalls = 0;
let ollamaHealthCalls = 0;

type AppRagHandlers = NonNullable<AppDependencies["ragHandlers"]>;
type AppRagRetrieveHandler = NonNullable<AppRagHandlers["retrieveSources"]>;
type AppRagAnswerHandler = NonNullable<AppRagHandlers["answerQuestion"]>;

async function stubOllamaModelDiscovery() {
  return {
    reachable: ollamaModelDiscoveryReachable,
    models: ollamaModelDiscoveryReachable ? availableOllamaModels : [],
    embeddingModels: ollamaModelDiscoveryReachable
      ? availableOllamaModels.filter((model) => (ollamaModelCapabilities[model] ?? []).includes("embedding"))
      : [],
    chatModels: ollamaModelDiscoveryReachable
      ? availableOllamaModels.filter((model) => (ollamaModelCapabilities[model] ?? []).includes("completion"))
      : [],
    defaults: {
      embeddingModel: config.ollamaEmbeddingModel,
      chatModel: config.ollamaChatModel,
    },
  };
}

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
    runtimeConfig: testRuntimeConfig,
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
          embeddingModel: options.embeddingModel ?? config.ollamaEmbeddingModel,
          chatModel: options.chatModel ?? config.ollamaChatModel,
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
      checkOllamaModelDiscovery: stubOllamaModelDiscovery,
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
  const app = createApp({
    runtimeConfig: testRuntimeConfig,
    ...deps,
    // Never let admin model preflight reach a real Ollama instance from tests.
    healthChecks: { checkOllamaModelDiscovery: stubOllamaModelDiscovery, ...deps.healthChecks },
  });
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
  serverToStop.closeIdleConnections?.();
  serverToStop.closeAllConnections?.();
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
    assert.equal(found.indexState.status, "no_active_index");
    assert.equal(found.indexState.reindexRequired, true);
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
    assert.deepEqual(readyBody.blockers, [{
      code: "COLLECTION_NO_ACTIVE_PHYSICAL_COLLECTION",
      message: "No active physical collection exists. Run re-index first.",
      recommendedAction: "Run re-index for this collection.",
    }]);
    assert.deepEqual(readyBody.warnings, [{
      code: "COLLECTION_INDEX_JOB_ACTIVE",
      message: `Index job ${activeJobId} is queued.`,
      recommendedAction: "Wait for the current indexing job to finish before changing settings or starting another re-index.",
    }]);
    assert.deepEqual(readyBody.recommendedActions, [
      "Run re-index for this collection.",
      "Wait for the current indexing job to finish before changing settings or starting another re-index.",
    ]);
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
    assert.deepEqual(body.blockers, []);
    assert.deepEqual(body.warnings, [{
      code: "COLLECTION_INDEX_JOB_ACTIVE",
      message: `Index job ${activeJobId} is queued.`,
      recommendedAction: "Wait for the current indexing job to finish before changing settings or starting another re-index.",
    }]);
    assert.deepEqual(body.recommendedActions, [
      "Wait for the current indexing job to finish before changing settings or starting another re-index.",
    ]);
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

    availableOllamaModels = ["gemma3:4b-cloud", "bge-m3:latest"];
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
      assert.deepEqual(body.blockers.map((issue: any) => issue.code), [
        "EMBED_MODEL_MISSING",
        "CHAT_MODEL_MISSING",
      ]);
      assert.deepEqual(body.warnings, [{
        code: "COLLECTION_INDEX_JOB_ACTIVE",
        message: `Index job ${activeJobId} is queued.`,
        recommendedAction: "Wait for the current indexing job to finish before changing settings or starting another re-index.",
      }]);
      assert.deepEqual(body.recommendedActions, [
        "Pull the embedding model with: ollama pull missing-embed-model",
        "Pull the chat model with: ollama pull missing-chat-model",
        "Wait for the current indexing job to finish before changing settings or starting another re-index.",
      ]);
      assert.deepEqual(body.capabilities, {
        query: false,
        retrieve: false,
        reindex: true,
      });
    } finally {
      availableOllamaModels = ["gemma3:4b", "gemma3:4b-cloud", "gpt-oss:120b-cloud", "bge-m3:latest", "glm-5:cloud", "qwen3.5:cloud"];
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
      assert.equal(retrieveBody.embeddingModel, "embed-collection-specific");
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
      assert.equal(queryBody.embeddingModel, "embed-collection-specific");
      assert.equal(queryBody.chatModel, "chat-collection-specific");
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

  it("persists audit log entries, filters them and survives registry reopen", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vanilla-rag-audit-"));
    const dbPath = path.join(tempDir, "audit.sqlite");
    const auditRegistry = createSqliteCollectionRegistry({ dbPath });
    const auditContext = { tenantId: "default", userId: "local-dev", requestId: "audit-test" };
    const otherTenantContext = { tenantId: "other-tenant", userId: "other-user", requestId: "audit-other" };
    let auditCollection: RagCollection;
    let auditPeerCollection: RagCollection;
    let otherTenantCollection: RagCollection;

    const auditJobRunner: IndexJobRunner = {
      start: (jobId: string) => {
        void (async () => {
          const job = await auditRegistry.getJob(jobId);
          if (!job) return;

          try {
            await auditRegistry.createPhysicalCollectionRecord({
              name: job.targetPhysicalCollection,
              tenantId: job.tenantId,
              collectionId: job.collectionId,
              version: job.targetVersion,
              chromaConfiguration: job.targetChromaConfiguration,
            });
          } catch {
            // The target record may already exist if the route retried; continue.
          }

          await auditRegistry.markIndexJobRunning(jobId);
          void auditRegistry.appendOperationalLog?.({
            tenantId: auditContext.tenantId,
            userId: auditContext.userId,
            jobId,
            collectionId: job.collectionId,
            physicalCollection: job.targetPhysicalCollection,
            operation: "index_job",
            status: "started",
            message: "Index job started.",
          });
          await auditRegistry.completeIndexJob(jobId, {
            activePhysicalCollection: job.targetPhysicalCollection,
            activeVersion: job.targetVersion,
            documentCount: 7,
            chunkCount: 14,
            retentionMs: 0,
          });
          void auditRegistry.appendOperationalLog?.({
            tenantId: auditContext.tenantId,
            userId: auditContext.userId,
            jobId,
            collectionId: job.collectionId,
            physicalCollection: job.targetPhysicalCollection,
            operation: "index_job",
            status: "succeeded",
            message: "Index job completed.",
          });
        })().catch(() => {});
      },
      drain: async () => {},
      shutdown: async () => {},
      abort: async (jobId: string) => {
        await auditRegistry.cancelIndexJob(jobId);
      },
    };

    try {
      auditCollection = await auditRegistry.createCollection(auditContext, {
        displayName: "Audit Collection",
        sourcePath: "data/audit",
        ozelgeDataPath: "data/ozelge_veri.json",
        embeddingModel: "embed-audit",
        chatModel: "chat-audit",
        distanceMetric: "cosine",
        chunkSize: 128,
        chunkOverlap: 16,
        retrievalK: 4,
        retrievalDistanceThreshold: 0.5,
      });

      auditCollection = await auditRegistry.updateCollection(auditContext, auditCollection.id, {
        status: "ready",
        activeEmbeddingModel: "embed-audit",
        documentCount: 7,
        chunkCount: 14,
      });

      otherTenantCollection = await auditRegistry.createCollection(otherTenantContext, {
        displayName: "Other Tenant Audit Collection",
        sourcePath: "data/other-audit",
        ozelgeDataPath: "data/other-ozelge.json",
        embeddingModel: "embed-other",
        chatModel: "chat-other",
        distanceMetric: "cosine",
        chunkSize: 128,
        chunkOverlap: 16,
        retrievalK: 4,
        retrievalDistanceThreshold: 0.5,
      });

      auditPeerCollection = await auditRegistry.createCollection(auditContext, {
        displayName: "Audit Peer Collection",
        sourcePath: "data/audit-peer",
        ozelgeDataPath: "data/ozelge_peer.json",
        embeddingModel: "embed-peer",
        chatModel: "chat-peer",
        distanceMetric: "cosine",
        chunkSize: 128,
        chunkOverlap: 16,
        retrievalK: 4,
        retrievalDistanceThreshold: 0.5,
      });

      auditPeerCollection = await auditRegistry.updateCollection(auditContext, auditPeerCollection.id, {
        status: "ready",
        activeEmbeddingModel: "embed-peer",
        documentCount: 3,
        chunkCount: 6,
      });

      const auditApp = await startEphemeralApp({
        registry: auditRegistry,
        jobRunner: auditJobRunner,
        ragHandlers: {
          retrieveSources: async (_question, options) => ({
            distanceScoreThreshold: options.retrievalDistanceThreshold ?? 0.5,
            sources: [],
          }),
          answerQuestion: async (_question, options) => ({
            answer: "audit-answer",
            embeddingModel: options.embeddingModel ?? "embed-audit",
            chatModel: options.chatModel ?? "chat-audit",
            distanceScoreThreshold: options.retrievalDistanceThreshold ?? 0.5,
            sources: [],
          }),
          resolveReadableCollection: async () => auditCollection,
        },
        // Keep the reindex model preflight off the real Ollama instance.
        healthChecks: {
          checkOllamaModelDiscovery: async () => ({
            reachable: true,
            models: ["embed-audit", "embed-peer", "embed-other"],
            embeddingModels: ["embed-audit", "embed-peer", "embed-other"],
            chatModels: [],
            defaults: { embeddingModel: config.ollamaEmbeddingModel, chatModel: config.ollamaChatModel },
          }),
        },
        logEvent: () => {},
      });

      try {
        const querySuccess = await fetch(`${auditApp.baseUrl}/v1/rag/collections/${auditCollection.id}/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "audit-query-ok",
          },
          body: JSON.stringify({ question: "query audit?" }),
        });
        assert.equal(querySuccess.status, 200);
        await querySuccess.text();

        const retrieveSuccess = await fetch(`${auditApp.baseUrl}/v1/rag/collections/${auditCollection.id}/retrieve`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "audit-retrieve-ok",
          },
          body: JSON.stringify({ question: "retrieve audit?" }),
        });
        assert.equal(retrieveSuccess.status, 200);
        await retrieveSuccess.text();

        const queryFailure = await fetch(`${auditApp.baseUrl}/v1/rag/collections/${auditCollection.id}/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "audit-query-fail",
          },
          body: JSON.stringify({}),
        });
        assert.equal(queryFailure.status, 400);
        await queryFailure.text();

        const retrieveFailure = await fetch(`${auditApp.baseUrl}/v1/rag/collections/${auditCollection.id}/retrieve`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "audit-retrieve-fail",
          },
          body: JSON.stringify({}),
        });
        assert.equal(retrieveFailure.status, 400);
        await retrieveFailure.text();

        const reindexResponse = await fetch(`${auditApp.baseUrl}/v1/admin/collections/${auditCollection.id}/reindex`, {
          method: "POST",
          headers: {
            "x-request-id": "audit-reindex",
          },
        });
        const reindexBody = await reindexResponse.json() as any;
        assert.equal(reindexResponse.status, 202);
        assert.ok(reindexBody.job?.id);

        await new Promise((resolve) => setTimeout(resolve, 50));

        const peerReindexResponse = await fetch(`${auditApp.baseUrl}/v1/admin/collections/${auditPeerCollection.id}/reindex`, {
          method: "POST",
          headers: {
            "x-request-id": "audit-peer-reindex",
          },
        });
        const peerReindexBody = await peerReindexResponse.json() as any;
        assert.equal(peerReindexResponse.status, 202);
        assert.ok(peerReindexBody.job?.id);

        await new Promise((resolve) => setTimeout(resolve, 50));

        const batchJob1 = await auditRegistry.beginIndexJob(auditContext, auditCollection.id);
        await auditRegistry.failIndexJob(batchJob1.id, "Batch delete job 1 failed for audit test.");
        const batchJob2 = await auditRegistry.beginIndexJob(auditContext, auditCollection.id);
        await auditRegistry.failIndexJob(batchJob2.id, "Batch delete job 2 failed for audit test.");

        const bulkDeleteResponse = await fetch(`${auditApp.baseUrl}/v1/admin/jobs/bulk-delete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "audit-bulk-delete",
          },
          body: JSON.stringify({ jobIds: [batchJob1.id, batchJob2.id] }),
        });
        assert.equal(bulkDeleteResponse.status, 204);

        const auditResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&limit=2`);
        const auditBody = await auditResponse.json() as any;
        assert.equal(auditResponse.status, 200);
        assert.equal(auditResponse.headers.get("cache-control"), "no-store");
        assert.ok(Array.isArray(auditBody.auditLog));
        assert.ok(auditBody.auditLog.length > 0);
        assert.ok(auditBody.nextCursor);

        const queryAuditPage1 = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=query&limit=1`);
        const queryAuditBody1 = await queryAuditPage1.json() as any;
        assert.equal(queryAuditPage1.status, 200);
        assert.equal(queryAuditBody1.auditLog.length, 1);
        assert.ok(queryAuditBody1.nextCursor);
        assert.equal(queryAuditBody1.auditLog[0]?.status, "failed");

        const queryAuditPage2 = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=query&limit=1&cursor=${encodeURIComponent(queryAuditBody1.nextCursor)}`);
        const queryAuditBody2 = await queryAuditPage2.json() as any;
        assert.equal(queryAuditPage2.status, 200);
        assert.equal(queryAuditBody2.auditLog.length, 1);
        assert.equal(queryAuditBody2.auditLog[0]?.status, "succeeded");

        const retrieveAuditPage1 = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=retrieve&limit=1`);
        const retrieveAuditBody1 = await retrieveAuditPage1.json() as any;
        assert.equal(retrieveAuditPage1.status, 200);
        assert.equal(retrieveAuditBody1.auditLog.length, 1);
        assert.ok(retrieveAuditBody1.nextCursor);
        assert.equal(retrieveAuditBody1.auditLog[0]?.status, "failed");

        const retrieveAuditPage2 = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=retrieve&limit=1&cursor=${encodeURIComponent(retrieveAuditBody1.nextCursor)}`);
        const retrieveAuditBody2 = await retrieveAuditPage2.json() as any;
        assert.equal(retrieveAuditPage2.status, 200);
        assert.equal(retrieveAuditBody2.auditLog.length, 1);
        assert.equal(retrieveAuditBody2.auditLog[0]?.status, "succeeded");

        const jobAuditResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=index_job&limit=10`);
        const jobAuditBody = await jobAuditResponse.json() as any;
        assert.equal(jobAuditResponse.status, 200);
        assert.ok(jobAuditBody.auditLog.some((entry: any) => entry.status === "started" && entry.jobId === reindexBody.job.id));
        assert.ok(jobAuditBody.auditLog.some((entry: any) => entry.status === "succeeded" && entry.jobId === reindexBody.job.id));

        const multiOperationResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&operation=query&operation=retrieve&limit=10`);
        const multiOperationBody = await multiOperationResponse.json() as any;
        assert.equal(multiOperationResponse.status, 200);
        assert.ok(multiOperationBody.auditLog.some((entry: any) => entry.operation === "query"));
        assert.ok(multiOperationBody.auditLog.some((entry: any) => entry.operation === "retrieve"));

        const multiCollectionResponse = await fetch(
          `${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&collectionId=${encodeURIComponent(auditPeerCollection.id)}&operation=index_job&limit=10`,
        );
        const multiCollectionBody = await multiCollectionResponse.json() as any;
        assert.equal(multiCollectionResponse.status, 200);
        assert.ok(multiCollectionBody.auditLog.some((entry: any) => entry.collectionId === auditCollection.id));
        assert.ok(multiCollectionBody.auditLog.some((entry: any) => entry.collectionId === auditPeerCollection.id));

        const multiCollectionOperationResponse = await fetch(
          `${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&collectionId=${encodeURIComponent(auditPeerCollection.id)}&operation=query&operation=index_job&limit=50`,
        );
        const multiCollectionOperationBody = await multiCollectionOperationResponse.json() as any;
        assert.equal(multiCollectionOperationResponse.status, 200);
        assert.ok(multiCollectionOperationBody.auditLog.some((entry: any) => entry.operation === "query"));
        assert.ok(multiCollectionOperationBody.auditLog.some((entry: any) => entry.operation === "index_job"));

        const forbiddenAuditResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(otherTenantCollection.id)}&limit=10`);
        const forbiddenAuditBody = await forbiddenAuditResponse.json() as any;
        assert.equal(forbiddenAuditResponse.status, 403);
        assert.equal(forbiddenAuditBody.code, "COLLECTION_FORBIDDEN");

        const missingAuditResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent("col_missing_audit")}&limit=10`);
        const missingAuditBody = await missingAuditResponse.json() as any;
        assert.equal(missingAuditResponse.status, 404);
        assert.equal(missingAuditBody.code, "COLLECTION_NOT_FOUND");

        const invalidCursorResponse = await fetch(`${auditApp.baseUrl}/v1/admin/audit-log?collectionId=${encodeURIComponent(auditCollection.id)}&cursor=not-a-valid-cursor`);
        const invalidCursorBody = await invalidCursorResponse.json() as any;
        assert.equal(invalidCursorResponse.status, 400);
        assert.equal(invalidCursorBody.code, "INVALID_REQUEST_BODY");

        const deleteResponse = await fetch(`${auditApp.baseUrl}/v1/admin/collections/${auditCollection.id}`, {
          method: "DELETE",
          headers: {
            "x-request-id": "audit-delete",
          },
        });
        assert.equal(deleteResponse.status, 204);

        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        auditApp.server.closeIdleConnections?.();
        auditApp.server.closeAllConnections?.();
        auditApp.server.close();
      }

      const reopenedRegistry = createSqliteCollectionRegistry({ dbPath });
      const reopenedApp = await startEphemeralApp({
        registry: reopenedRegistry,
        jobRunner: {
          start: () => {},
          drain: async () => {},
          shutdown: async () => {},
          abort: async () => {},
        },
      });

      try {
        const reopenedResponse = await fetch(`${reopenedApp.baseUrl}/v1/admin/audit-log?limit=100`);
        const reopenedBody = await reopenedResponse.json() as any;
        assert.equal(reopenedResponse.status, 200);
        assert.ok(reopenedBody.auditLog.some((entry: any) => entry.operation === "delete" && entry.collectionId === auditCollection.id));

        const reopenedBulkResponse = await fetch(`${reopenedApp.baseUrl}/v1/admin/audit-log?operation=job_delete_batch&limit=10`);
        const reopenedBulkBody = await reopenedBulkResponse.json() as any;
        assert.equal(reopenedBulkResponse.status, 200);
        assert.ok(reopenedBulkBody.auditLog.some((entry: any) => entry.operation === "job_delete_batch"));
      } finally {
        reopenedApp.server.closeIdleConnections?.();
        reopenedApp.server.closeAllConnections?.();
        reopenedApp.server.close();
        (reopenedRegistry as { close?: () => void }).close?.();
      }
    } finally {
      (auditRegistry as { close?: () => void }).close?.();
      await fs.rm(tempDir, { recursive: true, force: true });
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
        ...testRuntimeConfig,
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
        ...testRuntimeConfig,
        includeDebugTimings: true,
      },
      ragHandlers: {
        resolveReadableCollection: async () => debugCollection,
        answerQuestion: async (_question, options) => {
          assert.equal(options.includeDebugTimings, true);
          return {
            answer: "debug-answer",
            embeddingModel: options.embeddingModel ?? config.ollamaEmbeddingModel,
            chatModel: options.chatModel ?? config.ollamaChatModel,
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
    assert.equal(body.collection.indexState.status, "reindex_required");
    assert.equal(body.collection.indexState.reindexRequired, true);
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

  it("admin collection validation returns issues without mutating state", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "validate-create" };
    const beforeCollections = await registry.listVisibleCollections(ctx);
    const beforeJobs = await registry.listJobs(ctx);

    const response = await request("/v1/admin/collections/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Validation Draft",
        sourcePath: "missing/source/path",
        ozelgeDataPath: "missing/source/path/ozelge.json",
        chunkSize: 64,
        chunkOverlap: 64,
        embeddingModel: "bge-m3",
        chatModel: "gemma3:4b-cloud",
      }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body.blockers), true);
    assert.equal(body.blockers.some((issue: any) => issue.code === "INDEXING_SOURCE_UNREADABLE"), true);
    assert.equal(body.blockers.some((issue: any) => issue.code === "COLLECTION_CHUNK_OVERLAP_INVALID"), true);
    assert.equal(Array.isArray(body.warnings), true);
    assert.equal(Array.isArray(body.recommendedActions), true);
    assert.equal(body.impact.reindexRequired, true);
    assert.equal(body.impact.immediateFields.includes("displayName"), true);
    assert.equal(body.impact.reindexFields.includes("sourcePath"), true);
    assert.equal((await registry.listVisibleCollections(ctx)).length, beforeCollections.length);
    assert.equal((await registry.listJobs(ctx)).jobs.length, beforeJobs.jobs.length);
  });

  it("admin collection validation rejects invalid request bodies with INVALID_REQUEST_BODY", async () => {
    const response = await request("/v1/admin/collections/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unknownPatchKey: true }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST_BODY");
    assert.ok(Array.isArray(body.details?.issues));
  });

  it("admin collection validate overlays the persisted collection and respects tenant scope", async () => {
    const createResponse = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Validation Base Collection",
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge_veri.json",
        chunkSize: 128,
        chunkOverlap: 32,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.3,
        embeddingModel: "bge-m3",
        chatModel: "gemma3:4b-cloud",
      }),
    });
    const createBody = await createResponse.json() as any;
    assert.equal(createResponse.status, 201);

    const response = await request(`/v1/admin/collections/${createBody.collection.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body.blockers), true);
    assert.equal(body.blockers.length, 0);
    assert.equal(Array.isArray(body.warnings), true);
    assert.equal(Array.isArray(body.recommendedActions), true);
    assert.equal(body.impact.reindexRequired, false);
    assert.deepEqual(body.impact.immediateFields, []);
    assert.deepEqual(body.impact.reindexFields, []);

    const forbiddenResponse = await request(`/v1/admin/collections/${createBody.collection.id}/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "other-tenant",
      },
      body: JSON.stringify({}),
    });
    const forbiddenBody = await forbiddenResponse.json() as any;
    assert.equal(forbiddenResponse.status, 403);
    assert.equal(forbiddenBody.code, "COLLECTION_FORBIDDEN");
  });

  it("admin collection validate classifies immediate and reindex-bound changes", async () => {
    const createResponse = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Impact Test Collection",
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge_veri.json",
        chunkSize: 128,
        chunkOverlap: 32,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.3,
        embeddingModel: "bge-m3",
        chatModel: "gemma3:4b-cloud",
      }),
    });
    const createBody = await createResponse.json() as any;
    assert.equal(createResponse.status, 201);

    const immediateResponse = await request(`/v1/admin/collections/${createBody.collection.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retrievalK: 11 }),
    });
    const immediateBody = await immediateResponse.json() as any;
    assert.equal(immediateResponse.status, 200);
    assert.equal(immediateBody.impact.reindexRequired, false);
    assert.equal(immediateBody.impact.immediateFields.includes("retrievalK"), true);
    assert.equal(immediateBody.impact.reindexFields.length, 0);

    const reindexResponse = await request(`/v1/admin/collections/${createBody.collection.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chunkSize: 256 }),
    });
    const reindexBody = await reindexResponse.json() as any;
    assert.equal(reindexResponse.status, 200);
    assert.equal(reindexBody.impact.reindexRequired, true);
    assert.equal(reindexBody.impact.reindexFields.includes("chunkSize"), true);
  });

  it("admin collection validate skips Chroma checks for immediate-only changes", async () => {
    const createResponse = await request("/v1/admin/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Immediate Impact Collection",
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge_veri.json",
        chunkSize: 128,
        chunkOverlap: 32,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.3,
        embeddingModel: "bge-m3",
        chatModel: "gemma3:4b-cloud",
      }),
    });
    const createBody = await createResponse.json() as any;
    assert.equal(createResponse.status, 201);

    const ctx = { tenantId: "default", userId: "local-dev", requestId: "immediate-only-validate" };
    await registry.updateCollection(ctx, createBody.collection.id, {
      status: "ready",
      activePhysicalCollection: "unreachable-physical-collection",
      activeVersion: "v-immediate-only",
    });

    const response = await request(`/v1/admin/collections/${createBody.collection.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retrievalK: 11 }),
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.impact.reindexRequired, false);
    assert.equal(body.blockers.some((issue: any) => issue.code === "CHROMA_UNREACHABLE"), false);
    assert.equal(body.blockers.some((issue: any) => issue.code === "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE"), false);
  });

  it("GET /v1/admin/models returns discovered Ollama models and runtime defaults", async () => {
    const response = await request("/v1/admin/models", {
      method: "GET",
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(body.reachable, true);
    assert.deepEqual(body.defaults, {
      embeddingModel: config.ollamaEmbeddingModel,
      chatModel: config.ollamaChatModel,
    });
    assert.ok(Array.isArray(body.models));
    assert.ok(Array.isArray(body.embeddingModels));
    assert.ok(Array.isArray(body.chatModels));
    assert.ok(body.embeddingModels.some((model: string) => model.startsWith("bge-m3")));
    assert.ok(body.chatModels.includes("gemma3:4b"));
    assert.ok(body.chatModels.includes("gemma3:4b-cloud"));
    assert.ok(body.models.includes("gpt-oss:120b-cloud"));
  });

  it("GET /v1/admin/config/defaults returns runtime create defaults", async () => {
    const response = await request("/v1/admin/config/defaults", {
      method: "GET",
      headers: {
        "x-tenant-id": "default",
        "x-user-id": "local-dev",
        "x-request-id": "config-defaults-test",
      },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.deepEqual(body.collectionDefaults, {
      sourcePath: config.collectionDefaults.sourcePath,
      ozelgeDataPath: config.collectionDefaults.ozelgeDataPath,
      distanceMetric: config.chromaDistanceMetric,
      indexSampleSize: config.indexSampleSize,
      chunkSize: config.collectionDefaults.chunkSize,
      chunkOverlap: config.collectionDefaults.chunkOverlap,
      retrievalK: config.collectionDefaults.retrievalK,
      retrievalDistanceThreshold: config.collectionDefaults.retrievalDistanceThreshold,
    });
    assert.deepEqual(body.modelDefaults, {
      embeddingModel: config.ollamaEmbeddingModel,
      chatModel: config.ollamaChatModel,
    });
  });

  it("GET /v1/admin/models soft-fails when Ollama discovery is unavailable", async () => {
    const previousReachable = ollamaModelDiscoveryReachable;
    ollamaModelDiscoveryReachable = false;

    try {
      const response = await request("/v1/admin/models", {
        method: "GET",
      });
      const body = await response.json() as any;

      assert.equal(response.status, 200);
      assert.equal(body.reachable, false);
      assert.deepEqual(body.models, []);
      assert.deepEqual(body.embeddingModels, []);
      assert.deepEqual(body.chatModels, []);
      assert.deepEqual(body.defaults, {
        embeddingModel: config.ollamaEmbeddingModel,
        chatModel: config.ollamaChatModel,
      });
    } finally {
      ollamaModelDiscoveryReachable = previousReachable;
    }
  });

  describe("Ollama model preflight", () => {
    const preflightCtx = { tenantId: "default", userId: "local-dev", requestId: "model-preflight" };

    async function createRegistryCollection(displayName: string, embeddingModel: string, chatModel: string) {
      return registry.createCollection(preflightCtx, {
        displayName,
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge.json",
        embeddingModel,
        chatModel,
        distanceMetric: "l2",
        chunkSize: 500,
        chunkOverlap: 50,
        retrievalK: 5,
        retrievalDistanceThreshold: 1,
      });
    }

    async function countVisibleCollections(): Promise<number> {
      return (await registry.listVisibleCollections(preflightCtx)).length;
    }

    it("POST /v1/admin/collections rejects a missing embedding model with 422 UNAVAILABLE_MODEL and creates nothing", async () => {
      const before = await countVisibleCollections();
      const response = await request("/v1/admin/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Preflight Missing Embed", embeddingModel: "not-pulled-embed" }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 422);
      assert.equal(body.code, "UNAVAILABLE_MODEL");
      assert.match(body.message, /Collection cannot be created\./);
      assert.match(body.message, /Embedding model 'not-pulled-embed' is not available in Ollama/);
      assert.deepEqual(body.details.missingModels, [{ role: "embedding", name: "not-pulled-embed" }]);
      assert.deepEqual(body.details.availableModels, availableOllamaModels);
      assert.deepEqual(body.details.recommendedActions, ["ollama pull not-pulled-embed"]);
      assert.equal(await countVisibleCollections(), before);
    });

    it("POST /v1/admin/collections reports both missing models", async () => {
      const response = await request("/v1/admin/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Preflight Missing Both",
          embeddingModel: "not-pulled-embed",
          chatModel: "not-pulled-chat",
        }),
      });
      const body = await response.json() as any;

      assert.equal(response.status, 422);
      assert.deepEqual(body.details.missingModels, [
        { role: "embedding", name: "not-pulled-embed" },
        { role: "chat", name: "not-pulled-chat" },
      ]);
    });

    it("POST /v1/admin/collections accepts ':latest'-tagged models for untagged names", async () => {
      // availableOllamaModels contains "bge-m3:latest"; the request uses "bge-m3".
      const response = await request("/v1/admin/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Preflight Latest Tag", embeddingModel: "bge-m3", chatModel: "gemma3:4b-cloud" }),
      });

      assert.equal(response.status, 201);
    });

    it("POST /v1/admin/collections returns 503 OLLAMA_UNREACHABLE when Ollama is down and creates nothing", async () => {
      const previousReachable = ollamaModelDiscoveryReachable;
      ollamaModelDiscoveryReachable = false;
      const before = await countVisibleCollections();

      try {
        const response = await request("/v1/admin/collections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "Preflight Ollama Down" }),
        });
        const body = await response.json() as any;

        assert.equal(response.status, 503);
        assert.equal(body.code, "OLLAMA_UNREACHABLE");
        assert.equal(body.details.ollamaBaseUrl, config.ollamaBaseUrl);
        assert.equal(await countVisibleCollections(), before);
      } finally {
        ollamaModelDiscoveryReachable = previousReachable;
      }
    });

    it("POST /v1/admin/collections/:id/reindex rejects a missing embedding model with 422 and does not start a job", async () => {
      const collection = await createRegistryCollection("Preflight Reindex Missing Embed", "not-pulled-embed", config.ollamaChatModel);

      const response = await request(`/v1/admin/collections/${collection.id}/reindex`, { method: "POST" });
      const body = await response.json() as any;

      assert.equal(response.status, 422);
      assert.equal(body.code, "UNAVAILABLE_MODEL");
      assert.match(body.message, /^Re-index cannot start\. Embedding model 'not-pulled-embed' is not available in Ollama\./);
      assert.deepEqual(body.details.recommendedActions, ["ollama pull not-pulled-embed"]);
      assert.equal(await registry.getActiveJobForCollection(preflightCtx, collection.id), null);
      const unchanged = await registry.getVisibleCollection(preflightCtx, collection.id);
      assert.notEqual(unchanged?.status, "indexing");
    });

    it("POST /v1/admin/collections/:id/reindex does not require the chat model (retrieve-only indexing)", async () => {
      const collection = await createRegistryCollection("Preflight Reindex Missing Chat", config.ollamaEmbeddingModel, "not-pulled-chat");

      const response = await request(`/v1/admin/collections/${collection.id}/reindex`, { method: "POST" });
      const body = await response.json() as any;

      assert.equal(response.status, 202);
      assert.equal(body.job.status, "queued");
      await registry.cancelIndexJob(body.job.id);
    });

    it("POST /v1/admin/collections/:id/reindex returns 503 OLLAMA_UNREACHABLE when Ollama is down", async () => {
      const collection = await createRegistryCollection("Preflight Reindex Ollama Down", config.ollamaEmbeddingModel, config.ollamaChatModel);
      const previousReachable = ollamaModelDiscoveryReachable;
      ollamaModelDiscoveryReachable = false;

      try {
        const response = await request(`/v1/admin/collections/${collection.id}/reindex`, { method: "POST" });
        const body = await response.json() as any;

        assert.equal(response.status, 503);
        assert.equal(body.code, "OLLAMA_UNREACHABLE");
        assert.equal(await registry.getActiveJobForCollection(preflightCtx, collection.id), null);
      } finally {
        ollamaModelDiscoveryReachable = previousReachable;
      }
    });

    it("POST /v1/admin/collections/:id/reindex reports an active job (409) before probing models", async () => {
      const collection = await createRegistryCollection("Preflight Reindex Conflict", config.ollamaEmbeddingModel, config.ollamaChatModel);
      const first = await request(`/v1/admin/collections/${collection.id}/reindex`, { method: "POST" });
      assert.equal(first.status, 202);
      const firstBody = await first.json() as any;

      // Even with the embedding model now missing, the in-flight job is the more useful answer.
      await registry.updateCollection(preflightCtx, collection.id, { embeddingModel: "not-pulled-embed" });
      const second = await request(`/v1/admin/collections/${collection.id}/reindex`, { method: "POST" });
      const secondBody = await second.json() as any;

      assert.equal(second.status, 409);
      assert.equal(secondBody.code, "COLLECTION_INDEX_ALREADY_RUNNING");
      assert.equal(secondBody.details.jobId, firstBody.job.id);
      await registry.cancelIndexJob(firstBody.job.id);
    });
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

  it("GET /v1/admin/collections/:collectionId/physical-collections exposes lifecycle visibility for active, failed_build and cleanup-bound records", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "physical-visibility" };
    const collection = await registry.createCollection(ctx, {
      displayName: "Physical Visibility",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const firstQueued = await registry.beginIndexJob(ctx, collection.id, {
      targetVersion: "20260701t110000_000z",
    });
    const firstRunning = await registry.markIndexJobRunning(firstQueued.id);
    await registry.createPhysicalCollectionRecord({
      name: firstRunning.targetPhysicalCollection,
      tenantId: ctx.tenantId,
      collectionId: collection.id,
      version: firstRunning.targetVersion,
      chromaConfiguration: firstRunning.targetChromaConfiguration,
    });
    await registry.completeIndexJob(firstRunning.id, {
      activePhysicalCollection: firstRunning.targetPhysicalCollection,
      activeVersion: firstRunning.targetVersion,
      documentCount: 10,
      chunkCount: 40,
      retentionMs: 0,
    });

    const secondQueued = await registry.beginIndexJob(ctx, collection.id, {
      targetVersion: "20260701t111000_000z",
    });
    const secondRunning = await registry.markIndexJobRunning(secondQueued.id);
    await registry.createPhysicalCollectionRecord({
      name: secondRunning.targetPhysicalCollection,
      tenantId: ctx.tenantId,
      collectionId: collection.id,
      version: secondRunning.targetVersion,
      chromaConfiguration: secondRunning.targetChromaConfiguration,
    });
    await registry.completeIndexJob(secondRunning.id, {
      activePhysicalCollection: secondRunning.targetPhysicalCollection,
      activeVersion: secondRunning.targetVersion,
      documentCount: 12,
      chunkCount: 48,
      retentionMs: 0,
    });

    const failedQueued = await registry.beginIndexJob(ctx, collection.id, {
      targetVersion: "20260701t112000_000z",
    });
    const failedRunning = await registry.markIndexJobRunning(failedQueued.id);
    await registry.createPhysicalCollectionRecord({
      name: failedRunning.targetPhysicalCollection,
      tenantId: ctx.tenantId,
      collectionId: collection.id,
      version: failedRunning.targetVersion,
      chromaConfiguration: failedRunning.targetChromaConfiguration,
    });
    await registry.failIndexJob(failedRunning.id, "Injected failed build");

    const response = await request(`/v1/admin/collections/${collection.id}/physical-collections`, {
      headers: { "x-tenant-id": "default" },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.collectionId, collection.id);
    assert.deepEqual(
      body.physicalCollections.map((record: any) => ({
        status: record.status,
        version: record.version,
      })),
      [
        { status: "failed_build", version: "20260701t112000_000z" },
        { status: "active", version: "20260701t111000_000z" },
        { status: "delete_pending", version: "20260701t110000_000z" },
      ],
    );
    assert.equal(body.physicalCollections[0].cleanupError, "Injected failed build");
    assert.equal(body.physicalCollections[1].chunkCount, 48);
    assert.equal(typeof body.physicalCollections[2].deleteAfter, "string");
  });

  it("admin physical collection visibility is tenant-scoped and returns 403 for another tenant", async () => {
    const response = await request(`/v1/admin/collections/${createdCollection.id}/physical-collections`, {
      headers: { "x-tenant-id": "other-tenant" },
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

    const syncedCollection = await registry.getVisibleCollection(
      { tenantId: "default", userId: "local-dev", requestId: "jobs-list-sync" },
      succeededDefault.collectionId,
    );
    assert.ok(syncedCollection);
    assert.equal(syncedCollection?.indexState?.status, "synced");
    assert.equal(syncedCollection?.indexState?.reindexRequired, false);

    await registry.updateCollection(
      { tenantId: "default", userId: "local-dev", requestId: "jobs-list-dirty" },
      succeededDefault.collectionId,
      {
        chunkOverlap: 8,
      },
    );

    const dirtyCollection = await registry.getVisibleCollection(
      { tenantId: "default", userId: "local-dev", requestId: "jobs-list-dirty-read" },
      succeededDefault.collectionId,
    );
    assert.ok(dirtyCollection);
    assert.equal(dirtyCollection?.indexState?.status, "reindex_required");
    assert.equal(dirtyCollection?.indexState?.reindexRequired, true);
    assert.ok(dirtyCollection?.indexState?.changedFields.includes("chunkOverlap"));

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

  it("DELETE /v1/admin/jobs/:jobId removes terminal jobs and hides them from the list", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "job-delete-terminal" };
    const collection = await registry.createCollection(ctx, {
      displayName: "Job Delete Terminal",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const job = await registry.beginIndexJob(ctx, collection.id);
    await registry.markIndexJobRunning(job.id);
    const running = await registry.getJob(job.id);
    assert.ok(running);
    await registry.createPhysicalCollectionRecord({
      name: running.targetPhysicalCollection,
      tenantId: ctx.tenantId,
      collectionId: collection.id,
      version: running.targetVersion,
      chromaConfiguration: running.targetChromaConfiguration,
    });
    await registry.completeIndexJob(job.id, {
      activePhysicalCollection: running.targetPhysicalCollection,
      activeVersion: running.targetVersion,
      documentCount: 2,
      chunkCount: 4,
      retentionMs: 0,
    });

    const deleteResponse = await request(`/v1/admin/jobs/${job.id}`, {
      method: "DELETE",
      headers: { "x-tenant-id": "default" },
    });
    assert.equal(deleteResponse.status, 204);

    const getResponse = await request(`/v1/admin/jobs/${job.id}`, {
      headers: { "x-tenant-id": "default" },
    });
    assert.equal(getResponse.status, 404);

    const listResponse = await request(`/v1/admin/jobs?collectionId=${encodeURIComponent(collection.id)}`, {
      headers: { "x-tenant-id": "default" },
    });
    const listBody = await listResponse.json() as any;
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.jobs.some((entry: any) => entry.job.id === job.id), false);
  });

  it("DELETE /v1/admin/jobs/:jobId rejects queued or running jobs", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "job-delete-running" };
    const collection = await registry.createCollection(ctx, {
      displayName: "Job Delete Running",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const job = await registry.beginIndexJob(ctx, collection.id);
    const deleteResponse = await request(`/v1/admin/jobs/${job.id}`, {
      method: "DELETE",
      headers: { "x-tenant-id": "default" },
    });
    const body = await deleteResponse.json() as any;
    assert.equal(deleteResponse.status, 400);
    assert.equal(body.code, "INVALID_JOB_STATUS");
  });

  it("GET /v1/admin/jobs/:jobId/events returns the persisted job timeline", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "job-events" };
    const collection = await registry.createCollection(ctx, {
      displayName: "Job Events",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const queuedJob = await registry.beginIndexJob(ctx, collection.id);
    await registry.markIndexJobRunning(queuedJob.id);

    const response = await request(`/v1/admin/jobs/${queuedJob.id}/events`, {
      headers: { "x-tenant-id": "default" },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.jobId, queuedJob.id);
    assert.deepEqual(body.events.map((event: any) => event.code), [
      "JOB_QUEUED",
      "JOB_RUNNING",
    ]);
    assert.deepEqual(body.events.map((event: any) => event.stage), [
      "queued",
      "running",
    ]);
    assert.deepEqual(body.events.map((event: any) => event.sequence), [1, 2]);
  });

  it("POST /v1/admin/jobs/bulk-delete removes terminal jobs and hides them from the list", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "job-bulk-delete-terminal" };

    const createTerminalJob = async (displayName: string) => {
      const collection = await registry.createCollection(ctx, {
        displayName,
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge.json",
        embeddingModel: "embed",
        chatModel: "chat",
        distanceMetric: "l2",
        chunkSize: 500,
        chunkOverlap: 50,
        retrievalK: 5,
        retrievalDistanceThreshold: 1,
      });

      const job = await registry.beginIndexJob(ctx, collection.id);
      await registry.markIndexJobRunning(job.id);
      const running = await registry.getJob(job.id);
      assert.ok(running);
      await registry.createPhysicalCollectionRecord({
        name: running.targetPhysicalCollection,
        tenantId: ctx.tenantId,
        collectionId: collection.id,
        version: running.targetVersion,
        chromaConfiguration: running.targetChromaConfiguration,
      });
      await registry.completeIndexJob(job.id, {
        activePhysicalCollection: running.targetPhysicalCollection,
        activeVersion: running.targetVersion,
        documentCount: 2,
        chunkCount: 4,
        retentionMs: 0,
      });

      return job.id;
    };

    const jobIds = [
      await createTerminalJob("Job Bulk Delete Terminal 1"),
      await createTerminalJob("Job Bulk Delete Terminal 2"),
    ];

    const deleteResponse = await request("/v1/admin/jobs/bulk-delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "default",
      },
      body: JSON.stringify({ jobIds }),
    });
    assert.equal(deleteResponse.status, 204);

    for (const jobId of jobIds) {
      const getResponse = await request(`/v1/admin/jobs/${jobId}`, {
        headers: { "x-tenant-id": "default" },
      });
      assert.equal(getResponse.status, 404);
    }

    const listResponse = await request("/v1/admin/jobs?limit=25", {
      headers: { "x-tenant-id": "default" },
    });
    const listBody = await listResponse.json() as any;
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.jobs.some((entry: any) => jobIds.includes(entry.job.id)), false);
  });

  it("POST /v1/admin/jobs/bulk-delete rejects queued or running jobs", async () => {
    const ctx = { tenantId: "default", userId: "local-dev", requestId: "job-bulk-delete-running" };

    const terminalCollection = await registry.createCollection(ctx, {
      displayName: "Job Bulk Delete Terminal",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });
    const terminalJob = await registry.beginIndexJob(ctx, terminalCollection.id);
    await registry.markIndexJobRunning(terminalJob.id);
    const runningTerminal = await registry.getJob(terminalJob.id);
    assert.ok(runningTerminal);
    await registry.createPhysicalCollectionRecord({
      name: runningTerminal.targetPhysicalCollection,
      tenantId: ctx.tenantId,
      collectionId: terminalCollection.id,
      version: runningTerminal.targetVersion,
      chromaConfiguration: runningTerminal.targetChromaConfiguration,
    });
    await registry.completeIndexJob(terminalJob.id, {
      activePhysicalCollection: runningTerminal.targetPhysicalCollection,
      activeVersion: runningTerminal.targetVersion,
      documentCount: 2,
      chunkCount: 4,
      retentionMs: 0,
    });

    const queuedCollection = await registry.createCollection(ctx, {
      displayName: "Job Bulk Delete Queued",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge.json",
      embeddingModel: "embed",
      chatModel: "chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });
    const queuedJob = await registry.beginIndexJob(ctx, queuedCollection.id);

    const deleteResponse = await request("/v1/admin/jobs/bulk-delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "default",
      },
      body: JSON.stringify({ jobIds: [terminalJob.id, queuedJob.id] }),
    });
    const body = await deleteResponse.json() as any;

    assert.equal(deleteResponse.status, 400);
    assert.equal(body.code, "INVALID_JOB_STATUS");

    const terminalCheck = await request(`/v1/admin/jobs/${terminalJob.id}`, {
      headers: { "x-tenant-id": "default" },
    });
    const queuedCheck = await request(`/v1/admin/jobs/${queuedJob.id}`, {
      headers: { "x-tenant-id": "default" },
    });
    assert.equal(terminalCheck.status, 200);
    assert.equal(queuedCheck.status, 200);
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
    assert.equal(collection.indexState.status, 'no_active_index');
    assert.equal(collection.indexState.reindexRequired, true);
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
      embeddingModel: config.ollamaEmbeddingModel,
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
