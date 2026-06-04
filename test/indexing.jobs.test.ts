import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import { startReindexJob, runIndexJob } from "../src/indexing/jobs.js";
import { addMetadataToChunks } from "../src/indexing/buildPhysicalCollection.js";
import { config } from "../src/config.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { Document } from "@langchain/core/documents";

describe("indexing jobs", () => {
  let registry: CollectionRegistry;

  before(() => {
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
  });

  after(() => {
    registry.close?.();
  });

  it("prevents a second queued or running job for the same collection", async () => {
    const context = { tenantId: "test-tenant", userId: "test-user", requestId: "req-1" };
    
    const collection = await registry.createCollection(context, {
      displayName: "Test Collection",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge",
      embeddingModel: "test-model",
      chatModel: "test-chat",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const job1 = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
    assert.equal(job1.status, "queued");

    try {
      await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
      assert.fail("Should have thrown an error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /queued or running index job/);
      assert.equal((error as any).code, "COLLECTION_INDEX_ALREADY_RUNNING");
    }
  });

  it("target physical name should be Chroma-safe and metadata contains version", async () => {
    // Tests for target physical collection name generation inside startReindexJob
    const context = { tenantId: "tenant", userId: "u", requestId: "r" };
    const collection = await registry.createCollection(context, {
      displayName: "Valid Name",
      sourcePath: "d", ozelgeDataPath: "d", embeddingModel: "m", chatModel: "m",
      distanceMetric: "l2", chunkSize: 1, chunkOverlap: 0, retrievalK: 1, retrievalDistanceThreshold: 1
    });

    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
    assert.match(job.targetPhysicalCollection, /^rag_tenant_valid-name-[a-z0-9]+_[0-9]{8}t[0-9]{6}_[0-9]{3}z$/);
  });

  it("allows queued jobs for different collections at the same time", async () => {
    const context = { tenantId: "tenant-parallel", userId: "u", requestId: "r" };
    const collectionA = await registry.createCollection(context, {
      displayName: "Parallel A",
      sourcePath: "d", ozelgeDataPath: "d", embeddingModel: "m", chatModel: "m",
      distanceMetric: "l2", chunkSize: 1, chunkOverlap: 0, retrievalK: 1, retrievalDistanceThreshold: 1,
    });
    const collectionB = await registry.createCollection(context, {
      displayName: "Parallel B",
      sourcePath: "d", ozelgeDataPath: "d", embeddingModel: "m", chatModel: "m",
      distanceMetric: "l2", chunkSize: 1, chunkOverlap: 0, retrievalK: 1, retrievalDistanceThreshold: 1,
    });

    const jobA = await startReindexJob({ registry, collectionId: collectionA.id, context, runtimeConfig: config });
    const jobB = await startReindexJob({ registry, collectionId: collectionB.id, context, runtimeConfig: config });

    assert.equal(jobA.status, "queued");
    assert.equal(jobB.status, "queued");
    assert.notEqual(jobA.collectionId, jobB.collectionId);
  });

  it("failed build does not change active pointer", async () => {
    const context = { tenantId: "tenant-2", userId: "u", requestId: "r" };
    const collection = await registry.createCollection(context, {
      displayName: "Failure Test",
      sourcePath: "d", ozelgeDataPath: "d", embeddingModel: "m", chatModel: "m",
      distanceMetric: "l2", chunkSize: 1, chunkOverlap: 0, retrievalK: 1, retrievalDistanceThreshold: 1
    });

    // Assume collection has an active pointer
    await registry.updateCollection(context, collection.id, {
      activePhysicalCollection: "rag_tenant-2_failure-test_oldversion",
      activeVersion: "oldversion",
      status: "ready",
    });

    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
    
    // Simulate job failure
    await registry.failIndexJob(job.id, "Simulated failure");

    const updated = await registry.getVisibleCollection(context, collection.id);
    assert.equal(updated?.status, "ready");
    assert.equal(updated?.activePhysicalCollection, "rag_tenant-2_failure-test_oldversion");
    assert.equal(updated?.activeVersion, "oldversion");
  });

  it("metadata içine collection/version eklenir", () => {
    const chunk = new Document({ pageContent: "test content", metadata: { sourcePath: "a.txt" } });
    const collection = { id: "col-123" } as any;
    
    const result = addMetadataToChunks([chunk], collection, "rag_t_col-123_v1", "v1");
    
    assert.equal(result.length, 1);
    assert.equal(result[0]?.metadata?.chunkIndex, 0);
    assert.equal(result[0]?.metadata?.collectionId, "col-123");
    assert.equal(result[0]?.metadata?.collectionVersion, "v1");
    assert.equal(result[0]?.metadata?.physicalCollection, "rag_t_col-123_v1");
    assert.equal(result[0]?.metadata?.sourcePath, "a.txt");
  });

  it("immutable HNSW/distanceMetric veya embedding model değişince yeni physical collection hedeflenir", async () => {
    const context = { tenantId: "tenant-3", userId: "u", requestId: "r" };
    const collection = await registry.createCollection(context, {
      displayName: "Immutable Test",
      sourcePath: "d", ozelgeDataPath: "d", embeddingModel: "m1", chatModel: "m",
      distanceMetric: "l2", chunkSize: 1, chunkOverlap: 0, retrievalK: 1, retrievalDistanceThreshold: 1
    });

    const realDate = Date;
    const fixedNow = new realDate("2026-06-04T09:39:48.212Z");

    class FixedDate extends realDate {
      constructor(value?: string | number | Date) {
        super(value ?? fixedNow.toISOString());
      }

      static now(): number {
        return fixedNow.getTime();
      }
    }

    globalThis.Date = FixedDate as unknown as DateConstructor;

    try {
      const job1 = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
      const target1 = job1.targetPhysicalCollection;
      
      // complete job 1 so we can start another
      await registry.completeIndexJob(job1.id, {
        activePhysicalCollection: target1,
        activeVersion: "v1",
        documentCount: 1,
        chunkCount: 1,
        retentionMs: 0,
      });

      // change immutable config
      await registry.updateCollection(context, collection.id, {
        embeddingModel: "m2",
        distanceMetric: "cosine"
      });

      const job2 = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
      const target2 = job2.targetPhysicalCollection;

      assert.notEqual(target1, target2, "New index job should target a new physical collection name due to versioning.");
      assert.ok(target2.startsWith("rag_tenant-3_immutable"), "Should follow Chroma-safe naming");
    } finally {
      globalThis.Date = realDate;
    }
  });

  it("runIndexJob uses the stored targetVersion instead of deriving it from the job id", async () => {
    const createdRecordVersions: string[] = [];
    const failedMessages: string[] = [];
    const job = {
      id: "manual_job_id",
      collectionId: "col-1",
      tenantId: "tenant-x",
      status: "queued",
      targetPhysicalCollection: "ab",
      targetVersion: "explicit-version",
      targetChromaConfiguration: { hnsw: { space: "l2" } },
      lockToken: "lock-1",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    } as const;

    let currentStatus: "queued" | "running" | "failed" = job.status;
    const fakeRegistry: CollectionRegistry = {
      listVisibleCollections: async () => [],
      getVisibleCollection: async () => ({
        id: "col-1",
        tenantId: "tenant-x",
        displayName: "Test",
        status: "indexing",
        sourcePath: "data",
        ozelgeDataPath: "data/ozelge_veri.json",
        embeddingModel: "embed",
        chatModel: "chat",
        distanceMetric: "l2",
        chromaCollectionConfiguration: { hnsw: { space: "l2" } },
        chunkSize: 10,
        chunkOverlap: 0,
        retrievalK: 1,
        retrievalDistanceThreshold: 1,
        createdBy: "system",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      }),
      getJob: async () => ({ ...job, status: currentStatus }),
      getActiveJobForCollection: async () => null,
      createCollection: async () => {
        throw new Error("not used");
      },
      updateCollection: async () => {
        throw new Error("not used");
      },
      beginIndexJob: async () => {
        throw new Error("not used");
      },
      markIndexJobRunning: async () => {
        currentStatus = "running";
        return { ...job, status: "running" };
      },
      completeIndexJob: async () => {
        throw new Error("completeIndexJob should not be reached in this test");
      },
      failIndexJob: async (_jobId, error) => {
        currentStatus = "failed";
        failedMessages.push(error);
        return { ...job, status: "failed", error };
      },
      failStaleJobs: async () => 0,
      createPhysicalCollectionRecord: async (input) => {
        createdRecordVersions.push(input.version);
        return {
          name: input.name,
          tenantId: input.tenantId,
          collectionId: input.collectionId,
          version: input.version,
          status: "building",
          chromaConfiguration: input.chromaConfiguration,
          createdAt: "2026-06-04T00:00:00.000Z",
        };
      },
      markPhysicalCollectionDeleted: async () => {},
      markPhysicalCollectionCleanupFailed: async () => {},
      listDuePhysicalCollectionsForCleanup: async () => [],
      collectionExists: async () => true,
    };

    await runIndexJob({ registry: fakeRegistry, jobId: job.id, runtimeConfig: config, log: () => {} });

    assert.deepEqual(createdRecordVersions, ["explicit-version"]);
    assert.equal(failedMessages.length, 1);
  });
});
