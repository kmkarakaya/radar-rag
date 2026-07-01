import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { DistanceMetric } from "../config.js";
import { createPhysicalCollectionName, generateCollectionId } from "./ids.js";
import { buildCollectionIndexSnapshot, buildCollectionIndexState, parseCollectionIndexSnapshot } from "./indexState.js";
import type {
  BeginIndexJobInput,
  CollectionRegistry,
  CollectionStatus,
  CompleteIndexJobResult,
  CreateIndexJobEventInput,
  CreateCollectionInput,
  IndexJob,
  IndexJobEvent,
  IndexJobEventCode,
  IndexJobEventLevel,
  IndexJobEventProgress,
  IndexJobEventStage,
  IndexJobListItem,
  IndexJobStatus,
  ListJobsInput,
  ListJobsResult,
  PhysicalCollectionRecord,
  PhysicalCollectionStatus,
  RagCollection,
  RequestContext,
  SystemOperationsAggregateSummary,
  UpdateCollectionPatch,
} from "./types.js";

type SqliteRegistryOptions = {
  dbPath: string;
};

type CollectionRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  description: string | null;
  status: CollectionStatus;
  active_physical_collection: string | null;
  active_version: string | null;
  source_path: string;
  ozelge_data_path: string;
  embedding_model: string;
  chat_model: string;
  distance_metric: "l2" | "cosine" | "ip";
  chroma_collection_configuration_json: string;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_k: number;
  retrieval_distance_threshold: number;
  active_embedding_model: string | null;
  document_count: number | null;
  chunk_count: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_indexed_at: string | null;
  indexed_snapshot_json: string | null;
};

type IndexJobRow = {
  id: string;
  collection_id: string;
  tenant_id: string;
  status: IndexJobStatus;
  target_physical_collection: string;
  target_version: string;
  target_embedding_model: string;
  target_chroma_configuration_json: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  document_count: number | null;
  chunk_count: number | null;
  lock_token: string;
  created_at: string;
  updated_at: string;
};

type IndexJobSummaryRow = IndexJobRow & {
  collection_snapshot_id: string | null;
  collection_snapshot_display_name: string | null;
  collection_snapshot_status: CollectionStatus | null;
};

type IndexJobEventRow = {
  id: string;
  job_id: string;
  tenant_id: string;
  collection_id: string;
  sequence: number;
  status: IndexJobStatus;
  stage: IndexJobEventStage;
  code: IndexJobEventCode;
  level: IndexJobEventLevel;
  message: string;
  details_json: string | null;
  progress_json: string | null;
  created_at: string;
};

type PhysicalCollectionRow = {
  name: string;
  tenant_id: string;
  collection_id: string;
  version: string;
  status: PhysicalCollectionStatus;
  chroma_configuration_json: string;
  document_count: number | null;
  chunk_count: number | null;
  created_at: string;
  activated_at: string | null;
  retired_at: string | null;
  delete_after: string | null;
  deleted_at: string | null;
  cleanup_error: string | null;
};

type SqliteDatabase = Database.Database;

export function createSqliteCollectionRegistry(options: SqliteRegistryOptions): CollectionRegistry {
  const db = openDatabase(options.dbPath);
  initializeSchema(db);

  return new SqliteCollectionRegistry(db);
}

function openDatabase(dbPath: string): SqliteDatabase {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
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
      active_embedding_model TEXT,
      document_count INTEGER,
      chunk_count INTEGER,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_indexed_at TEXT,
      indexed_snapshot_json TEXT
    );

    CREATE TABLE IF NOT EXISTS index_jobs (
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

    CREATE TABLE IF NOT EXISTS physical_collections (
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

    CREATE TABLE IF NOT EXISTS index_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      code TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      progress_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES index_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_collections_tenant ON collections(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_index_jobs_collection ON index_jobs(collection_id, tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_index_job_events_job_sequence
      ON index_job_events(job_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_index_job_events_job_created
      ON index_job_events(job_id, created_at, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_index_jobs_one_active_per_collection
      ON index_jobs(collection_id, tenant_id)
      WHERE status IN ('queued', 'running');
    DROP INDEX IF EXISTS idx_physical_collections_cleanup;
    CREATE INDEX IF NOT EXISTS idx_physical_collections_cleanup ON physical_collections(delete_after, status)
      WHERE status IN ('delete_pending', 'cleanup_failed');
  `);

  migrateSchema(db);
}

function migrateSchema(db: SqliteDatabase): void {
  ensureColumn(db, "collections", "active_embedding_model", "TEXT");
  ensureColumn(db, "collections", "indexed_snapshot_json", "TEXT");

  const backfillNow = new Date().toISOString();
  const snapshotRows = db.prepare(`
    SELECT id, source_path, ozelge_data_path, distance_metric, chunk_size, chunk_overlap, embedding_model
    FROM collections
    WHERE active_physical_collection IS NOT NULL
      AND (indexed_snapshot_json IS NULL OR indexed_snapshot_json = '')
  `).all() as Array<{
    id: string;
    source_path: string;
    ozelge_data_path: string;
    distance_metric: "l2" | "cosine" | "ip";
    chunk_size: number;
    chunk_overlap: number;
    embedding_model: string;
  }>;

  const updateSnapshot = db.prepare(`
    UPDATE collections
    SET indexed_snapshot_json = @indexedSnapshotJson, updated_at = @updatedAt
    WHERE id = @id
  `);

  for (const row of snapshotRows) {
    updateSnapshot.run({
      id: row.id,
      indexedSnapshotJson: JSON.stringify({
        sourcePath: row.source_path,
        ozelgeDataPath: row.ozelge_data_path,
        distanceMetric: row.distance_metric,
        chunkSize: row.chunk_size,
        chunkOverlap: row.chunk_overlap,
        embeddingModel: row.embedding_model,
      }),
      updatedAt: backfillNow,
    });
  }
}

function ensureColumn(db: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

class SqliteCollectionRegistry implements CollectionRegistry {
  constructor(private readonly db: SqliteDatabase) {}

  async listVisibleCollections(context: RequestContext): Promise<RagCollection[]> {
    const rows = this.db
      .prepare("SELECT * FROM collections WHERE tenant_id = ? AND status != 'archived' ORDER BY updated_at DESC")
      .all(context.tenantId) as CollectionRow[];

    return rows.map(mapCollectionRow);
  }

  async getVisibleCollection(context: RequestContext, collectionId: string): Promise<RagCollection | null> {
    const row = this.db
      .prepare("SELECT * FROM collections WHERE tenant_id = ? AND id = ? AND status != 'archived'")
      .get(context.tenantId, collectionId) as CollectionRow | undefined;

    return row ? mapCollectionRow(row) : null;
  }

  async listJobs(context: RequestContext, filters: ListJobsInput = {}): Promise<ListJobsResult> {
    const limit = clampInteger(filters.limit ?? 25, 1, 100);
    const where: string[] = ["j.tenant_id = @tenantId"];
    const params: Record<string, unknown> = {
      tenantId: context.tenantId,
      limit: limit + 1,
    };

    if (filters.collectionId) {
      where.push("j.collection_id = @collectionId");
      params.collectionId = filters.collectionId;
    }

    if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
      const statusPlaceholders = filters.statuses.map((_, index) => `@status${index}`);
      where.push(`j.status IN (${statusPlaceholders.join(", ")})`);
      filters.statuses.forEach((status, index) => {
        params[`status${index}`] = status;
      });
    }

    if (filters.cursor) {
      const cursor = decodeJobCursor(filters.cursor);
      where.push("(j.updated_at < @cursorUpdatedAt OR (j.updated_at = @cursorUpdatedAt AND j.id < @cursorId))");
      params.cursorUpdatedAt = cursor.updatedAt;
      params.cursorId = cursor.id;
    }

    const rows = this.db
      .prepare(`
        SELECT
          j.*,
          c.id AS collection_snapshot_id,
          c.display_name AS collection_snapshot_display_name,
          c.status AS collection_snapshot_status
        FROM index_jobs j
        LEFT JOIN collections c
          ON c.id = j.collection_id
         AND c.tenant_id = j.tenant_id
        WHERE ${where.join(" AND ")}
        ORDER BY j.updated_at DESC, j.id DESC
        LIMIT @limit
      `)
      .all(params) as IndexJobSummaryRow[];

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      jobs: pageRows.map(mapIndexJobSummaryRow),
      nextCursor: hasNextPage ? encodeJobCursor(pageRows[pageRows.length - 1]!) : null,
    };
  }

  async getSystemOperationsSummary(nowIso: string): Promise<SystemOperationsAggregateSummary> {
    const collectionCounts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'creating' THEN 1 ELSE 0 END) AS creating,
        SUM(CASE WHEN status = 'indexing' THEN 1 ELSE 0 END) AS indexing,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM collections
    `).get() as Record<string, unknown>;

    const jobCounts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 1 ELSE 0 END) AS terminal,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        MIN(CASE WHEN status IN ('queued', 'running') THEN updated_at END) AS oldest_active_updated_at,
        MAX(CASE WHEN status = 'failed' THEN COALESCE(finished_at, updated_at) END) AS newest_failure_at
      FROM index_jobs
    `).get() as Record<string, unknown>;

    const physicalCollectionCounts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'building' THEN 1 ELSE 0 END) AS building,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'failed_build' THEN 1 ELSE 0 END) AS failed_build,
        SUM(CASE WHEN status = 'delete_pending' THEN 1 ELSE 0 END) AS delete_pending,
        SUM(CASE WHEN status = 'cleanup_failed' THEN 1 ELSE 0 END) AS cleanup_failed,
        SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted,
        SUM(
          CASE
            WHEN status IN ('delete_pending', 'cleanup_failed')
             AND delete_after IS NOT NULL
             AND delete_after <= @nowIso
            THEN 1
            ELSE 0
          END
        ) AS cleanup_backlog,
        MIN(
          CASE
            WHEN status IN ('delete_pending', 'cleanup_failed')
             AND delete_after IS NOT NULL
             AND delete_after <= @nowIso
            THEN delete_after
          END
        ) AS oldest_due_delete_at
      FROM physical_collections
    `).get({ nowIso }) as Record<string, unknown>;

    const oldestActiveUpdatedAt = stringOrNull(jobCounts.oldest_active_updated_at);
    const oldestActiveAgeSec = oldestActiveUpdatedAt
      ? Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(oldestActiveUpdatedAt)) / 1000))
      : null;

    return {
      observedAt: nowIso,
      collections: {
        total: numberOrZero(collectionCounts.total),
        creating: numberOrZero(collectionCounts.creating),
        indexing: numberOrZero(collectionCounts.indexing),
        ready: numberOrZero(collectionCounts.ready),
        failed: numberOrZero(collectionCounts.failed),
        archived: numberOrZero(collectionCounts.archived),
      },
      jobs: {
        total: numberOrZero(jobCounts.total),
        active: numberOrZero(jobCounts.active),
        queued: numberOrZero(jobCounts.queued),
        running: numberOrZero(jobCounts.running),
        terminal: numberOrZero(jobCounts.terminal),
        succeeded: numberOrZero(jobCounts.succeeded),
        failed: numberOrZero(jobCounts.failed),
        cancelled: numberOrZero(jobCounts.cancelled),
        oldestActiveUpdatedAt,
        oldestActiveAgeSec,
        newestFailureAt: stringOrNull(jobCounts.newest_failure_at),
      },
      physicalCollections: {
        total: numberOrZero(physicalCollectionCounts.total),
        building: numberOrZero(physicalCollectionCounts.building),
        active: numberOrZero(physicalCollectionCounts.active),
        failedBuild: numberOrZero(physicalCollectionCounts.failed_build),
        deletePending: numberOrZero(physicalCollectionCounts.delete_pending),
        cleanupFailed: numberOrZero(physicalCollectionCounts.cleanup_failed),
        deleted: numberOrZero(physicalCollectionCounts.deleted),
        cleanupBacklog: numberOrZero(physicalCollectionCounts.cleanup_backlog),
        oldestDueDeleteAt: stringOrNull(physicalCollectionCounts.oldest_due_delete_at),
      },
    };
  }

  async getJob(jobId: string): Promise<IndexJob | null> {
    const row = this.getJobRow(jobId);
    return row ? mapIndexJobRow(row) : null;
  }

  async listJobEvents(context: RequestContext, jobId: string): Promise<IndexJobEvent[]> {
    const job = this.getJobRow(jobId);
    if (!job || job.tenant_id !== context.tenantId) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const rows = this.db.prepare(`
      SELECT * FROM index_job_events
      WHERE job_id = ? AND tenant_id = ?
      ORDER BY sequence ASC, created_at ASC
    `).all(jobId, context.tenantId) as IndexJobEventRow[];

    return rows.map(mapIndexJobEventRow);
  }

  async appendJobEvent(jobId: string, input: CreateIndexJobEventInput): Promise<IndexJobEvent> {
    const transaction = this.db.transaction(() => {
      const job = this.getJobRow(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      const event = this.insertJobEvent(job, input);
      return mapIndexJobEventRow(event);
    });

    return transaction();
  }

  async deleteJob(context: RequestContext, jobId: string): Promise<void> {
    await this.deleteJobs(context, [jobId]);
  }

  async deleteJobs(context: RequestContext, jobIds: string[]): Promise<void> {
    const uniqueJobIds = [...new Set(jobIds)];
    if (uniqueJobIds.length === 0) {
      return;
    }

    const transaction = this.db.transaction(() => {
      for (const jobId of uniqueJobIds) {
        const existing = this.getJobRow(jobId);
        if (!existing || existing.tenant_id !== context.tenantId) {
          throw new Error(`Job not found: ${jobId}`);
        }

        if (existing.status === "queued" || existing.status === "running") {
          throw new Error(`Job ${jobId} is in status '${existing.status}', cannot be deleted.`);
        }
      }

      const deleteStatement = this.db.prepare(`
        DELETE FROM index_jobs
        WHERE id = @id
          AND tenant_id = @tenantId
          AND status NOT IN ('queued', 'running')
      `);

      for (const jobId of uniqueJobIds) {
        const result = deleteStatement.run({
          id: jobId,
          tenantId: context.tenantId,
        });

        if (result.changes !== 1) {
          throw new Error(`Job not found: ${jobId}`);
        }
      }
    });

    transaction();
  }

  async getActiveJobForCollection(context: RequestContext, collectionId: string): Promise<IndexJob | null> {
    const row = this.db.prepare(`
      SELECT * FROM index_jobs
      WHERE tenant_id = ? AND collection_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(context.tenantId, collectionId) as IndexJobRow | undefined;
    
    return row ? mapIndexJobRow(row) : null;
  }

  async createCollection(context: RequestContext, input: CreateCollectionInput): Promise<RagCollection> {
    const now = new Date().toISOString();
    const id = this.createUniqueCollectionId(input.displayName);
    const chromaConfiguration = normalizeChromaCollectionConfiguration(
      input.distanceMetric,
      input.chromaCollectionConfiguration,
    );

    this.db.prepare(`
      INSERT INTO collections (
        id,
        tenant_id,
        display_name,
        description,
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
        @id,
        @tenantId,
        @displayName,
        @description,
        'creating',
        @sourcePath,
        @ozelgeDataPath,
        @embeddingModel,
        @chatModel,
        @distanceMetric,
        @chromaCollectionConfigurationJson,
        @chunkSize,
        @chunkOverlap,
        @retrievalK,
        @retrievalDistanceThreshold,
        @createdBy,
        @createdAt,
        @updatedAt
      )
    `).run({
      id,
      tenantId: context.tenantId,
      displayName: input.displayName,
      description: input.description ?? null,
      sourcePath: input.sourcePath,
      ozelgeDataPath: input.ozelgeDataPath,
      embeddingModel: input.embeddingModel,
      chatModel: input.chatModel,
      distanceMetric: input.distanceMetric,
      chromaCollectionConfigurationJson: JSON.stringify(chromaConfiguration),
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
      retrievalK: input.retrievalK,
      retrievalDistanceThreshold: input.retrievalDistanceThreshold,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    const collection = await this.getVisibleCollection(context, id);
    if (!collection) {
      throw new Error(`Created collection ${id} could not be loaded.`);
    }

    return collection;
  }

  async updateCollection(
    context: RequestContext,
    collectionId: string,
    patch: UpdateCollectionPatch,
  ): Promise<RagCollection> {
    const existing = await this.getVisibleCollection(context, collectionId);
    if (!existing) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    const updates: string[] = [];
    const values: Record<string, unknown> = {
      tenantId: context.tenantId,
      id: collectionId,
      updatedAt: new Date().toISOString(),
    };

    addPatch("displayName", "display_name", patch.displayName, updates, values);
    addNullablePatch("description", "description", patch.description, updates, values);
    addPatch("status", "status", patch.status, updates, values);
    addPatch("sourcePath", "source_path", patch.sourcePath, updates, values);
    addPatch("ozelgeDataPath", "ozelge_data_path", patch.ozelgeDataPath, updates, values);
    addPatch("embeddingModel", "embedding_model", patch.embeddingModel, updates, values);
    addPatch("chatModel", "chat_model", patch.chatModel, updates, values);
    addPatch("distanceMetric", "distance_metric", patch.distanceMetric, updates, values);
    if (patch.chromaCollectionConfiguration !== undefined || patch.distanceMetric !== undefined) {
      const nextDistanceMetric = patch.distanceMetric ?? existing.distanceMetric;
      const nextChromaConfiguration = normalizeChromaCollectionConfiguration(
        nextDistanceMetric,
        patch.chromaCollectionConfiguration ?? existing.chromaCollectionConfiguration,
      );
      updates.push("chroma_collection_configuration_json = @chromaCollectionConfigurationJson");
      values.chromaCollectionConfigurationJson = JSON.stringify(nextChromaConfiguration);
    }
    addPatch("chunkSize", "chunk_size", patch.chunkSize, updates, values);
    addPatch("chunkOverlap", "chunk_overlap", patch.chunkOverlap, updates, values);
    addPatch("retrievalK", "retrieval_k", patch.retrievalK, updates, values);
    addPatch(
      "retrievalDistanceThreshold",
      "retrieval_distance_threshold",
      patch.retrievalDistanceThreshold,
      updates,
      values,
    );
    addNullablePatch(
      "activeEmbeddingModel",
      "active_embedding_model",
      patch.activeEmbeddingModel,
      updates,
      values,
    );
    addNullablePatch(
      "activePhysicalCollection",
      "active_physical_collection",
      patch.activePhysicalCollection,
      updates,
      values,
    );
    addNullablePatch("activeVersion", "active_version", patch.activeVersion, updates, values);
    addNullablePatch("documentCount", "document_count", patch.documentCount, updates, values);
    addNullablePatch("chunkCount", "chunk_count", patch.chunkCount, updates, values);
    addNullablePatch("lastIndexedAt", "last_indexed_at", patch.lastIndexedAt, updates, values);

    if (updates.length === 0) {
      return existing;
    }

    updates.push("updated_at = @updatedAt");

    this.db.prepare(`
      UPDATE collections
      SET ${updates.join(", ")}
      WHERE tenant_id = @tenantId AND id = @id
    `).run(values);

    const updated = await this.getVisibleCollection(context, collectionId);
    if (!updated) {
      throw new Error(`Updated collection ${collectionId} could not be loaded.`);
    }

    return updated;
  }

  async beginIndexJob(
    context: RequestContext,
    collectionId: string,
    input: BeginIndexJobInput = {},
  ): Promise<IndexJob> {
    const transaction = this.db.transaction(() => {
      const collection = this.getCollectionRow(context.tenantId, collectionId);
      if (!collection || collection.status === "archived") {
        throw new Error(`Collection not found: ${collectionId}`);
      }

      const activeJob = this.db.prepare(`
        SELECT id FROM index_jobs
        WHERE tenant_id = ? AND collection_id = ? AND status IN ('queued', 'running')
        LIMIT 1
      `).get(context.tenantId, collectionId) as { id: string } | undefined;

      if (activeJob) {
        throw new Error(`Collection already has a queued or running index job: ${collectionId}`);
      }

      const nowDate = new Date();
      const now = nowDate.toISOString();
      const version = input.targetVersion ?? this.createUniqueVersionString(context.tenantId, collectionId, nowDate);
      const targetChromaConfiguration = normalizeChromaCollectionConfiguration(
        collection.distance_metric,
        input.targetChromaConfiguration ?? JSON.parse(
          collection.chroma_collection_configuration_json,
        ) as Record<string, unknown>,
      );
      const job: IndexJob = {
        id: `${version}_${randomUUID().slice(0, 8)}`,
        collectionId,
        tenantId: context.tenantId,
        status: "queued",
        targetPhysicalCollection: input.targetPhysicalCollection ?? createPhysicalCollectionName({
          tenantId: context.tenantId,
          collectionId,
          version,
        }),
        targetVersion: version,
        targetEmbeddingModel: collection.embedding_model,
        targetChromaConfiguration,
        lockToken: input.lockToken ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      this.db.prepare(`
        INSERT INTO index_jobs (
          id,
          collection_id,
          tenant_id,
          status,
          target_physical_collection,
          target_version,
          target_embedding_model,
          target_chroma_configuration_json,
          lock_token,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @collectionId,
          @tenantId,
          @status,
          @targetPhysicalCollection,
          @targetVersion,
          @targetEmbeddingModel,
          @targetChromaConfigurationJson,
          @lockToken,
          @createdAt,
          @updatedAt
        )
      `).run({
        id: job.id,
        collectionId: job.collectionId,
        tenantId: job.tenantId,
        status: job.status,
        targetPhysicalCollection: job.targetPhysicalCollection,
        targetVersion: job.targetVersion,
        targetEmbeddingModel: job.targetEmbeddingModel,
        targetChromaConfigurationJson: JSON.stringify(job.targetChromaConfiguration),
        lockToken: job.lockToken,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });

      this.insertJobEvent(job, {
        status: "queued",
        stage: "queued",
        code: "JOB_QUEUED",
        message: "Job queued for execution.",
        progress: {
          phase: 1,
          phaseCount: 6,
        },
        createdAt: now,
      });

      // Status goes to indexing immediately when queued. We will separate running later if needed.
      this.db.prepare(`
        UPDATE collections
        SET status = 'indexing', updated_at = @updatedAt
        WHERE tenant_id = @tenantId AND id = @id
      `).run({
        tenantId: context.tenantId,
        id: collectionId,
        updatedAt: now,
      });

      return job;
    });

    return transaction();
  }

  async markIndexJobRunning(jobId: string, input?: { lockToken?: string }): Promise<IndexJob> {
    const transaction = this.db.transaction(() => {
      const existing = this.getJobRow(jobId);
      if (!existing) {
        throw new Error(`Index job not found: ${jobId}`);
      }
      
      if (existing.status !== 'queued') {
        throw new Error(`Job ${jobId} is in status '${existing.status}', cannot mark as running`);
      }

      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE index_jobs
        SET status = 'running', started_at = @startedAt, updated_at = @updatedAt
        WHERE id = @id
      `).run({
        id: jobId,
        startedAt: now,
        updatedAt: now,
      });

      this.insertJobEvent({
        ...existing,
        status: "running",
        started_at: now,
        updated_at: now,
      }, {
        status: "running",
        stage: "running",
        code: "JOB_RUNNING",
        message: "Job is now running.",
        progress: {
          phase: 2,
          phaseCount: 6,
        },
        createdAt: now,
      });

      const updated = this.getJobRow(jobId);
      if (!updated) {
        throw new Error(`Running job ${jobId} could not be loaded.`);
      }

      return mapIndexJobRow(updated);
    });

    return transaction();
  }

  async cancelIndexJob(jobId: string): Promise<IndexJob> {
    const transaction = this.db.transaction(() => {
      const existing = this.getJobRow(jobId);
      if (!existing) {
        throw new Error(`Index job not found: ${jobId}`);
      }

      if (existing.status === "cancelled") {
        return mapIndexJobRow(existing);
      }

      if (existing.status !== "queued" && existing.status !== "running") {
        throw new Error(`Job ${jobId} is in status '${existing.status}', cannot be cancelled.`);
      }

      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE index_jobs
        SET status = 'cancelled', finished_at = @finishedAt, updated_at = @updatedAt
        WHERE id = @id AND status IN ('queued', 'running')
      `).run({
        id: jobId,
        finishedAt: now,
        updatedAt: now,
      });

      this.insertJobEvent({
        ...existing,
        status: "cancelled",
        finished_at: now,
        updated_at: now,
      }, {
        status: "cancelled",
        stage: "cancelled",
        code: "JOB_CANCELLED",
        message: "Job was cancelled.",
        progress: {
          phase: 6,
          phaseCount: 6,
        },
        createdAt: now,
      });

      this.db.prepare(`
        UPDATE physical_collections
        SET status = 'failed_build', cleanup_error = 'Cancelled by user'
        WHERE name = @name
          AND tenant_id = @tenantId
          AND collection_id = @collectionId
          AND version = @version
          AND status = 'building'
      `).run({
        name: existing.target_physical_collection,
        tenantId: existing.tenant_id,
        collectionId: existing.collection_id,
        version: existing.target_version,
      });

      const collection = this.getCollectionRow(existing.tenant_id, existing.collection_id);
      if (collection && collection.status !== "archived") {
        this.db.prepare(`
          UPDATE collections
          SET status = @status, updated_at = @updatedAt
          WHERE tenant_id = @tenantId AND id = @collectionId
        `).run({
          status: collection.active_physical_collection ? "ready" : "failed",
          tenantId: existing.tenant_id,
          collectionId: existing.collection_id,
          updatedAt: now,
        });
      }

      const updated = this.getJobRow(jobId);
      if (!updated) {
        throw new Error(`Cancelled job ${jobId} could not be loaded.`);
      }

      return mapIndexJobRow(updated);
    });

    return transaction();
  }

  async completeIndexJob(jobId: string, result: CompleteIndexJobResult): Promise<IndexJob> {
    const transaction = this.db.transaction(() => {
      const existing = this.getJobRow(jobId);
      if (!existing) {
        throw new Error(`Index job not found: ${jobId}`);
      }

      if (existing.status !== "running") {
        throw new Error(`Job ${jobId} is in status '${existing.status}', cannot be completed.`);
      }

      const collection = this.getCollectionRow(existing.tenant_id, existing.collection_id);
      if (!collection) {
        // If collection is gone, just cancel the job and return it.
        // This handles cases where collection was deleted while job was running.
        const now = new Date().toISOString();
        this.db.prepare(`
          UPDATE index_jobs
          SET status = 'cancelled', finished_at = @now, updated_at = @now
          WHERE id = @id AND status = 'running'
        `).run({ id: jobId, now });

        this.insertJobEvent({
          ...existing,
          status: "cancelled",
          finished_at: now,
          updated_at: now,
        }, {
          status: "cancelled",
          stage: "cancelled",
          code: "JOB_CANCELLED",
          message: "Job was cancelled because its collection no longer exists.",
          progress: {
            phase: 6,
            phaseCount: 6,
          },
          createdAt: now,
        });
        
        const cancelledJob = this.getJobRow(jobId);
        return mapIndexJobRow(cancelledJob!);
      }

      const activePhysicalCollection = result.activePhysicalCollection ?? existing.target_physical_collection;
      const activeVersion = result.activeVersion ?? existing.target_version;

      if (activeVersion !== existing.target_version) {
        throw new Error(
          `Job ${jobId} cannot activate version '${activeVersion}' because target version is '${existing.target_version}'.`,
        );
      }

      const physicalRecord = this.getPhysicalCollectionRow(activePhysicalCollection);
      if (!physicalRecord) {
        throw new Error(`Physical collection record not found: ${activePhysicalCollection}`);
      }

      if (
        physicalRecord.tenant_id !== existing.tenant_id
        || physicalRecord.collection_id !== existing.collection_id
        || physicalRecord.version !== existing.target_version
      ) {
        throw new Error(`Physical collection ${activePhysicalCollection} does not match job ${jobId} target.`);
      }

      if (physicalRecord.status !== "building") {
        throw new Error(
          `Physical collection ${activePhysicalCollection} is in status '${physicalRecord.status}', cannot be activated.`,
        );
      }

      const now = new Date().toISOString();
      const activatedResult = this.db.prepare(`
        UPDATE physical_collections
        SET
          status = 'active',
          activated_at = @now,
          document_count = @documentCount,
          chunk_count = @chunkCount,
          cleanup_error = NULL
        WHERE name = @newName
          AND tenant_id = @tenantId
          AND collection_id = @collectionId
          AND version = @version
          AND status = 'building'
      `).run({
        newName: activePhysicalCollection,
        tenantId: existing.tenant_id,
        collectionId: existing.collection_id,
        version: existing.target_version,
        now,
        documentCount: result.documentCount ?? existing.document_count,
        chunkCount: result.chunkCount ?? existing.chunk_count,
      });

      if (activatedResult.changes !== 1) {
        throw new Error(`Physical collection ${activePhysicalCollection} could not be activated for job ${jobId}.`);
      }

      if (
        collection.active_physical_collection
        && collection.active_physical_collection !== activePhysicalCollection
      ) {
        const deleteAfter = new Date(Date.now() + result.retentionMs).toISOString();
        const retiredResult = this.db.prepare(`
          UPDATE physical_collections
          SET status = 'delete_pending', retired_at = @now, delete_after = @deleteAfter
          WHERE name = @oldName
            AND tenant_id = @tenantId
            AND collection_id = @collectionId
            AND status = 'active'
        `).run({
          oldName: collection.active_physical_collection,
          tenantId: existing.tenant_id,
          collectionId: existing.collection_id,
          now,
          deleteAfter,
        });

        if (retiredResult.changes !== 1) {
          throw new Error(
            `Previous active physical collection ${collection.active_physical_collection} could not be retired for cleanup.`,
          );
        }
      }

      this.db.prepare(`
        UPDATE collections
        SET
          status = 'ready',
          active_physical_collection = @activePhysicalCollection,
          active_version = @activeVersion,
          active_embedding_model = @activeEmbeddingModel,
          document_count = @documentCount,
          chunk_count = @chunkCount,
          last_indexed_at = @lastIndexedAt,
          indexed_snapshot_json = @indexedSnapshotJson,
          updated_at = @updatedAt
        WHERE tenant_id = @tenantId AND id = @collectionId AND status != 'archived'
      `).run({
        tenantId: existing.tenant_id,
        collectionId: existing.collection_id,
        activePhysicalCollection,
        activeVersion,
        activeEmbeddingModel: existing.target_embedding_model,
        documentCount: result.documentCount ?? existing.document_count,
        chunkCount: result.chunkCount ?? existing.chunk_count,
        lastIndexedAt: now,
        indexedSnapshotJson: JSON.stringify(buildCollectionIndexSnapshot({
          sourcePath: collection.source_path,
          ozelgeDataPath: collection.ozelge_data_path,
          distanceMetric: collection.distance_metric,
          chunkSize: collection.chunk_size,
          chunkOverlap: collection.chunk_overlap,
          embeddingModel: collection.embedding_model,
        })),
        updatedAt: now,
      });

      this.db.prepare(`
        UPDATE index_jobs
        SET
          status = 'succeeded',
          finished_at = @finishedAt,
          error = NULL,
          document_count = @documentCount,
          chunk_count = @chunkCount,
          updated_at = @updatedAt
        WHERE id = @id AND status = 'running'
      `).run({
        id: jobId,
        finishedAt: now,
        documentCount: result.documentCount ?? existing.document_count,
        chunkCount: result.chunkCount ?? existing.chunk_count,
        updatedAt: now,
      });

      this.insertJobEvent({
        ...existing,
        status: "succeeded",
        finished_at: now,
        updated_at: now,
        document_count: result.documentCount ?? existing.document_count,
        chunk_count: result.chunkCount ?? existing.chunk_count,
      }, {
        status: "succeeded",
        stage: "succeeded",
        code: "JOB_SUCCEEDED",
        message: "Job completed successfully.",
        details: {
          activePhysicalCollection,
          activeVersion,
          documentCount: result.documentCount ?? existing.document_count ?? undefined,
          chunkCount: result.chunkCount ?? existing.chunk_count ?? undefined,
        },
        progress: {
          phase: 6,
          phaseCount: 6,
          itemsCompleted: result.chunkCount ?? existing.chunk_count ?? undefined,
          itemsTotal: result.chunkCount ?? existing.chunk_count ?? undefined,
          unit: "chunks",
        },
        createdAt: now,
      });

      const updated = this.getJobRow(jobId);
      if (!updated) {
        throw new Error(`Completed job ${jobId} could not be loaded.`);
      }

      return mapIndexJobRow(updated);
    });

    return transaction();
  }

  async failIndexJob(jobId: string, error: string): Promise<IndexJob> {
    const transaction = this.db.transaction(() => {
      const existing = this.getJobRow(jobId);
      if (!existing) {
        throw new Error(`Index job not found: ${jobId}`);
      }

      if (existing.status !== "queued" && existing.status !== "running") {
        throw new Error(`Job ${jobId} is in status '${existing.status}', cannot be failed.`);
      }

      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE index_jobs
        SET status = 'failed', finished_at = @finishedAt, error = @error, updated_at = @updatedAt
        WHERE id = @id AND status IN ('queued', 'running')
      `).run({
        id: jobId,
        finishedAt: now,
        error,
        updatedAt: now,
      });

      this.insertJobEvent({
        ...existing,
        status: "failed",
        finished_at: now,
        updated_at: now,
        error,
      }, {
        status: "failed",
        stage: "failed",
        code: "JOB_FAILED",
        level: "error",
        message: error,
        details: {
          targetPhysicalCollection: existing.target_physical_collection,
          targetVersion: existing.target_version,
        },
        progress: {
          phase: 6,
          phaseCount: 6,
        },
        createdAt: now,
      });

      this.db.prepare(`
        UPDATE physical_collections
        SET status = 'failed_build', cleanup_error = @error
        WHERE name = @name
          AND tenant_id = @tenantId
          AND collection_id = @collectionId
          AND version = @version
          AND status = 'building'
      `).run({
        name: existing.target_physical_collection,
        tenantId: existing.tenant_id,
        collectionId: existing.collection_id,
        version: existing.target_version,
        error,
      });

      const collection = this.getCollectionRow(existing.tenant_id, existing.collection_id);
      if (collection && collection.status !== "archived") {
        this.db.prepare(`
          UPDATE collections
          SET status = @status, updated_at = @updatedAt
          WHERE tenant_id = @tenantId AND id = @collectionId
        `).run({
          status: collection.active_physical_collection ? "ready" : "failed",
          tenantId: existing.tenant_id,
          collectionId: existing.collection_id,
          updatedAt: now,
        });
      }

      const updated = this.getJobRow(jobId);
      if (!updated) {
        throw new Error(`Failed job ${jobId} could not be loaded.`);
      }

      return mapIndexJobRow(updated);
    });

    return transaction();
  }

  async failStaleJobs(staleThresholdMs: number): Promise<number> {
    const thresholdDate = new Date(Date.now() - staleThresholdMs).toISOString();
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      const staleJobs = this.db.prepare(`
        SELECT * FROM index_jobs
        WHERE status IN ('queued', 'running') AND updated_at < ?
      `).all(thresholdDate) as IndexJobRow[];

      if (staleJobs.length === 0) {
        return 0;
      }

      for (const job of staleJobs) {
        this.db.prepare(`
          UPDATE index_jobs
          SET status = 'failed', error = @error, updated_at = @updatedAt, finished_at = @finishedAt
          WHERE id = @id AND status IN ('queued', 'running')
        `).run({
          id: job.id,
          error: "Job timed out (stale lock)",
          updatedAt: now,
          finishedAt: now,
        });

        this.insertJobEvent({
          ...job,
          status: "failed",
          finished_at: now,
          updated_at: now,
          error: "Job timed out (stale lock)",
        }, {
          status: "failed",
          stage: "failed",
          code: "JOB_FAILED",
          level: "error",
          message: "Job timed out (stale lock)",
          details: {
            targetPhysicalCollection: job.target_physical_collection,
            targetVersion: job.target_version,
          },
          progress: {
            phase: 6,
            phaseCount: 6,
          },
          createdAt: now,
        });

        this.db.prepare(`
          UPDATE physical_collections
          SET status = 'failed_build', cleanup_error = @error
          WHERE name = @name
            AND tenant_id = @tenantId
            AND collection_id = @collectionId
            AND version = @version
            AND status = 'building'
        `).run({
          name: job.target_physical_collection,
          tenantId: job.tenant_id,
          collectionId: job.collection_id,
          version: job.target_version,
          error: "Job timed out (stale lock)",
        });

        const collection = this.getCollectionRow(job.tenant_id, job.collection_id);
        if (collection && collection.status !== "archived") {
          this.db.prepare(`
            UPDATE collections
            SET status = ?, updated_at = ?
            WHERE tenant_id = ? AND id = ? AND status = 'indexing'
          `).run(
            collection.active_physical_collection ? "ready" : "failed",
            now,
            job.tenant_id,
            job.collection_id,
          );
        }
      }

      return staleJobs.length;
    });

    return transaction();
  }

  async getPhysicalCollection(name: string): Promise<PhysicalCollectionRecord | null> {
    const row = this.getPhysicalCollectionRow(name);
    return row ? mapPhysicalCollectionRow(row) : null;
  }

  async createPhysicalCollectionRecord(input: {
    name: string;
    tenantId: string;
    collectionId: string;
    version: string;
    chromaConfiguration: Record<string, unknown>;
  }): Promise<PhysicalCollectionRecord> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO physical_collections (
        name, tenant_id, collection_id, version, status, chroma_configuration_json, created_at
      ) VALUES (
        @name, @tenantId, @collectionId, @version, 'building', @chromaConfigurationJson, @now
      )
    `).run({
      name: input.name,
      tenantId: input.tenantId,
      collectionId: input.collectionId,
      version: input.version,
      chromaConfigurationJson: JSON.stringify(input.chromaConfiguration),
      now
    });

    const row = this.db.prepare("SELECT * FROM physical_collections WHERE name = ?").get(input.name) as PhysicalCollectionRow;
    return mapPhysicalCollectionRow(row);
  }

  async markPhysicalCollectionDeleted(name: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE physical_collections
      SET status = 'deleted', deleted_at = @now, cleanup_error = NULL
      WHERE name = @name AND status IN ('delete_pending', 'cleanup_failed')
    `).run({ name, now: new Date().toISOString() });

    if (result.changes !== 1) {
      throw new Error(`Physical collection ${name} is not pending cleanup.`);
    }
  }

  async markPhysicalCollectionCleanupFailed(name: string, error: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE physical_collections
      SET status = 'cleanup_failed', cleanup_error = @error
      WHERE name = @name AND status IN ('delete_pending', 'cleanup_failed')
    `).run({ name, error });

    if (result.changes !== 1) {
      throw new Error(`Physical collection ${name} is not pending cleanup retry.`);
    }
  }

  async listDuePhysicalCollectionsForCleanup(nowIso: string, limit: number) {
    const rows = this.db.prepare(`
      SELECT * FROM physical_collections
      WHERE status IN ('delete_pending', 'cleanup_failed')
        AND delete_after IS NOT NULL
        AND delete_after <= ?
      ORDER BY delete_after ASC, created_at ASC
      LIMIT ?
    `).all(nowIso, limit) as PhysicalCollectionRow[];

    return rows.map(mapPhysicalCollectionRow);
  }

  async deleteCollection(context: RequestContext, collectionId: string): Promise<string[]> {
    const transaction = this.db.transaction(() => {
      const collection = this.getCollectionRow(context.tenantId, collectionId);
      if (!collection) {
        throw new Error(`Collection not found: ${collectionId}`);
      }

      const now = new Date().toISOString();

      // Find active jobs to return for aborting in memory
      const activeJobs = this.db.prepare(`
        SELECT * FROM index_jobs
        WHERE collection_id = ? AND status IN ('queued', 'running')
      `).all(collectionId) as IndexJobRow[];
      const activeJobIds = activeJobs.map((job) => job.id);

      // Cancel active jobs
      this.db.prepare(`
        UPDATE index_jobs
        SET status = 'cancelled', finished_at = @now, updated_at = @now
        WHERE collection_id = @collectionId AND status IN ('queued', 'running')
      `).run({ now, collectionId });

      for (const job of activeJobs) {
        this.insertJobEvent({
          ...job,
          status: "cancelled",
          finished_at: now,
          updated_at: now,
        }, {
          status: "cancelled",
          stage: "cancelled",
          code: "JOB_CANCELLED",
          message: "Job was cancelled because the collection was deleted.",
          details: {
            collectionDeleted: true,
          },
          progress: {
            phase: 6,
            phaseCount: 6,
          },
          createdAt: now,
        });
      }

      // Mark all physical collections for cleanup
      this.db.prepare(`
        UPDATE physical_collections
        SET status = 'delete_pending', delete_after = @now
        WHERE collection_id = @collectionId AND status != 'deleted'
      `).run({ now, collectionId });

      // Soft delete the collection
      this.db.prepare(`
        UPDATE collections
        SET status = 'archived', updated_at = @now
        WHERE tenant_id = @tenantId AND id = @collectionId
      `).run({ tenantId: context.tenantId, collectionId, now });

      return activeJobIds;
    });

    return transaction();
  }

  async collectionExists(collectionId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT id FROM collections WHERE id = ? AND status != 'archived'").get(collectionId);
    return !!row;
  }

  close(): void {
    this.db.close();
  }

  private insertJobEvent(job: IndexJobRow | IndexJob, input: CreateIndexJobEventInput): IndexJobEventRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const jobId = job.id;
    const tenantId = "tenant_id" in job ? job.tenant_id : job.tenantId;
    const collectionId = "collection_id" in job ? job.collection_id : job.collectionId;
    const nextSequenceRow = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS max_sequence
      FROM index_job_events
      WHERE job_id = ?
    `).get(jobId) as { max_sequence: number | null };
    const sequence = (nextSequenceRow.max_sequence ?? 0) + 1;
    const id = `${jobId}:evt:${sequence}`;

    this.db.prepare(`
      INSERT INTO index_job_events (
        id,
        job_id,
        tenant_id,
        collection_id,
        sequence,
        status,
        stage,
        code,
        level,
        message,
        details_json,
        progress_json,
        created_at
      ) VALUES (
        @id,
        @jobId,
        @tenantId,
        @collectionId,
        @sequence,
        @status,
        @stage,
        @code,
        @level,
        @message,
        @detailsJson,
        @progressJson,
        @createdAt
      )
    `).run({
      id,
      jobId,
      tenantId,
      collectionId,
      sequence,
      status: input.status,
      stage: input.stage,
      code: input.code,
      level: input.level ?? "info",
      message: input.message,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
      progressJson: input.progress ? JSON.stringify(input.progress) : null,
      createdAt,
    });

    const row = this.db.prepare("SELECT * FROM index_job_events WHERE id = ?").get(id) as IndexJobEventRow | undefined;
    if (!row) {
      throw new Error(`Job event ${id} could not be loaded.`);
    }

    return row;
  }

  private createUniqueCollectionId(displayName: string): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generateCollectionId(displayName);
      const existing = this.db.prepare("SELECT id FROM collections WHERE id = ?").get(id);

      if (!existing) {
        return id;
      }
    }

    throw new Error("Could not generate a unique collection id.");
  }

  private createUniqueVersionString(tenantId: string, collectionId: string, startedAt: Date): string {
    const candidateDate = new Date(startedAt.getTime());

    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const version = createVersionString(candidateDate.toISOString());
      const existingJob = this.db.prepare(`
        SELECT 1 FROM index_jobs
        WHERE tenant_id = ? AND collection_id = ? AND target_version = ?
        LIMIT 1
      `).get(tenantId, collectionId, version);
      const existingPhysicalCollection = this.db.prepare(`
        SELECT 1 FROM physical_collections
        WHERE tenant_id = ? AND collection_id = ? AND version = ?
        LIMIT 1
      `).get(tenantId, collectionId, version);

      if (!existingJob && !existingPhysicalCollection) {
        return version;
      }

      candidateDate.setTime(candidateDate.getTime() + 1);
    }

    throw new Error(`Could not generate a unique collection version for ${collectionId}.`);
  }

  private getCollectionRow(tenantId: string, collectionId: string): CollectionRow | null {
    const row = this.db
      .prepare("SELECT * FROM collections WHERE tenant_id = ? AND id = ?")
      .get(tenantId, collectionId) as CollectionRow | undefined;

    return row ?? null;
  }

  private getJobRow(jobId: string): IndexJobRow | null {
    const row = this.db
      .prepare("SELECT * FROM index_jobs WHERE id = ?")
      .get(jobId) as IndexJobRow | undefined;

    return row ?? null;
  }

  private getPhysicalCollectionRow(name: string): PhysicalCollectionRow | null {
    const row = this.db
      .prepare("SELECT * FROM physical_collections WHERE name = ?")
      .get(name) as PhysicalCollectionRow | undefined;

    return row ?? null;
  }

}

function addPatch(
  key: string,
  column: string,
  value: unknown,
  updates: string[],
  values: Record<string, unknown>,
): void {
  if (value === undefined) {
    return;
  }

  updates.push(`${column} = @${key}`);
  values[key] = value;
}

function addNullablePatch(
  key: string,
  column: string,
  value: unknown,
  updates: string[],
  values: Record<string, unknown>,
): void {
  if (value === undefined) {
    return;
  }

  updates.push(`${column} = @${key}`);
  values[key] = value ?? null;
}

function mapCollectionRow(row: CollectionRow): RagCollection {
  const activeSnapshot = parseCollectionIndexSnapshotJson(row.indexed_snapshot_json);
  const collection: RagCollection = {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    description: row.description ?? undefined,
    status: row.status,
    activePhysicalCollection: row.active_physical_collection ?? undefined,
    activeVersion: row.active_version ?? undefined,
    sourcePath: row.source_path,
    ozelgeDataPath: row.ozelge_data_path,
    embeddingModel: row.embedding_model,
    chatModel: row.chat_model,
    distanceMetric: row.distance_metric,
    chromaCollectionConfiguration: JSON.parse(row.chroma_collection_configuration_json) as Record<string, unknown>,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    retrievalK: row.retrieval_k,
    retrievalDistanceThreshold: row.retrieval_distance_threshold,
    activeEmbeddingModel: row.active_embedding_model ?? undefined,
    documentCount: row.document_count ?? undefined,
    chunkCount: row.chunk_count ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastIndexedAt: row.last_indexed_at ?? undefined,
  };

  return {
    ...collection,
    indexState: buildCollectionIndexState(collection, activeSnapshot),
  };
}

function parseCollectionIndexSnapshotJson(value: string | null): ReturnType<typeof parseCollectionIndexSnapshot> {
  if (!value) return null;
  try {
    return parseCollectionIndexSnapshot(JSON.parse(value));
  } catch {
    return null;
  }
}

function mapIndexJobRow(row: IndexJobRow): IndexJob {
  return {
    id: row.id,
    collectionId: row.collection_id,
    tenantId: row.tenant_id,
    status: row.status,
    targetPhysicalCollection: row.target_physical_collection,
    targetVersion: row.target_version,
    targetEmbeddingModel: row.target_embedding_model,
    targetChromaConfiguration: JSON.parse(row.target_chroma_configuration_json) as Record<string, unknown>,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
    documentCount: row.document_count ?? undefined,
    chunkCount: row.chunk_count ?? undefined,
    lockToken: row.lock_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIndexJobSummaryRow(row: IndexJobSummaryRow): IndexJobListItem {
  return {
    job: mapIndexJobRow(row),
    collection: row.collection_snapshot_id
      ? {
          id: row.collection_snapshot_id,
          displayName: row.collection_snapshot_display_name ?? "",
          status: row.collection_snapshot_status ?? "creating",
        }
      : null,
  };
}

function mapIndexJobEventRow(row: IndexJobEventRow): IndexJobEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    tenantId: row.tenant_id,
    collectionId: row.collection_id,
    sequence: row.sequence,
    status: row.status,
    stage: row.stage,
    code: row.code,
    level: row.level,
    message: row.message,
    details: parseJsonRecord(row.details_json) ?? undefined,
    progress: parseJobEventProgress(row.progress_json) ?? undefined,
    createdAt: row.created_at,
  };
}

function mapPhysicalCollectionRow(row: PhysicalCollectionRow): PhysicalCollectionRecord {
  return {
    name: row.name,
    tenantId: row.tenant_id,
    collectionId: row.collection_id,
    version: row.version,
    status: row.status,
    chromaConfiguration: JSON.parse(row.chroma_configuration_json) as Record<string, unknown>,
    documentCount: row.document_count ?? undefined,
    chunkCount: row.chunk_count ?? undefined,
    createdAt: row.created_at,
    activatedAt: row.activated_at ?? undefined,
    retiredAt: row.retired_at ?? undefined,
    deleteAfter: row.delete_after ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    cleanupError: row.cleanup_error ?? undefined,
  };
}

function createVersionString(isoDate: string): string {
  // Add ms to prevent same-second physical collection name collisions
  return isoDate
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, (match) => `_${match.slice(1)}`)
    .toLowerCase();
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  const rounded = Math.trunc(value);
  return Math.min(maximum, Math.max(minimum, rounded));
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJobEventProgress(value: string | null): IndexJobEventProgress | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<IndexJobEventProgress>;
    if (
      typeof parsed !== "object"
      || parsed === null
      || typeof parsed.phase !== "number"
      || typeof parsed.phaseCount !== "number"
    ) {
      return null;
    }

    return {
      phase: parsed.phase,
      phaseCount: parsed.phaseCount,
      itemsCompleted: typeof parsed.itemsCompleted === "number" ? parsed.itemsCompleted : undefined,
      itemsTotal: typeof parsed.itemsTotal === "number" ? parsed.itemsTotal : undefined,
      unit: parsed.unit,
    };
  } catch {
    return null;
  }
}

function encodeJobCursor(row: IndexJobSummaryRow): string {
  return Buffer.from(JSON.stringify({
    updatedAt: row.updated_at,
    id: row.id,
  }), "utf8").toString("base64url");
}

function decodeJobCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string" || !parsed.updatedAt || !parsed.id) {
      throw new Error("Invalid job cursor.");
    }

    return {
      updatedAt: parsed.updatedAt,
      id: parsed.id,
    };
  } catch {
    throw new Error("Invalid job cursor.");
  }
}

function normalizeChromaCollectionConfiguration(
  distanceMetric: DistanceMetric,
  chromaConfiguration?: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = isRecord(chromaConfiguration) ? { ...chromaConfiguration } : {};
  const existingHnsw = isRecord(normalized.hnsw) ? normalized.hnsw : {};

  return {
    ...normalized,
    hnsw: {
      ...existingHnsw,
      space: distanceMetric,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}



