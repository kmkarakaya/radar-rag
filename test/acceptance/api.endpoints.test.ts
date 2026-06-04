import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../src/app.js";
import { createSqliteCollectionRegistry } from "../../src/collections/sqliteRegistry.js";
import { resolveReadableCollection as actualResolveReadableCollection } from "../../src/collections/resolveReadableCollection.js";
import type { CollectionRegistry, RagCollection } from "../../src/collections/types.js";
import type { IndexJobRunner } from "../../src/indexing/jobRunner.js";

let server: Server;
let baseUrl: string;
let registry: CollectionRegistry;
let jobRunner: IndexJobRunner;
const readablePhysicalCollections = new Map<string, number>();
const retrieveCalls: Array<Record<string, unknown>> = [];
const answerCalls: Array<Record<string, unknown>> = [];
let resolveReadableCollectionOverride: typeof actualResolveReadableCollection | undefined;
let availableOllamaModels = ["gemma3:4b-cloud", "bge-m3", "chat-collection-specific", "embed-collection-specific"];

before(async () => {
  registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
  jobRunner = {
    start: () => {},
    drain: async () => {},
    shutdown: async () => {},
  };
  const app = createApp({
    registry,
    jobRunner,
    ragHandlers: {
      retrieveSources: async (_question, options) => {
        retrieveCalls.push({ ...options });
        return {
          distanceScoreThreshold: options.retrievalDistanceThreshold ?? -1,
          sources: [],
        };
      },
      answerQuestion: async (_question, options) => {
        answerCalls.push({ ...options });
        return {
          answer: "stub-answer",
          distanceScoreThreshold: options.retrievalDistanceThreshold ?? -1,
          sources: [],
        };
      },
      resolveReadableCollection: async (req, deps, runtimeConfig) => {
        if (resolveReadableCollectionOverride) {
          return resolveReadableCollectionOverride(req, deps, runtimeConfig);
        }

        return actualResolveReadableCollection(req, deps, runtimeConfig);
      },
    },
    healthChecks: {
      checkOllamaHealth: async () => ({
        ok: true,
        latencyMs: 1,
        details: {
          reachable: true,
          availableModels: availableOllamaModels,
          missingModels: [],
          chatModelAvailable: true,
          embeddingModelAvailable: true,
        },
      }),
      checkChromaHealth: async (_runtimeConfig, options) => {
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

  it("GET /v1/rag/collections lists collections", async () => {
    retrieveCalls.length = 0;
    answerCalls.length = 0;
    const response = await request("/v1/rag/collections");
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.collections));
    const found = body.collections.find((c: any) => c.id === createdCollection.id);
    assert.ok(found);
    assert.equal(found.displayName, "API Test Collection");
    assert.equal(found.capabilities.query, false); // Because status is 'creating'
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

  it("missing collection -> 404", async () => {
    const response = await request("/v1/rag/collections/non-existent-123/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "hello?" }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 404);
    assert.equal(body.code, "COLLECTION_NOT_FOUND");
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
    const response = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = await response.json() as any;

    assert.equal(response.status, 202);
    activeJobId = body.job.id;

    const readyResponse = await request(`/v1/rag/collections/${createdCollection.id}/ready`);
    const readyBody = await readyResponse.json() as any;

    assert.equal(readyResponse.status, 200);
    assert.equal(readyBody.activePhysicalCollection, null);
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
    assert.equal(body.activePhysicalCollection, activePhysicalCollection);
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "threshold?" }),
      });
      const retrieveBody = await retrieveResponse.json() as any;

      assert.equal(retrieveResponse.status, 200);
      assert.equal(retrieveBody.question, "threshold?");
      assert.equal(retrieveBody.k, 7);
      assert.equal(retrieveBody.sourceCount, 0);
      assert.equal(retrieveBody.distanceScoreThreshold, 0.42);
      assert.equal(retrieveCalls.length, 1);
      assert.equal(retrieveCalls[0]?.embeddingModel, "embed-collection-specific");
      assert.equal(retrieveCalls[0]?.retrievalDistanceThreshold, 0.42);
      assert.equal(retrieveCalls[0]?.k, 7);

      const queryResponse = await request(`/v1/rag/collections/${createdCollection.id}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "models?" }),
      });
      const queryBody = await queryResponse.json() as any;

      assert.equal(queryResponse.status, 200);
      assert.equal(queryBody.distanceScoreThreshold, 0.42);
      assert.equal(answerCalls.length, 1);
      assert.equal(answerCalls[0]?.embeddingModel, "embed-collection-specific");
      assert.equal(answerCalls[0]?.chatModel, "chat-collection-specific");
      assert.equal(answerCalls[0]?.retrievalDistanceThreshold, 0.42);
      assert.equal(answerCalls[0]?.retrievalK, 7);
    } finally {
      resolveReadableCollectionOverride = undefined;
    }
  });

  it("admin collection update returns the updated collection payload", async () => {
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
      }),
    });

    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.collection.displayName, "API Patched Collection");
    assert.equal(body.collection.sourcePath, "data/api-test-updated");
    assert.equal(body.collection.ozelgeDataPath, "data/api-test-updated-ozelge.json");
    assert.equal("description" in body.collection, false);

    const ctx = { tenantId: "default", userId: "local-dev", requestId: "patch-check" };
    const saved = await registry.getVisibleCollection(ctx, createdCollection.id);
    assert.equal(saved?.displayName, "API Patched Collection");
    assert.equal(saved?.description, undefined);
    assert.equal(saved?.sourcePath, "data/api-test-updated");
    assert.equal(saved?.ozelgeDataPath, "data/api-test-updated-ozelge.json");
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

  it("duplicate reindex -> 409", async () => {

    const res2 = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    
    assert.equal(res2.status, 409);
    const body2 = await res2.json() as any;
    assert.equal(body2.code, "COLLECTION_INDEX_ALREADY_RUNNING");
  });
});
