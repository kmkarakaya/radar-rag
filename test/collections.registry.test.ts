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
  embeddingModel: "bge-m3",
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

  it("migrates legacy registries missing active_embedding_model before completing reindex jobs", async () => {
    const legacyPath = path.join(tempDir, "legacy-registry.sqlite");
    const legacyDb = new Database(legacyPath);
    legacyDb.pragma("foreign_keys = ON");
    legacyDb.exec(`
      CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        active_physical_collection TEXT,
        active_version TEXT,
        source_path TEXT NOT NULL,
        ozelge_data_path TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        chat_model TEXT NOT NULL,
        distance_metric TEXT NOT NULL,
        chroma_collection_configuration_json TEXT NOT NULL,
        chunk_size INTEGER NOT NULL,
        chunk_overlap INTEGER NOT NULL,
        retrieval_k INTEGER NOT NULL,
        retrieval_distance_threshold REAL NOT NULL,
        document_count INTEGER,
        chunk_count INTEGER,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_indexed_at TEXT
      );

      CREATE TABLE index_jobs (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        target_physical_collection TEXT NOT NULL,
        target_version TEXT NOT NULL,
        target_embedding_model TEXT NOT NULL,
        target_chroma_configuration_json TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        document_count INTEGER,
        chunk_count INTEGER,
        lock_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES collections(id)
      );

      CREATE TABLE physical_collections (
        name TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        chroma_configuration_json TEXT NOT NULL,
        document_count INTEGER,
        chunk_count INTEGER,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        retired_at TEXT,
        delete_after TEXT,
        deleted_at TEXT,
        cleanup_error TEXT,
        FOREIGN KEY(collection_id) REFERENCES collections(id)
      );
    `);

    const now = new Date().toISOString();
    legacyDb.prepare(`
      INSERT INTO collections (
        id,
        tenant_id,
        display_name,
        status,
        source_path,
        ozelge_data_path,
        embedding_model,
        chat_model,
        distance_metric,
        chroma_collection_configuration_json,
        chunk_size,
        chunk_overlap,
        retrieval_k,
        retrieval_distance_threshold,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        'legacy-collection',
        @tenantId,
        'Legacy Collection',
        'creating',
        @sourcePath,
        @ozelgeDataPath,
        @embeddingModel,
        @chatModel,
        @distanceMetric,
        @chromaConfiguration,
        @chunkSize,
        @chunkOverlap,
        @retrievalK,
        @retrievalDistanceThreshold,
        @createdBy,
        @createdAt,
        @updatedAt
      )
    `).run({
      tenantId: context.tenantId,
      sourcePath: collectionInput.sourcePath,
      // Legacy registries had a NOT NULL ozelge_data_path column; the migration must drop it.
      ozelgeDataPath: "data/legacy-ozelge.json",
      embeddingModel: collectionInput.embeddingModel,
      // Legacy registries also stored a per-collection chat model; the chat LLM is now global.
      chatModel: "gemma3:4b",
      distanceMetric: collectionInput.distanceMetric,
      chromaConfiguration: JSON.stringify({ hnsw: { space: collectionInput.distanceMetric } }),
      chunkSize: collectionInput.chunkSize,
      chunkOverlap: collectionInput.chunkOverlap,
      retrievalK: collectionInput.retrievalK,
      retrievalDistanceThreshold: collectionInput.retrievalDistanceThreshold,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });
    legacyDb.close();

    const migratedRegistry = createSqliteCollectionRegistry({ dbPath: legacyPath });
    try {
      const migratedDb = new Database(legacyPath);
      try {
        const columns = migratedDb.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>;
        assert.ok(columns.some((column) => column.name === "active_embedding_model"));
        assert.ok(!columns.some((column) => column.name === "ozelge_data_path"));
        assert.ok(!columns.some((column) => column.name === "chat_model"));
      } finally {
        migratedDb.close();
      }

      const queued = await migratedRegistry.beginIndexJob(context, "legacy-collection", {
        targetVersion: "legacy-v2",
      });
      const running = await migratedRegistry.markIndexJobRunning(queued.id);
      await migratedRegistry.createPhysicalCollectionRecord({
        name: running.targetPhysicalCollection,
        tenantId: context.tenantId,
        collectionId: "legacy-collection",
        version: running.targetVersion,
        chromaConfiguration: running.targetChromaConfiguration,
      });

      await migratedRegistry.completeIndexJob(running.id, {
        documentCount: 1,
        chunkCount: 2,
        retentionMs: 0,
      });

      const ready = await migratedRegistry.getVisibleCollection(context, "legacy-collection");
      assert.equal(ready?.status, "ready");
      assert.equal(ready?.activeEmbeddingModel, collectionInput.embeddingModel);
    } finally {
      migratedRegistry.close?.();
    }
  });

  it("persists accepted patch fields and treats an empty patch as a no-op", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const lastIndexedAt = "2026-06-04T10:00:00.000Z";

    const updated = await registry.updateCollection(context, collection.id, {
      displayName: "Patched Belgeler",
      description: null,
      status: "ready",
      sourcePath: "data/patched-source",
      embeddingModel: "embed-v2",
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
    assert.equal(updated.embeddingModel, "embed-v2");
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

  it("lists physical collections for one collection in newest-first order and tenant scope", async () => {
    const firstCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "First Physical Visibility",
    });
    const secondCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "Second Physical Visibility",
    });

    const firstName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: firstCollection.id,
      version: "20260701t100000_000z",
    });
    const secondName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: firstCollection.id,
      version: "20260701t101000_000z",
    });
    const otherCollectionName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: secondCollection.id,
      version: "20260701t102000_000z",
    });

    await registry.createPhysicalCollectionRecord({
      name: firstName,
      tenantId: context.tenantId,
      collectionId: firstCollection.id,
      version: "20260701t100000_000z",
      chromaConfiguration: { hnsw: { space: "l2" } },
    });
    await registry.createPhysicalCollectionRecord({
      name: secondName,
      tenantId: context.tenantId,
      collectionId: firstCollection.id,
      version: "20260701t101000_000z",
      chromaConfiguration: { hnsw: { space: "cosine" } },
    });
    await registry.createPhysicalCollectionRecord({
      name: otherCollectionName,
      tenantId: context.tenantId,
      collectionId: secondCollection.id,
      version: "20260701t102000_000z",
      chromaConfiguration: { hnsw: { space: "ip" } },
    });

    rawDb.prepare(`
      UPDATE physical_collections
      SET
        status = @status,
        activated_at = @activatedAt,
        retired_at = @retiredAt,
        delete_after = @deleteAfter,
        cleanup_error = @cleanupError
      WHERE name = @name
    `).run({
      name: firstName,
      status: "delete_pending",
      activatedAt: "2026-07-01T10:00:01.000Z",
      retiredAt: "2026-07-01T10:10:00.000Z",
      deleteAfter: "2026-07-01T10:40:00.000Z",
      cleanupError: null,
    });
    rawDb.prepare(`
      UPDATE physical_collections
      SET
        status = @status,
        activated_at = @activatedAt,
        document_count = @documentCount,
        chunk_count = @chunkCount
      WHERE name = @name
    `).run({
      name: secondName,
      status: "active",
      activatedAt: "2026-07-01T10:15:00.000Z",
      documentCount: 12,
      chunkCount: 48,
    });
    rawDb.prepare(`
      UPDATE physical_collections
      SET
        status = @status,
        cleanup_error = @cleanupError
      WHERE name = @name
    `).run({
      name: otherCollectionName,
      status: "failed_build",
      cleanupError: "simulated build failure",
    });

    const result = await registry.listPhysicalCollectionsForCollection(context, firstCollection.id);

    assert.deepEqual(
      result.map((record) => ({
        name: record.name,
        status: record.status,
        version: record.version,
      })),
      [
        { name: secondName, status: "active", version: "20260701t101000_000z" },
        { name: firstName, status: "delete_pending", version: "20260701t100000_000z" },
      ],
    );
    assert.equal(result[0]?.chunkCount, 48);
    assert.equal(result[1]?.deleteAfter, "2026-07-01T10:40:00.000Z");

    const otherTenantResult = await registry.listPhysicalCollectionsForCollection(
      { ...context, tenantId: "other-tenant" },
      firstCollection.id,
    );
    assert.deepEqual(otherTenantResult, []);
  });

  it("builds a tenant-safe aggregate operations summary", async () => {
    const observedAt = "2026-06-30T12:00:00.000Z";
    const creatingCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "Creating Collection",
    });
    const archivedCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "Archived Collection",
    });
    rawDb.prepare(`
      UPDATE collections
      SET status = 'archived'
      WHERE id = ?
    `).run(archivedCollection.id);

    const queuedCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "Queued Collection",
    });
    const queuedJob = await registry.beginIndexJob(context, queuedCollection.id);

    const runningState = await createRunningJob({
      targetVersion: "20260630t115500_000z",
    });
    const succeededState = await createRunningJob({
      targetVersion: "20260630t114500_000z",
    });
    const failedState = await createRunningJob({
      targetVersion: "20260630t113000_000z",
    });
    const cancelledCollection = await registry.createCollection(context, {
      ...collectionInput,
      displayName: "Cancelled Collection",
    });
    const cancelledJob = await registry.beginIndexJob(context, cancelledCollection.id);

    await registry.completeIndexJob(succeededState.job.id, {
      documentCount: 12,
      chunkCount: 48,
      activePhysicalCollection: succeededState.job.targetPhysicalCollection,
      activeVersion: succeededState.job.targetVersion,
      retentionMs: 60_000,
    });
    await registry.failIndexJob(failedState.job.id, "simulated failure");
    await registry.cancelIndexJob(cancelledJob.id);

    rawDb.prepare(`
      UPDATE index_jobs
      SET updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: queuedJob.id,
      updatedAt: "2026-06-30T11:58:00.000Z",
    });
    rawDb.prepare(`
      UPDATE index_jobs
      SET updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: runningState.job.id,
      updatedAt: "2026-06-30T11:55:00.000Z",
    });
    rawDb.prepare(`
      UPDATE index_jobs
      SET finished_at = @finishedAt, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: failedState.job.id,
      finishedAt: "2026-06-30T11:59:30.000Z",
      updatedAt: "2026-06-30T11:59:30.000Z",
    });

    const deletePendingName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t110000_000z",
    });
    await registry.createPhysicalCollectionRecord({
      name: deletePendingName,
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t110000_000z",
      chromaConfiguration: { hnsw: { space: "l2" } },
    });
    rawDb.prepare(`
      UPDATE physical_collections
      SET status = 'delete_pending', delete_after = @deleteAfter
      WHERE name = @name
    `).run({
      name: deletePendingName,
      deleteAfter: "2026-06-30T11:00:00.000Z",
    });

    const cleanupFailedName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t111500_000z",
    });
    await registry.createPhysicalCollectionRecord({
      name: cleanupFailedName,
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t111500_000z",
      chromaConfiguration: { hnsw: { space: "l2" } },
    });
    rawDb.prepare(`
      UPDATE physical_collections
      SET status = 'cleanup_failed', delete_after = @deleteAfter, cleanup_error = @cleanupError
      WHERE name = @name
    `).run({
      name: cleanupFailedName,
      deleteAfter: "2026-06-30T11:30:00.000Z",
      cleanupError: "cleanup retry needed",
    });

    const deletedName = createPhysicalCollectionName({
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t100000_000z",
    });
    await registry.createPhysicalCollectionRecord({
      name: deletedName,
      tenantId: context.tenantId,
      collectionId: creatingCollection.id,
      version: "20260630t100000_000z",
      chromaConfiguration: { hnsw: { space: "l2" } },
    });
    rawDb.prepare(`
      UPDATE physical_collections
      SET status = 'delete_pending', delete_after = @deleteAfter
      WHERE name = @name
    `).run({
      name: deletedName,
      deleteAfter: "2026-06-30T10:00:00.000Z",
    });
    await registry.markPhysicalCollectionDeleted(deletedName);

    const summary = await registry.getSystemOperationsSummary(observedAt);

    assert.deepEqual(summary.collections, {
      total: 7,
      creating: 1,
      indexing: 2,
      ready: 1,
      failed: 2,
      archived: 1,
    });
    assert.deepEqual(summary.jobs, {
      total: 5,
      active: 2,
      queued: 1,
      running: 1,
      terminal: 3,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
      oldestActiveUpdatedAt: "2026-06-30T11:55:00.000Z",
      oldestActiveAgeSec: 300,
      newestFailureAt: "2026-06-30T11:59:30.000Z",
    });
    assert.deepEqual(summary.physicalCollections, {
      total: 6,
      building: 1,
      active: 1,
      failedBuild: 1,
      deletePending: 1,
      cleanupFailed: 1,
      deleted: 1,
      cleanupBacklog: 2,
      oldestDueDeleteAt: "2026-06-30T11:00:00.000Z",
    });

    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes(creatingCollection.id), false);
    assert.equal(serialized.includes(runningState.job.id), false);
    assert.equal(serialized.includes(deletePendingName), false);
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

  it("restores collection to 'failed' when the first queued job is cancelled", async () => {
    const collection = await registry.createCollection(context, collectionInput);
    const job = await registry.beginIndexJob(context, collection.id);
    
    assert.equal(collection.status, "creating");
    const indexing = await registry.getVisibleCollection(context, collection.id);
    assert.equal(indexing?.status, "indexing");

    await registry.cancelIndexJob(job.id);
    
    const cancelledJob = await registry.getJob(job.id);
    const restored = await registry.getVisibleCollection(context, collection.id);
    
    assert.equal(cancelledJob?.status, "cancelled");
    assert.equal(restored?.status, "failed");
  });

  it("restores collection to 'ready' when a reindex queued job is cancelled", async () => {
    const { collectionId, job: firstJob } = await createRunningJob();
    await registry.completeIndexJob(firstJob.id, {
      activePhysicalCollection: firstJob.targetPhysicalCollection,
      documentCount: 5,
      chunkCount: 10,
      retentionMs: 0,
    });

    const ready = await registry.getVisibleCollection(context, collectionId);
    assert.equal(ready?.status, "ready");

    const secondJob = await registry.beginIndexJob(context, collectionId);
    const indexing = await registry.getVisibleCollection(context, collectionId);
    assert.equal(indexing?.status, "indexing");

    await registry.cancelIndexJob(secondJob.id);
    
    const cancelledJob = await registry.getJob(secondJob.id);
    const restored = await registry.getVisibleCollection(context, collectionId);
    
    assert.equal(cancelledJob?.status, "cancelled");
    assert.equal(restored?.status, "ready");
    assert.equal(restored?.activePhysicalCollection, firstJob.targetPhysicalCollection);
  });

  it("soft-deletes a collection: marks 'archived' and hides it, while preserving registry invariants", async () => {
    const { collectionId, job: runningJob } = await createRunningJob();
    
    // 1. Delete collection
    const cancelledIds = await registry.deleteCollection(context, collectionId);
    
    // 2. Verify collection is marked as archived and hidden
    assert.deepEqual(cancelledIds, [runningJob.id]);
    const exists = await registry.collectionExists(collectionId);
    assert.equal(exists, false, "collectionExists should return false for archived");
    
    const visible = await registry.getVisibleCollection(context, collectionId);
    assert.equal(visible, null, "getVisibleCollection should return null for archived");
    
    const list = await registry.listVisibleCollections(context);
    assert.ok(!list.find(c => c.id === collectionId), "listVisibleCollections should not include archived");

    // Check raw DB to verify it's still there but 'archived'
    const row = rawDb.prepare("SELECT status FROM collections WHERE id = ?").get(collectionId) as { status: string };
    assert.equal(row.status, "archived");

    // 3. Verify jobs were cancelled
    const cancelledJob = await registry.getJob(runningJob.id);
    assert.equal(cancelledJob?.status, "cancelled");

    // 4. Verify physical collections are marked for deletion but keep collectionId
    const physical = await registry.getPhysicalCollection(runningJob.targetPhysicalCollection);
    assert.equal(physical?.status, "delete_pending");
    assert.equal(physical?.collectionId, collectionId, "physical record must preserve collectionId after archiving");

    // 5. Verify it cannot be reactivated by job completion
    // First, verify we can't begin a new job
    await assert.rejects(
      () => registry.beginIndexJob(context, collectionId),
      /Collection not found/i,
    );

    // Force job and physical collection back to valid states for completion for testing race condition
    rawDb.prepare("UPDATE index_jobs SET status = 'running' WHERE id = ?").run(runningJob.id);
    rawDb.prepare("UPDATE physical_collections SET status = 'building' WHERE name = ?").run(runningJob.targetPhysicalCollection);
    
    await registry.completeIndexJob(runningJob.id, {
      activePhysicalCollection: runningJob.targetPhysicalCollection,
      activeVersion: runningJob.targetVersion,
      documentCount: 100,
      chunkCount: 1000,
      retentionMs: 0,
    });

    const archivedAgain = rawDb.prepare("SELECT status FROM collections WHERE id = ?").get(collectionId) as { status: string };
    assert.equal(archivedAgain.status, "archived", "archived collection should not be reactivated by job completion");
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
    assert.equal(physical?.collectionId, collection.id);
  });
});
