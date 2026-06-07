import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import { createPhysicalCollectionName } from "../src/collections/ids.js";
import type {
  CollectionRegistry,
  CreateCollectionInput,
  IndexJob,
  PhysicalCollectionStatus,
  RequestContext,
} from "../src/collections/types.js";

let tempDir: string;
let dbPath: string;
let registry: CollectionRegistry;
let rawDb: Database.Database;

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
  dbPath = path.join(tempDir, "registry.sqlite");
  registry = createSqliteCollectionRegistry({
    dbPath,
  });
  rawDb = new Database(dbPath);
  rawDb.pragma("foreign_keys = ON");
});

afterEach(async () => {
  rawDb.close();
  registry.close?.();
  
  // Windows sometimes keeps a lock for a split second
  await new Promise(resolve => setTimeout(resolve, 50));
  
  await rm(tempDir, { recursive: true, force: true });
});

describe("sqlite collection registry", () => {
  async function createRunningJob(options?: {
    targetVersion?: string;
    createPhysicalRecord?: boolean;
  }): Promise<{
    collectionId: string;
    job: IndexJob;
  }> {
    const collection = await registry.createCollection(context, collectionInput);
    const queuedJob = await registry.beginIndexJob(context, collection.id, {
      targetVersion: options?.targetVersion,
    });
    const runningJob = await registry.markIndexJobRunning(queuedJob.id);

    if (options?.createPhysicalRecord !== false) {
      await registry.createPhysicalCollectionRecord({
        name: runningJob.targetPhysicalCollection,
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: runningJob.targetVersion,
        chromaConfiguration: runningJob.targetChromaConfiguration,
      });
    }

    return {
      collectionId: collection.id,
      job: runningJob,
    };
  }

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

  it("persists accepted patch fields and treats an empty patch as a no-op", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const lastIndexedAt = "2026-06-04T10:00:00.000Z";

    const updated = await registry.updateCollection(context, collection.id, {
      displayName: "Patched Belgeler",
      description: null,
      status: "ready",
      sourcePath: "data/patched-source",
      ozelgeDataPath: "data/patched-ozelge.json",
      embeddingModel: "embed-v2",
      chatModel: "chat-v2",
      distanceMetric: "cosine",
      chromaCollectionConfiguration: {
        hnsw: {
          space: "l2",
          ef_construction: 256,
        },
        custom: {
          label: "patched",
        },
      },
      chunkSize: 256,
      chunkOverlap: 32,
      retrievalK: 9,
      retrievalDistanceThreshold: 0.25,
      activePhysicalCollection: "rag_default_patched-belgeler-123_v_custom",
      activeVersion: "v_custom_with_underscores",
      documentCount: 12,
      chunkCount: 34,
      lastIndexedAt,
    });

    assert.equal(updated.displayName, "Patched Belgeler");
    assert.equal(updated.description, undefined);
    assert.equal(updated.status, "ready");
    assert.equal(updated.sourcePath, "data/patched-source");
    assert.equal(updated.ozelgeDataPath, "data/patched-ozelge.json");
    assert.equal(updated.embeddingModel, "embed-v2");
    assert.equal(updated.chatModel, "chat-v2");
    assert.equal(updated.distanceMetric, "cosine");
    assert.deepEqual(updated.chromaCollectionConfiguration, {
      hnsw: {
        space: "cosine",
        ef_construction: 256,
      },
      custom: {
        label: "patched",
      },
    });
    assert.equal(updated.chunkSize, 256);
    assert.equal(updated.chunkOverlap, 32);
    assert.equal(updated.retrievalK, 9);
    assert.equal(updated.retrievalDistanceThreshold, 0.25);
    assert.equal(updated.activePhysicalCollection, "rag_default_patched-belgeler-123_v_custom");
    assert.equal(updated.activeVersion, "v_custom_with_underscores");
    assert.equal(updated.documentCount, 12);
    assert.equal(updated.chunkCount, 34);
    assert.equal(updated.lastIndexedAt, lastIndexedAt);

    const noOp = await registry.updateCollection(context, collection.id, {});
    assert.equal(noOp.updatedAt, updated.updatedAt);
    assert.deepEqual(noOp, updated);
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

    const runningJob = await registry.markIndexJobRunning(firstJob.id);
    await registry.createPhysicalCollectionRecord({
      name: runningJob.targetPhysicalCollection,
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: runningJob.targetVersion,
      chromaConfiguration: runningJob.targetChromaConfiguration,
    });

    await registry.completeIndexJob(firstJob.id, {
      activePhysicalCollection: runningJob.targetPhysicalCollection,
      activeVersion: runningJob.targetVersion,
      documentCount: 2,
      chunkCount: 10,
      retentionMs: 0,
    });

    const secondJob = await registry.beginIndexJob(context, collection.id);
    assert.equal(secondJob.status, "queued");
  });

  it("keeps stored and queued Chroma configuration aligned with distanceMetric updates", async () => {
    const collection = await registry.createCollection(context, {
      ...collectionInput,
      chromaCollectionConfiguration: {
        hnsw: {
          space: "ip",
          ef_construction: 128,
        },
        custom: {
          label: "kept",
        },
      },
    });

    assert.deepEqual(collection.chromaCollectionConfiguration, {
      hnsw: {
        space: "l2",
        ef_construction: 128,
      },
      custom: {
        label: "kept",
      },
    });

    const updated = await registry.updateCollection(context, collection.id, {
      distanceMetric: "cosine",
    });

    assert.equal(updated.distanceMetric, "cosine");
    assert.deepEqual(updated.chromaCollectionConfiguration, {
      hnsw: {
        space: "cosine",
        ef_construction: 128,
      },
      custom: {
        label: "kept",
      },
    });

    const job = await registry.beginIndexJob(context, collection.id);
    assert.deepEqual(job.targetChromaConfiguration, {
      hnsw: {
        space: "cosine",
        ef_construction: 128,
      },
      custom: {
        label: "kept",
      },
    });
  });

  it("rejects completing a queued job", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const job = await registry.beginIndexJob(context, collection.id);

    await assert.rejects(
      () => registry.completeIndexJob(job.id, {
        documentCount: 1,
        chunkCount: 1,
        retentionMs: 0,
      }),
      /status 'queued'.*cannot be completed/i,
    );

    const unchangedJob = await registry.getJob(job.id);
    const unchangedCollection = await registry.getVisibleCollection(context, collection.id);
    assert.equal(unchangedJob?.status, "queued");
    assert.equal(unchangedCollection?.status, "indexing");
  });

  it("rejects re-completing or failing a succeeded job", async () => {
    const { collectionId, job } = await createRunningJob();

    await registry.completeIndexJob(job.id, {
      activePhysicalCollection: job.targetPhysicalCollection,
      documentCount: 3,
      chunkCount: 4,
      retentionMs: 0,
    });

    await assert.rejects(
      () => registry.completeIndexJob(job.id, {
        activePhysicalCollection: job.targetPhysicalCollection,
        documentCount: 5,
        chunkCount: 6,
        retentionMs: 0,
      }),
      /status 'succeeded'.*cannot be completed/i,
    );

    await assert.rejects(
      () => registry.failIndexJob(job.id, "should not overwrite success"),
      /status 'succeeded'.*cannot be failed/i,
    );

    const unchangedJob = await registry.getJob(job.id);
    const collection = await registry.getVisibleCollection(context, collectionId);
    assert.equal(unchangedJob?.status, "succeeded");
    assert.equal(collection?.status, "ready");
    assert.equal(collection?.activeVersion, job.targetVersion);
  });

  it("rejects re-completing or re-failing a failed job", async () => {
    const { collectionId, job } = await createRunningJob();

    await registry.failIndexJob(job.id, "build failed");

    await assert.rejects(
      () => registry.completeIndexJob(job.id, {
        activePhysicalCollection: job.targetPhysicalCollection,
        documentCount: 1,
        chunkCount: 1,
        retentionMs: 0,
      }),
      /status 'failed'.*cannot be completed/i,
    );

    await assert.rejects(
      () => registry.failIndexJob(job.id, "build failed twice"),
      /status 'failed'.*cannot be failed/i,
    );

    const unchangedJob = await registry.getJob(job.id);
    const collection = await registry.getVisibleCollection(context, collectionId);
    assert.equal(unchangedJob?.status, "failed");
    assert.equal(collection?.status, "failed");
  });

  it("does not make a collection ready when the target physical record is missing", async () => {
    const { collectionId, job } = await createRunningJob({ createPhysicalRecord: false });

    await assert.rejects(
      () => registry.completeIndexJob(job.id, {
        activePhysicalCollection: job.targetPhysicalCollection,
        documentCount: 1,
        chunkCount: 1,
        retentionMs: 0,
      }),
      /Physical collection record not found/i,
    );

    const unchangedJob = await registry.getJob(job.id);
    const collection = await registry.getVisibleCollection(context, collectionId);
    assert.equal(unchangedJob?.status, "running");
    assert.equal(collection?.status, "indexing");
    assert.equal(collection?.activePhysicalCollection, undefined);
    assert.equal(collection?.activeVersion, undefined);
  });

  it("uses the exact targetVersion as activeVersion on completion", async () => {
    const targetVersion = "custom_version_with_underscores";
    const { collectionId, job } = await createRunningJob({ targetVersion });

    await registry.completeIndexJob(job.id, {
      activePhysicalCollection: job.targetPhysicalCollection,
      documentCount: 2,
      chunkCount: 3,
      retentionMs: 0,
    });

    const collection = await registry.getVisibleCollection(context, collectionId);
    assert.equal(collection?.activeVersion, targetVersion);
    assert.equal(collection?.activePhysicalCollection, job.targetPhysicalCollection);
  });

  it("rejects pointer swap when the previous active physical record cannot be moved to delete_pending", async () => {
    const first = await createRunningJob({ targetVersion: "first_version_with_underscores" });

    await registry.completeIndexJob(first.job.id, {
      activePhysicalCollection: first.job.targetPhysicalCollection,
      documentCount: 2,
      chunkCount: 3,
      retentionMs: 0,
    });

    rawDb.prepare(`
      UPDATE physical_collections
      SET status = 'deleted'
      WHERE name = ?
    `).run(first.job.targetPhysicalCollection);

    const secondQueued = await registry.beginIndexJob(context, first.collectionId, {
      targetVersion: "second_version_with_underscores",
    });
    const second = await registry.markIndexJobRunning(secondQueued.id);
    await registry.createPhysicalCollectionRecord({
      name: second.targetPhysicalCollection,
      tenantId: context.tenantId,
      collectionId: first.collectionId,
      version: second.targetVersion,
      chromaConfiguration: second.targetChromaConfiguration,
    });

    await assert.rejects(
      () => registry.completeIndexJob(second.id, {
        activePhysicalCollection: second.targetPhysicalCollection,
        documentCount: 4,
        chunkCount: 5,
        retentionMs: 0,
      }),
      /previous active physical collection .* could not be retired for cleanup/i,
    );

    const collection = await registry.getVisibleCollection(context, first.collectionId);
    const secondPhysical = await registry.getPhysicalCollection(second.targetPhysicalCollection);

    assert.equal(collection?.activePhysicalCollection, first.job.targetPhysicalCollection);
    assert.equal(collection?.activeVersion, first.job.targetVersion);
    assert.equal(secondPhysical?.status, "building");
  });

  it("snapshots and preserves activeEmbeddingModel during reindexing", async () => {
    // 1. Create collection with embed-v1
    const collection = await registry.createCollection(context, {
      ...collectionInput,
      embeddingModel: "embed-v1",
    });
    assert.equal(collection.activeEmbeddingModel, undefined);

    // 2. Reindex completes with embed-v1
    const job1Queued = await registry.beginIndexJob(context, collection.id);
    const job1 = await registry.markIndexJobRunning(job1Queued.id);
    await registry.createPhysicalCollectionRecord({
      name: job1.targetPhysicalCollection,
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: job1.targetVersion,
      chromaConfiguration: job1.targetChromaConfiguration,
    });
    await registry.completeIndexJob(job1.id, {
      activePhysicalCollection: job1.targetPhysicalCollection,
      activeVersion: job1.targetVersion,
      documentCount: 1,
      chunkCount: 1,
      retentionMs: 0,
    });

    const readyV1 = await registry.getVisibleCollection(context, collection.id);
    assert.equal(readyV1?.embeddingModel, "embed-v1");
    assert.equal(readyV1?.activeEmbeddingModel, "embed-v1");

    // 3. Patch to embed-v2 (desired changes, active read snapshot stays v1)
    await registry.updateCollection(context, collection.id, {
      embeddingModel: "embed-v2",
    });

    const patched = await registry.getVisibleCollection(context, collection.id);
    assert.equal(patched?.embeddingModel, "embed-v2");
    assert.equal(patched?.activeEmbeddingModel, "embed-v1"); // Snapshot should be preserved

    // 4. Start reindex - it should snapshot embed-v2 from the record
    const job2Queued = await registry.beginIndexJob(context, collection.id);
    assert.equal(job2Queued.targetEmbeddingModel, "embed-v2");

    // 5. If reindex fails, snapshot stays v1
    await registry.markIndexJobRunning(job2Queued.id);
    await registry.failIndexJob(job2Queued.id, "failed build v2");

    const failed = await registry.getVisibleCollection(context, collection.id);
    assert.equal(failed?.embeddingModel, "embed-v2");
    assert.equal(failed?.activeEmbeddingModel, "embed-v1");

    // 6. Successful reindex with v2 updates snapshot
    const job3Queued = await registry.beginIndexJob(context, collection.id);
    const job3 = await registry.markIndexJobRunning(job3Queued.id);
    await registry.createPhysicalCollectionRecord({
      name: job3.targetPhysicalCollection,
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: job3.targetVersion,
      chromaConfiguration: job3.targetChromaConfiguration,
    });
    await registry.completeIndexJob(job3.id, {
      activePhysicalCollection: job3.targetPhysicalCollection,
      activeVersion: job3.targetVersion,
      documentCount: 2,
      chunkCount: 2,
      retentionMs: 0,
    });

    const readyV2 = await registry.getVisibleCollection(context, collection.id);
    assert.equal(readyV2?.embeddingModel, "embed-v2");
    assert.equal(readyV2?.activeEmbeddingModel, "embed-v2");
  });

  it("marks a building physical record as failed_build when a job fails", async () => {
    const { job } = await createRunningJob();

    await registry.failIndexJob(job.id, "simulated build failure");

    const failedJob = await registry.getJob(job.id);
    const physical = await registry.getPhysicalCollection(job.targetPhysicalCollection);
    const due = await registry.listDuePhysicalCollectionsForCleanup(new Date().toISOString(), 10);

    assert.equal(failedJob?.status, "failed");
    assert.equal(physical?.status, "failed_build");
    assert.equal(physical?.cleanupError, "simulated build failure");
    assert.equal(due.length, 0);
  });

  it("marks stale building records as failed_build", async () => {
    const { collectionId, job } = await createRunningJob();

    const failedCount = await registry.failStaleJobs(-1);

    const staleJob = await registry.getJob(job.id);
    const collection = await registry.getVisibleCollection(context, collectionId);
    const physical = await registry.getPhysicalCollection(job.targetPhysicalCollection);
    const due = await registry.listDuePhysicalCollectionsForCleanup(new Date().toISOString(), 10);

    assert.equal(failedCount, 1);
    assert.equal(staleJob?.status, "failed");
    assert.equal(staleJob?.error, "Job timed out (stale lock)");
    assert.equal(collection?.status, "failed");
    assert.equal(physical?.status, "failed_build");
    assert.equal(physical?.cleanupError, "Job timed out (stale lock)");
    assert.equal(due.length, 0);
  });

  it("lists only due delete_pending and cleanup_failed physical collections", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const dueNow = "2026-06-04T12:00:00.000Z";

    async function seedPhysical(options: {
      version: string;
      status: PhysicalCollectionStatus;
      deleteAfter?: string | null;
      cleanupError?: string | null;
    }) {
      const name = createPhysicalCollectionName({
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: options.version,
      });

      await registry.createPhysicalCollectionRecord({
        name,
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: options.version,
        chromaConfiguration: { hnsw: { space: "l2" } },
      });

      rawDb.prepare(`
        UPDATE physical_collections
        SET status = @status, delete_after = @deleteAfter, cleanup_error = @cleanupError
        WHERE name = @name
      `).run({
        name,
        status: options.status,
        deleteAfter: options.deleteAfter ?? null,
        cleanupError: options.cleanupError ?? null,
      });

      return name;
    }

    const dueDeletePending = await seedPhysical({
      version: "20260604t110000_000z",
      status: "delete_pending",
      deleteAfter: "2026-06-04T11:30:00.000Z",
    });
    const dueCleanupFailed = await seedPhysical({
      version: "20260604t110500_000z",
      status: "cleanup_failed",
      deleteAfter: "2026-06-04T11:45:00.000Z",
      cleanupError: "first delete failed",
    });

    await seedPhysical({
      version: "20260604t120100_000z",
      status: "delete_pending",
      deleteAfter: "2026-06-04T12:30:00.000Z",
    });
    await seedPhysical({
      version: "20260604t120200_000z",
      status: "failed_build",
      deleteAfter: "2026-06-04T11:00:00.000Z",
      cleanupError: "build failed",
    });
    await seedPhysical({
      version: "20260604t120300_000z",
      status: "building",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });
    await seedPhysical({
      version: "20260604t120400_000z",
      status: "active",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });
    await seedPhysical({
      version: "20260604t120500_000z",
      status: "retired",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });
    await seedPhysical({
      version: "20260604t120600_000z",
      status: "deleted",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });

    const due = await registry.listDuePhysicalCollectionsForCleanup(dueNow, 20);

    assert.deepEqual(
      due.map((record) => ({ name: record.name, status: record.status })),
      [
        { name: dueDeletePending, status: "delete_pending" },
        { name: dueCleanupFailed, status: "cleanup_failed" },
      ],
    );
  });

  it("does not silently mark non-cleanup physical records as deleted or cleanup_failed", async () => {
    const collection = await registry.createCollection(context, collectionInput);

    async function seedPhysical(options: {
      version: string;
      status: PhysicalCollectionStatus;
      cleanupError?: string | null;
    }) {
      const name = createPhysicalCollectionName({
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: options.version,
      });

      await registry.createPhysicalCollectionRecord({
        name,
        tenantId: context.tenantId,
        collectionId: collection.id,
        version: options.version,
        chromaConfiguration: { hnsw: { space: "l2" } },
      });

      rawDb.prepare(`
        UPDATE physical_collections
        SET status = @status, cleanup_error = @cleanupError
        WHERE name = @name
      `).run({
        name,
        status: options.status,
        cleanupError: options.cleanupError ?? null,
      });

      return name;
    }

    const activeName = await seedPhysical({
      version: "20260604t121000_000z",
      status: "active",
    });
    const failedBuildName = await seedPhysical({
      version: "20260604t121500_000z",
      status: "failed_build",
      cleanupError: "build failed",
    });

    await assert.rejects(
      () => registry.markPhysicalCollectionDeleted(activeName),
      /not pending cleanup/i,
    );
    await assert.rejects(
      () => registry.markPhysicalCollectionCleanupFailed(failedBuildName, "delete failed"),
      /not pending cleanup retry/i,
    );

    const active = await registry.getPhysicalCollection(activeName);
    const failedBuild = await registry.getPhysicalCollection(failedBuildName);

    assert.equal(active?.status, "active");
    assert.equal(active?.deletedAt, undefined);
    assert.equal(active?.cleanupError, undefined);
    assert.equal(failedBuild?.status, "failed_build");
    assert.equal(failedBuild?.cleanupError, "build failed");
  });

  it("deletes a collection and sets physical collections to delete_pending", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const physicalName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: "v1",
    });

    await registry.createPhysicalCollectionRecord({
      name: physicalName,
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: "v1",
      chromaConfiguration: { hnsw: { space: "l2" } },
    });

    await registry.deleteCollection(context, collection.id);

    const exists = await registry.collectionExists(collection.id);
    assert.equal(exists, false);

    const physical = await registry.getPhysicalCollection(physicalName);
    assert.equal(physical?.status, "delete_pending");
    assert.ok(physical?.deleteAfter);
  });
});
