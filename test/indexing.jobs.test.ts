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

  async function createCollection(context: { tenantId: string; userId: string; requestId: string }, displayName: string) {
    return registry.createCollection(context, {
      displayName,
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
  }

  before(() => {
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
  });

  after(() => {
    registry.close?.();
  });

  it("prevents a second queued or running job for the same collection", async () => {
    const context = { tenantId: "test-tenant", userId: "test-user", requestId: "req-1" };

    const collection = await createCollection(context, "Test Collection");

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
    const context = { tenantId: "tenant", userId: "u", requestId: "r" };
    const collection = await createCollection(context, "Valid Name");

    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
    assert.match(job.targetPhysicalCollection, /^rag_tenant_valid-name-[a-z0-9]+_[0-9]{8}t[0-9]{6}_[0-9]{3}z$/);
  });

  it("allows queued jobs for different collections at the same time", async () => {
    const context = { tenantId: "tenant-parallel", userId: "u", requestId: "r" };
    const collectionA = await createCollection(context, "Parallel A");
    const collectionB = await createCollection(context, "Parallel B");

    const jobA = await startReindexJob({ registry, collectionId: collectionA.id, context, runtimeConfig: config });
    const jobB = await startReindexJob({ registry, collectionId: collectionB.id, context, runtimeConfig: config });

    assert.equal(jobA.status, "queued");
    assert.equal(jobB.status, "queued");
    assert.notEqual(jobA.collectionId, jobB.collectionId);
  });

  it("failed build does not change active pointer", async () => {
    const context = { tenantId: "tenant-2", userId: "u", requestId: "r" };
    const collection = await createCollection(context, "Failure Test");

    await registry.updateCollection(context, collection.id, {
      activePhysicalCollection: "rag_tenant-2_failure-test_oldversion",
      activeVersion: "oldversion",
      status: "ready",
    });

    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
    
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
    const collection = await createCollection(context, "Immutable Test");
    await registry.updateCollection(context, collection.id, {
      embeddingModel: "m1",
      chatModel: "m",
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
      const queuedJob1 = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });
      const runningJob1 = await registry.markIndexJobRunning(queuedJob1.id);
      await registry.createPhysicalCollectionRecord({
        name: runningJob1.targetPhysicalCollection,
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: runningJob1.targetVersion,
        chromaConfiguration: runningJob1.targetChromaConfiguration,
      });

      const target1 = runningJob1.targetPhysicalCollection;

      await registry.completeIndexJob(runningJob1.id, {
        activePhysicalCollection: target1,
        activeVersion: runningJob1.targetVersion,
        documentCount: 1,
        chunkCount: 1,
        retentionMs: 0,
      });

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
      getPhysicalCollection: async () => null,
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

    await runIndexJob({
      registry: fakeRegistry,
      jobId: job.id,
      runtimeConfig: config,
      log: () => {},
      deps: {
        buildPhysicalCollection: async () => {
          throw new Error("Simulated build failure");
        },
      },
    });

    assert.deepEqual(createdRecordVersions, ["explicit-version"]);
    assert.equal(failedMessages.length, 1);
  });

  it("runIndexJob marks the created physical record active on success", async () => {
    const context = { tenantId: "tenant-success", userId: "u", requestId: "r" };
    const collection = await createCollection(context, "Successful Build");
    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });

    await runIndexJob({
      registry,
      jobId: job.id,
      runtimeConfig: config,
      log: () => {},
      deps: {
        buildPhysicalCollection: async () => ({
          sourceDocumentCount: 2,
          parsedSourceDocumentCount: 2,
          chunkCount: 5,
        }),
      },
    });

    const finishedJob = await registry.getJob(job.id);
    const updatedCollection = await registry.getVisibleCollection(context, collection.id);
    const physical = await registry.getPhysicalCollection(job.targetPhysicalCollection);

    assert.equal(finishedJob?.status, "succeeded");
    assert.equal(updatedCollection?.status, "ready");
    assert.equal(updatedCollection?.activePhysicalCollection, job.targetPhysicalCollection);
    assert.equal(updatedCollection?.activeVersion, job.targetVersion);
    assert.equal(updatedCollection?.documentCount, 2);
    assert.equal(updatedCollection?.chunkCount, 5);
    assert.equal(physical?.status, "active");
    assert.equal(physical?.version, job.targetVersion);
  });

  it("runIndexJob keeps the previous active pointer and marks the target record failed_build on build failure", async () => {
    const context = { tenantId: "tenant-build-fail", userId: "u", requestId: "r" };
    const collection = await createCollection(context, "Build Fail");
    await registry.updateCollection(context, collection.id, {
      status: "ready",
      activePhysicalCollection: "rag_tenant-build-fail_build-fail-old_v1",
      activeVersion: "v1",
    });

    const job = await startReindexJob({ registry, collectionId: collection.id, context, runtimeConfig: config });

    await runIndexJob({
      registry,
      jobId: job.id,
      runtimeConfig: config,
      log: () => {},
      deps: {
        buildPhysicalCollection: async () => {
          throw new Error("Injected build failure");
        },
      },
    });

    const failedJob = await registry.getJob(job.id);
    const updatedCollection = await registry.getVisibleCollection(context, collection.id);
    const physical = await registry.getPhysicalCollection(job.targetPhysicalCollection);

    assert.equal(failedJob?.status, "failed");
    assert.equal(failedJob?.error, "Injected build failure");
    assert.equal(updatedCollection?.status, "ready");
    assert.equal(updatedCollection?.activePhysicalCollection, "rag_tenant-build-fail_build-fail-old_v1");
    assert.equal(updatedCollection?.activeVersion, "v1");
    assert.equal(physical?.status, "failed_build");
    assert.equal(physical?.cleanupError, "Injected build failure");
  });
});
