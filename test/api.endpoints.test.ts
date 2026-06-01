import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry, RagCollection } from "../src/collections/types.js";
import type { IndexJobRunner } from "../src/indexing/jobRunner.js";

let server: Server;
let baseUrl: string;
let registry: CollectionRegistry;
let jobRunner: IndexJobRunner;

before(async () => {
  registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
  jobRunner = {
    start: () => {},
    drain: async () => {},
    shutdown: async () => {},
  };
  const app = createApp({ registry, jobRunner });

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
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
    const response = await request("/v1/rag/collections");
    const body = await response.json() as any;

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.collections));
    const found = body.collections.find((c: any) => c.id === createdCollection.id);
    assert.ok(found);
    assert.equal(found.displayName, "API Test Collection");
    assert.equal(found.capabilities.query, false); // Because status is 'creating'
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

  it("duplicate reindex -> 409", async () => {
    // start first job
    const res1 = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res1.status, 202);

    // attempt second job while first is queued/running
    const res2 = await request(`/v1/admin/collections/${createdCollection.id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    
    assert.equal(res2.status, 409);
    const body2 = await res2.json() as any;
    assert.equal(body2.code, "COLLECTION_INDEX_ALREADY_RUNNING");
  });
});
