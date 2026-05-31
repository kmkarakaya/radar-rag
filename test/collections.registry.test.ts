import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type {
  CollectionRegistry,
  CreateCollectionInput,
  RequestContext,
} from "../src/collections/types.js";

let tempDir: string;
let registry: CollectionRegistry;

const context: RequestContext = {
  requestId: "registry-test",
  tenantId: "default",
  userId: "local-dev",
};

const collectionInput: CreateCollectionInput = {
  displayName: "Test Belgeleri",
  description: "Test collection",
  sourcePath: "data",
  ozelgeDataPath: "data/ozelge_veri.json",
  embeddingModel: "bge-m3",
  chatModel: "gemma3:4b-cloud",
  distanceMetric: "l2",
  chunkSize: 500,
  chunkOverlap: 200,
  retrievalK: 5,
  retrievalDistanceThreshold: 1,
};

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vanilla-rag-registry-"));
  registry = createSqliteCollectionRegistry({
    dbPath: path.join(tempDir, "registry.sqlite"),
  });
});

afterEach(async () => {
  registry.close?.();
  await rm(tempDir, { recursive: true, force: true });
});

describe("sqlite collection registry", () => {
  it("creates, lists, and gets tenant-visible collections", async () => {
    const collection = await registry.createCollection(context, collectionInput);

    assert.match(collection.id, /^test-belgeleri-[a-f0-9]{10}$/);
    assert.equal(collection.tenantId, context.tenantId);
    assert.equal(collection.createdBy, context.userId);
    assert.equal(collection.status, "creating");
    assert.equal(collection.distanceMetric, "l2");
    assert.deepEqual(collection.chromaCollectionConfiguration, {
      hnsw: {
        space: "l2",
      },
    });

    const list = await registry.listVisibleCollections(context);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, collection.id);

    const fetched = await registry.getVisibleCollection(context, collection.id);
    assert.equal(fetched?.displayName, "Test Belgeleri");

    const otherTenant = await registry.getVisibleCollection(
      { ...context, tenantId: "other" },
      collection.id,
    );
    assert.equal(otherTenant, null);
  });

  it("prevents a second queued or running job for the same collection", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const firstJob = await registry.beginIndexJob(context, collection.id);

    assert.equal(firstJob.status, "queued");
    assert.match(firstJob.targetPhysicalCollection, /^rag_default_test-belgeleri-[a-f0-9]{10}_/);

    await assert.rejects(
      () => registry.beginIndexJob(context, collection.id),
      /queued or running index job/,
    );

    await registry.completeIndexJob(firstJob.id, {
      documentCount: 2,
      chunkCount: 10,
    });

    const secondJob = await registry.beginIndexJob(context, collection.id);
    assert.equal(secondJob.status, "queued");
  });
});
