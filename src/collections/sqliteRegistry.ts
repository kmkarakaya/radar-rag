import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { DistanceMetric } from "../config.js";
import type { EmbeddingProvider } from "../embeddings/models.js";
import { createPhysicalCollectionName, generateCollectionId } from "./ids.js";
import {
  buildCollectionIndexSnapshot,
  buildCollectionIndexState,
  normalizeEmbeddingServiceId,
  parseCollectionIndexSnapshot,
  SERVER_EMBEDDING_SERVICE_ID,
} from "./indexState.js";
import { BUILTIN_EMBEDDING_SERVICE_ID } from "../embeddings/models.js";
import { toPortablePath } from "../paths.js";
import type { OperationalLogEvent } from "../observability/logger.js";
import type {
  AuditLogRecord,
  BeginIndexJobInput,
  CollectionRegistry,
  CollectionSourceKind,
  CollectionStatus,
  CompleteIndexJobResult,
  CreateIndexJobEventInput,
  CreateCollectionInput,
  ChatSettings,
  CreateServiceConnectionInput,
  ServiceConnection,
  UpdateServiceConnectionPatch,
  ListAuditLogInput,
  ListAuditLogResult,
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
  /**
   * When set, collection source paths inside this folder are stored relative to it, and existing
   * absolute rows are rewritten once at startup. Keeps the registry valid after the repo is moved.
   */
  projectRoot?: string;
};

type CollectionRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  description: string | null;
  status: CollectionStatus;
  active_physical_collection: string | null;
  active_version: string | null;
  source_kind: CollectionSourceKind;
  source_path: string;
  embedding_provider: EmbeddingProvider;
  embedding_model: string;
  distance_metric: "l2" | "cosine" | "ip";
  chroma_collection_configuration_json: string;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_k: number;
  retrieval_distance_threshold: number;
  active_embedding_provider: EmbeddingProvider | null;
  active_embedding_model: string | null;
  embedding_service_id: string | null;
  active_embedding_service_id: string | null;
  document_count: number | null;
  chunk_count: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_indexed_at: string | null;
  indexed_snapshot_json: string | null;
  documents_changed: number;
};

type IndexJobRow = {
  id: string;
  collection_id: string;
  tenant_id: string;
  status: IndexJobStatus;
  target_physical_collection: string;
  target_version: string;
  target_embedding_provider: EmbeddingProvider;
  target_embedding_model: string;
  target_embedding_service_id: string | null;
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

/** Error of a job whose process stopped or crashed (no heartbeat any more). */
export const STALE_JOB_ERROR = "Interrupted: the job stopped reporting progress because the server stopped or crashed. "
  + "Re-index again.";

type ServiceConnectionRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  base_url: string;
  api_key: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** Tables of service connections; the name is never taken from input. */
type ServiceConnectionTable = "embedding_services" | "chat_services";

type ChatSettingsRow = {
  tenant_id: string;
  service_id: string;
  model: string;
  updated_by: string;
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

type OperationalLogRow = {
  id: number;
  timestamp: string;
  tenant_id: string;
  request_id: string | null;
  user_id: string | null;
  collection_id: string | null;
  physical_collection: string | null;
  job_id: string | null;
  operation: string;
  status: string;
  latency_ms: number | null;
  error_code: string | null;
  message: string | null;
  details_json: string | null;
};

type SqliteDatabase = Database.Database;

export function createSqliteCollectionRegistry(options: SqliteRegistryOptions): CollectionRegistry {
  const db = openDatabase(options.dbPath);
  initializeSchema(db);
  if (options.projectRoot) {
    makeStoredSourcePathsPortable(db, options.projectRoot);
  }

  return new SqliteCollectionRegistry(db, options.projectRoot);
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
      embedding_provider TEXT NOT NULL DEFAULT 'builtin',
      embedding_model TEXT NOT NULL,
      distance_metric TEXT NOT NULL,
      chroma_collection_configuration_json TEXT NOT NULL,
      chunk_size INTEGER NOT NULL,
      chunk_overlap INTEGER NOT NULL,
      retrieval_k INTEGER NOT NULL,
      retrieval_distance_threshold REAL NOT NULL,
      active_embedding_provider TEXT,
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
      target_embedding_provider TEXT NOT NULL DEFAULT 'builtin',
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

    CREATE TABLE IF NOT EXISTS embedding_services (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_services_tenant_name
      ON embedding_services(tenant_id, display_name);

    CREATE TABLE IF NOT EXISTS chat_services (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_services_tenant_name
      ON chat_services(tenant_id, display_name);

    CREATE TABLE IF NOT EXISTS chat_settings (
      tenant_id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      request_id TEXT,
      user_id TEXT,
      collection_id TEXT,
      physical_collection TEXT,
      job_id TEXT,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      error_code TEXT,
      message TEXT,
      details_json TEXT
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
    CREATE INDEX IF NOT EXISTS idx_operational_logs_tenant_id_desc
      ON operational_logs(tenant_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_operational_logs_collection_operation_desc
      ON operational_logs(tenant_id, collection_id, operation, id DESC);
    CREATE INDEX IF NOT EXISTS idx_operational_logs_tenant_operation
      ON operational_logs(tenant_id, operation);
  `);

  migrateSchema(db);
}

function migrateSchema(db: SqliteDatabase): void {
  ensureColumn(db, "collections", "active_embedding_model", "TEXT");
  // Embedding provider per collection (builtin | openai-compatible). Not a data migration: existing dev
  // registries only need the columns to open; their Ollama-built collections are recreated.
  ensureColumn(db, "collections", "embedding_provider", "TEXT NOT NULL DEFAULT 'builtin'");
  ensureColumn(db, "collections", "active_embedding_provider", "TEXT");
  ensureColumn(db, "index_jobs", "target_embedding_provider", "TEXT NOT NULL DEFAULT 'builtin'");
  ensureColumn(db, "collections", "indexed_snapshot_json", "TEXT");
  // Document management: existing collections read a folder on the server.
  ensureColumn(db, "collections", "source_kind", "TEXT NOT NULL DEFAULT 'folder'");
  ensureColumn(db, "collections", "documents_changed", "INTEGER NOT NULL DEFAULT 0");
  // Embedding services: an openai-compatible collection without a service id uses "server" (.env / config).
  ensureColumn(db, "collections", "embedding_service_id", "TEXT");
  ensureColumn(db, "collections", "active_embedding_service_id", "TEXT");
  ensureColumn(db, "index_jobs", "target_embedding_service_id", "TEXT");
  // Interrupted jobs: a running job marks itself alive; failStaleJobs fails jobs whose mark stopped.
  ensureColumn(db, "index_jobs", "heartbeat_at", "TEXT");
  // Ozelge JSON support was removed; older registries still have this NOT NULL column, which would break inserts.
  dropColumnIfExists(db, "collections", "ozelge_data_path");
  // The chat LLM is now global and optional (config `chat` section); older registries have a NOT NULL chat_model column.
  dropColumnIfExists(db, "collections", "chat_model");

  const backfillNow = new Date().toISOString();
  const snapshotRows = db.prepare(`
    SELECT id, source_path, distance_metric, chunk_size, chunk_overlap, embedding_provider, embedding_model
    FROM collections
    WHERE active_physical_collection IS NOT NULL
      AND (indexed_snapshot_json IS NULL OR indexed_snapshot_json = '')
  `).all() as Array<{
    id: string;
    source_path: string;
    distance_metric: "l2" | "cosine" | "ip";
    chunk_size: number;
    chunk_overlap: number;
    embedding_provider: EmbeddingProvider;
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
        distanceMetric: row.distance_metric,
        chunkSize: row.chunk_size,
        chunkOverlap: row.chunk_overlap,
        embeddingProvider: row.embedding_provider,
        embeddingModel: row.embedding_model,
      }),
      updatedAt: backfillNow,
    });
  }
}

/** Rewrites absolute source paths inside projectRoot (and their index snapshots) to the portable relative form. */
function makeStoredSourcePathsPortable(db: SqliteDatabase, projectRoot: string): void {
  const rows = db.prepare(`SELECT id, source_path, indexed_snapshot_json FROM collections`).all() as Array<{
    id: string;
    source_path: string;
    indexed_snapshot_json: string | null;
  }>;
  const update = db.prepare(`
    UPDATE collections
    SET source_path = @sourcePath, indexed_snapshot_json = @indexedSnapshotJson
    WHERE id = @id
  `);

  const rewrite = db.transaction(() => {
    for (const row of rows) {
      const sourcePath = toPortablePath(row.source_path, projectRoot);
      let indexedSnapshotJson = row.indexed_snapshot_json;
      if (indexedSnapshotJson) {
        try {
          const snapshot = JSON.parse(indexedSnapshotJson) as { sourcePath?: unknown };
          if (typeof snapshot.sourcePath === "string") {
            snapshot.sourcePath = toPortablePath(snapshot.sourcePath, projectRoot);
            indexedSnapshotJson = JSON.stringify(snapshot);
          }
        } catch {
          // Leave unparseable snapshots alone; index state already treats them as unavailable.
        }
      }

      if (sourcePath !== row.source_path || indexedSnapshotJson !== row.indexed_snapshot_json) {
        update.run({ id: row.id, sourcePath, indexedSnapshotJson });
      }
    }
  });
  rewrite();
}

function ensureColumn(db: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function dropColumnIfExists(db: SqliteDatabase, tableName: string, columnName: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
}

class SqliteCollectionRegistry implements CollectionRegistry {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly projectRoot?: string,
  ) {}

  private storedSourcePath(sourcePath: string): string {
    return this.projectRoot ? toPortablePath(sourcePath, this.projectRoot) : sourcePath;
  }

  async listVisibleCollections(context: RequestContext): Promise<RagCollection[]> {
    const rows = this.db
      .prepare("SELECT * FROM collections WHERE tenant_id = ? AND status != 'archived' ORDER BY updated_at DESC")
      .all(context.tenantId) as CollectionRow[];

    return rows.map(mapCollectionRow);
  }

  async listEmbeddingServices(context: RequestContext): Promise<ServiceConnection[]> {
    return this.listServiceConnections("embedding_services", context);
  }

  async getEmbeddingService(context: RequestContext, serviceId: string): Promise<ServiceConnection | null> {
    return this.getServiceConnection("embedding_services", context, serviceId);
  }

  async createEmbeddingService(context: RequestContext, input: CreateServiceConnectionInput): Promise<ServiceConnection> {
    return this.createServiceConnection("embedding_services", context, input);
  }

  async updateEmbeddingService(
    context: RequestContext,
    serviceId: string,
    patch: UpdateServiceConnectionPatch,
  ): Promise<ServiceConnection> {
    return this.updateServiceConnection("embedding_services", context, serviceId, patch);
  }

  async deleteEmbeddingService(context: RequestContext, serviceId: string): Promise<void> {
    this.deleteServiceConnection("embedding_services", context, serviceId);
  }

  async listChatServices(context: RequestContext): Promise<ServiceConnection[]> {
    return this.listServiceConnections("chat_services", context);
  }

  async getChatService(context: RequestContext, serviceId: string): Promise<ServiceConnection | null> {
    return this.getServiceConnection("chat_services", context, serviceId);
  }

  async createChatService(context: RequestContext, input: CreateServiceConnectionInput): Promise<ServiceConnection> {
    return this.createServiceConnection("chat_services", context, input);
  }

  async updateChatService(
    context: RequestContext,
    serviceId: string,
    patch: UpdateServiceConnectionPatch,
  ): Promise<ServiceConnection> {
    return this.updateServiceConnection("chat_services", context, serviceId, patch);
  }

  async deleteChatService(context: RequestContext, serviceId: string): Promise<void> {
    this.deleteServiceConnection("chat_services", context, serviceId);
  }

  async getChatSettings(context: RequestContext): Promise<ChatSettings | null> {
    const row = this.db
      .prepare("SELECT * FROM chat_settings WHERE tenant_id = ?")
      .get(context.tenantId) as ChatSettingsRow | undefined;
    return row ? mapChatSettingsRow(row) : null;
  }

  async setChatSettings(context: RequestContext, input: { serviceId: string; model: string }): Promise<ChatSettings> {
    this.db.prepare(`
      INSERT INTO chat_settings (tenant_id, service_id, model, updated_by, updated_at)
      VALUES (@tenantId, @serviceId, @model, @updatedBy, @updatedAt)
      ON CONFLICT(tenant_id) DO UPDATE SET
        service_id = excluded.service_id,
        model = excluded.model,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run({
      tenantId: context.tenantId,
      serviceId: input.serviceId,
      model: input.model,
      updatedBy: context.userId,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getChatSettings(context))!;
  }

  async clearChatSettings(context: RequestContext): Promise<void> {
    this.db.prepare("DELETE FROM chat_settings WHERE tenant_id = ?").run(context.tenantId);
  }

  private listServiceConnections(table: ServiceConnectionTable, context: RequestContext): ServiceConnection[] {
    const rows = this.db
      .prepare(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY display_name COLLATE NOCASE`)
      .all(context.tenantId) as ServiceConnectionRow[];
    return rows.map(mapServiceConnectionRow);
  }

  private getServiceConnection(table: ServiceConnectionTable, context: RequestContext, serviceId: string): ServiceConnection | null {
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`)
      .get(context.tenantId, serviceId) as ServiceConnectionRow | undefined;
    return row ? mapServiceConnectionRow(row) : null;
  }

  private createServiceConnection(
    table: ServiceConnectionTable,
    context: RequestContext,
    input: CreateServiceConnectionInput,
  ): ServiceConnection {
    const now = new Date().toISOString();
    let id = "";
    for (let attempt = 0; attempt < 5 && !id; attempt += 1) {
      const candidate = generateCollectionId(input.displayName);
      // "server" and "builtin" are reserved ids of the read-only entries the API lists.
      const taken = candidate === SERVER_EMBEDDING_SERVICE_ID || candidate === BUILTIN_EMBEDDING_SERVICE_ID
        || this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(candidate);
      if (!taken) id = candidate;
    }
    if (!id) throw new Error("Could not generate a unique service id.");

    this.db.prepare(`
      INSERT INTO ${table} (id, tenant_id, display_name, base_url, api_key, created_by, created_at, updated_at)
      VALUES (@id, @tenantId, @displayName, @baseUrl, @apiKey, @createdBy, @createdAt, @updatedAt)
    `).run({
      id,
      tenantId: context.tenantId,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey || null,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });
    return this.getServiceConnection(table, context, id)!;
  }

  private updateServiceConnection(
    table: ServiceConnectionTable,
    context: RequestContext,
    serviceId: string,
    patch: UpdateServiceConnectionPatch,
  ): ServiceConnection {
    const existing = this.getServiceConnection(table, context, serviceId);
    if (!existing) throw new Error(`Service ${serviceId} not found.`);
    const updates: string[] = [];
    const values: Record<string, unknown> = { tenantId: context.tenantId, id: serviceId };
    if (patch.displayName !== undefined) { updates.push("display_name = @displayName"); values.displayName = patch.displayName; }
    if (patch.baseUrl !== undefined) { updates.push("base_url = @baseUrl"); values.baseUrl = patch.baseUrl; }
    if (patch.apiKey !== undefined) { updates.push("api_key = @apiKey"); values.apiKey = patch.apiKey || null; }
    if (updates.length > 0) {
      // updated_at is part of the connection's cache key: a changed URL or key takes effect at once.
      updates.push("updated_at = @updatedAt");
      values.updatedAt = new Date().toISOString();
      this.db.prepare(`UPDATE ${table} SET ${updates.join(", ")} WHERE tenant_id = @tenantId AND id = @id`).run(values);
    }
    return this.getServiceConnection(table, context, serviceId)!;
  }

  private deleteServiceConnection(table: ServiceConnectionTable, context: RequestContext, serviceId: string): void {
    const result = this.db
      .prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND id = ?`)
      .run(context.tenantId, serviceId);
    if (result.changes !== 1) throw new Error(`Service ${serviceId} not found.`);
  }

  async listCollectionsUsingEmbeddingService(
    context: RequestContext,
    serviceId: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    if (serviceId === BUILTIN_EMBEDDING_SERVICE_ID) {
      // The built-in model: collections whose saved or active embedding is builtin.
      const builtinRows = this.db.prepare(`
        SELECT id, display_name FROM collections
        WHERE tenant_id = ? AND status != 'archived'
          AND (embedding_provider = 'builtin' OR active_embedding_provider = 'builtin')
        ORDER BY display_name COLLATE NOCASE
      `).all(context.tenantId) as Array<{ id: string; display_name: string }>;
      return builtinRows.map((row) => ({ id: row.id, displayName: row.display_name }));
    }
    const isServer = serviceId === SERVER_EMBEDDING_SERVICE_ID;
    const rows = this.db.prepare(`
      SELECT id, display_name FROM collections
      WHERE tenant_id = @tenantId AND status != 'archived' AND (
        (embedding_provider = 'openai-compatible' AND (embedding_service_id = @serviceId OR (@isServer = 1 AND embedding_service_id IS NULL)))
        OR (active_embedding_provider = 'openai-compatible'
            AND (active_embedding_service_id = @serviceId OR (@isServer = 1 AND active_embedding_service_id IS NULL)))
      )
      ORDER BY display_name COLLATE NOCASE
    `).all({ tenantId: context.tenantId, serviceId, isServer: isServer ? 1 : 0 }) as Array<{ id: string; display_name: string }>;
    return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
  }

  async markDocumentsChanged(context: RequestContext, collectionId: string): Promise<void> {
    this.db.prepare(`
      UPDATE collections
      SET documents_changed = 1, updated_at = @updatedAt
      WHERE tenant_id = @tenantId AND id = @collectionId AND status != 'archived'
    `).run({ tenantId: context.tenantId, collectionId, updatedAt: new Date().toISOString() });
  }

  async countAllCollections(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM collections").get() as { count: number };
    return row.count;
  }

  async getVisibleCollection(context: RequestContext, collectionId: string): Promise<RagCollection | null> {
    const row = this.db
      .prepare("SELECT * FROM collections WHERE tenant_id = ? AND id = ? AND status != 'archived'")
      .get(context.tenantId, collectionId) as CollectionRow | undefined;

    return row ? mapCollectionRow(row) : null;
  }

  async listPhysicalCollectionsForCollection(
    context: RequestContext,
    collectionId: string,
  ): Promise<PhysicalCollectionRecord[]> {
    const rows = this.db.prepare(`
      SELECT * FROM physical_collections
      WHERE tenant_id = ? AND collection_id = ?
      ORDER BY created_at DESC, name DESC
    `).all(context.tenantId, collectionId) as PhysicalCollectionRow[];

    return rows.map(mapPhysicalCollectionRow);
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

  async appendOperationalLog(event: OperationalLogEvent): Promise<void> {
    try {
      this.db.prepare(`
        INSERT INTO operational_logs (
          timestamp,
          tenant_id,
          request_id,
          user_id,
          collection_id,
          physical_collection,
          job_id,
          operation,
          status,
          latency_ms,
          error_code,
          message,
          details_json
        ) VALUES (
          @timestamp,
          @tenantId,
          @requestId,
          @userId,
          @collectionId,
          @physicalCollection,
          @jobId,
          @operation,
          @status,
          @latencyMs,
          @errorCode,
          @message,
          @detailsJson
        )
      `).run({
        timestamp: event.timestamp ?? new Date().toISOString(),
        tenantId: event.tenantId ?? "default",
        requestId: event.requestId ?? null,
        userId: event.userId ?? null,
        collectionId: event.collectionId ?? null,
        physicalCollection: event.physicalCollection ?? null,
        jobId: event.jobId ?? null,
        operation: event.operation,
        status: event.status,
        latencyMs: Number.isFinite(event.latencyMs) ? Math.trunc(event.latencyMs ?? 0) : null,
        errorCode: event.errorCode ?? null,
        message: event.message ?? null,
        detailsJson: event.details ? JSON.stringify(event.details) : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to persist operational log event: ${message}`);
    }
  }

  async listAuditOperations(context: RequestContext): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT DISTINCT operation FROM operational_logs WHERE tenant_id = @tenantId ORDER BY operation")
      .all({ tenantId: context.tenantId }) as Array<{ operation: string }>;
    return rows.map((row) => row.operation);
  }

  async listAuditLog(context: RequestContext, filters: ListAuditLogInput = {}): Promise<ListAuditLogResult> {
    const limit = clampInteger(filters.limit ?? 50, 1, 100);
    const where: string[] = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = {
      tenantId: context.tenantId,
      limit: limit + 1,
    };

    if (filters.collectionId && filters.collectionId.length > 0) {
      const collectionIds = [...new Set(filters.collectionId.filter((collectionId) => collectionId.trim() !== ""))];
      if (collectionIds.length > 0) {
        const placeholders = collectionIds.map((_, index) => `@collectionId${index}`);
        where.push(`collection_id IN (${placeholders.join(", ")})`);
        collectionIds.forEach((collectionId, index) => {
          params[`collectionId${index}`] = collectionId;
        });
      }
    }

    if (filters.operation) {
      const operations = [...new Set(filters.operation.filter((operation) => operation.trim() !== ""))];
      if (operations.length > 0) {
        const placeholders = operations.map((_, index) => `@operation${index}`);
        where.push(`operation IN (${placeholders.join(", ")})`);
        operations.forEach((operation, index) => {
          params[`operation${index}`] = operation;
        });
      }
    }

    if (filters.cursor) {
      const cursor = decodeOperationalLogCursor(filters.cursor);
      where.push("id < @cursorId");
      params.cursorId = cursor.id;
    }

    const rows = this.db
      .prepare(`
        SELECT *
        FROM operational_logs
        WHERE ${where.join(" AND ")}
        ORDER BY id DESC
        LIMIT @limit
      `)
      .all(params) as OperationalLogRow[];

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      auditLog: pageRows.map(mapOperationalLogRow),
      nextCursor: hasNextPage ? encodeOperationalLogCursor(pageRows[pageRows.length - 1]!) : null,
    };
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
    const sourceKind = input.sourceKind ?? "folder";
    // Uploads collections get their own folder under the uploads root, named after the collection id.
    const sourcePath = sourceKind === "uploads" ? path.join(input.sourcePath, id) : input.sourcePath;
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
        source_kind,
        source_path,
        embedding_provider,
        embedding_model,
        embedding_service_id,
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
        @sourceKind,
        @sourcePath,
        @embeddingProvider,
        @embeddingModel,
        @embeddingServiceId,
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
      sourceKind,
      sourcePath: this.storedSourcePath(sourcePath),
      embeddingProvider: input.embeddingProvider ?? "builtin",
      embeddingModel: input.embeddingModel,
      embeddingServiceId: input.embeddingProvider === "openai-compatible" ? input.embeddingServiceId ?? null : null,
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
    addPatch(
      "sourcePath",
      "source_path",
      patch.sourcePath === undefined ? undefined : this.storedSourcePath(patch.sourcePath),
      updates,
      values,
    );
    addPatch("embeddingProvider", "embedding_provider", patch.embeddingProvider, updates, values);
    addPatch("embeddingModel", "embedding_model", patch.embeddingModel, updates, values);
    addNullablePatch("embeddingServiceId", "embedding_service_id", patch.embeddingServiceId, updates, values);
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
      "activeEmbeddingProvider",
      "active_embedding_provider",
      patch.activeEmbeddingProvider,
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
      "activeEmbeddingServiceId",
      "active_embedding_service_id",
      patch.activeEmbeddingServiceId,
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
        targetEmbeddingProvider: collection.embedding_provider,
        targetEmbeddingModel: collection.embedding_model,
        targetEmbeddingServiceId: normalizeEmbeddingServiceId(collection.embedding_provider, collection.embedding_service_id) ?? undefined,
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
          target_embedding_provider,
          target_embedding_model,
          target_embedding_service_id,
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
          @targetEmbeddingProvider,
          @targetEmbeddingModel,
          @targetEmbeddingServiceId,
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
        targetEmbeddingProvider: job.targetEmbeddingProvider,
        targetEmbeddingModel: job.targetEmbeddingModel,
        targetEmbeddingServiceId: job.targetEmbeddingServiceId ?? null,
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
          active_embedding_provider = @activeEmbeddingProvider,
          active_embedding_model = @activeEmbeddingModel,
          active_embedding_service_id = @activeEmbeddingServiceId,
          document_count = @documentCount,
          chunk_count = @chunkCount,
          last_indexed_at = @lastIndexedAt,
          indexed_snapshot_json = @indexedSnapshotJson,
          documents_changed = 0,
          updated_at = @updatedAt
        WHERE tenant_id = @tenantId AND id = @collectionId AND status != 'archived'
      `).run({
        tenantId: existing.tenant_id,
        collectionId: existing.collection_id,
        activePhysicalCollection,
        activeVersion,
        // The active embedding is what this job built with, not what the collection wants now.
        activeEmbeddingProvider: existing.target_embedding_provider,
        activeEmbeddingModel: existing.target_embedding_model,
        activeEmbeddingServiceId: existing.target_embedding_service_id ?? null,
        documentCount: result.documentCount ?? existing.document_count,
        chunkCount: result.chunkCount ?? existing.chunk_count,
        lastIndexedAt: now,
        indexedSnapshotJson: JSON.stringify(buildCollectionIndexSnapshot({
          sourcePath: collection.source_path,
          distanceMetric: collection.distance_metric,
          chunkSize: collection.chunk_size,
          chunkOverlap: collection.chunk_overlap,
          // Same source as the active embedding above, so the snapshot matches the index that was built.
          embeddingProvider: existing.target_embedding_provider,
          embeddingModel: existing.target_embedding_model,
          embeddingServiceId: existing.target_embedding_service_id,
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

  async recordIndexJobHeartbeat(jobId: string): Promise<void> {
    // Not updated_at: job lists are ordered and paged by it.
    this.db.prepare(`
      UPDATE index_jobs SET heartbeat_at = ? WHERE id = ? AND status IN ('queued', 'running')
    `).run(new Date().toISOString(), jobId);
  }

  async failStaleJobs(staleThresholdMs: number): Promise<number> {
    const thresholdDate = new Date(Date.now() - staleThresholdMs).toISOString();
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      const staleJobs = this.db.prepare(`
        SELECT * FROM index_jobs
        WHERE status IN ('queued', 'running') AND COALESCE(heartbeat_at, updated_at) < ?
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
          error: STALE_JOB_ERROR,
          updatedAt: now,
          finishedAt: now,
        });

        this.insertJobEvent({
          ...job,
          status: "failed",
          finished_at: now,
          updated_at: now,
          error: STALE_JOB_ERROR,
        }, {
          status: "failed",
          stage: "failed",
          code: "JOB_FAILED",
          level: "error",
          message: STALE_JOB_ERROR,
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
          error: STALE_JOB_ERROR,
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
    sourceKind: row.source_kind === "uploads" ? "uploads" : "folder",
    sourcePath: row.source_path,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    distanceMetric: row.distance_metric,
    chromaCollectionConfiguration: JSON.parse(row.chroma_collection_configuration_json) as Record<string, unknown>,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    retrievalK: row.retrieval_k,
    retrievalDistanceThreshold: row.retrieval_distance_threshold,
    activeEmbeddingProvider: row.active_embedding_provider ?? undefined,
    activeEmbeddingModel: row.active_embedding_model ?? undefined,
    embeddingServiceId: row.embedding_service_id ?? undefined,
    activeEmbeddingServiceId: row.active_embedding_service_id ?? undefined,
    documentCount: row.document_count ?? undefined,
    chunkCount: row.chunk_count ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastIndexedAt: row.last_indexed_at ?? undefined,
    documentsChanged: row.documents_changed === 1,
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

function mapServiceConnectionRow(row: ServiceConnectionRow): ServiceConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    apiKey: row.api_key ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChatSettingsRow(row: ChatSettingsRow): ChatSettings {
  return {
    tenantId: row.tenant_id,
    serviceId: row.service_id,
    model: row.model,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapIndexJobRow(row: IndexJobRow): IndexJob {
  return {
    id: row.id,
    collectionId: row.collection_id,
    tenantId: row.tenant_id,
    status: row.status,
    targetPhysicalCollection: row.target_physical_collection,
    targetVersion: row.target_version,
    targetEmbeddingProvider: row.target_embedding_provider,
    targetEmbeddingModel: row.target_embedding_model,
    targetEmbeddingServiceId: row.target_embedding_service_id ?? undefined,
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

function mapOperationalLogRow(row: OperationalLogRow): AuditLogRecord {
  return {
    timestamp: row.timestamp,
    collectionId: row.collection_id ?? undefined,
    operation: row.operation,
    status: row.status as AuditLogRecord["status"],
    requestId: row.request_id ?? undefined,
    userId: row.user_id ?? undefined,
    jobId: row.job_id ?? undefined,
    physicalCollection: row.physical_collection ?? undefined,
    errorCode: row.error_code ?? undefined,
    message: row.message ?? undefined,
    details: parseJsonRecord(row.details_json) ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
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

function encodeOperationalLogCursor(row: OperationalLogRow): string {
  return Buffer.from(JSON.stringify({
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

function decodeOperationalLogCursor(cursor: string): { id: number } {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (typeof parsed.id !== "number" || !Number.isFinite(parsed.id) || parsed.id <= 0) {
      throw new Error("Invalid audit log cursor.");
    }

    return {
      id: parsed.id,
    };
  } catch {
    throw new Error("Invalid audit log cursor.");
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



