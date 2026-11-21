import type { DistanceMetric } from "../config.js";
import type { EmbeddingProvider } from "../embeddings/models.js";
import type { OperationalLogEvent, OperationalLogStatus } from "../observability/logger.js";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  userId: string;
};

export type CollectionStatus = "creating" | "indexing" | "ready" | "failed" | "archived";
export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type PhysicalCollectionStatus = "building" | "failed_build" | "active" | "retired" | "delete_pending" | "deleted" | "cleanup_failed";
export type IndexJobEventLevel = "info" | "error";
export type IndexJobEventStage =
  | "queued"
  | "running"
  | "preparing_target"
  | "loading_source"
  | "chunking"
  | "indexing"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled";
export type IndexJobEventCode =
  | "JOB_QUEUED"
  | "JOB_RUNNING"
  | "TARGET_RECORD_CREATED"
  | "PHYSICAL_COLLECTION_CREATING"
  | "SOURCE_ANALYSIS_STARTED"
  | "SOURCE_ANALYSIS_COMPLETED"
  | "CHUNKING_STARTED"
  | "CHUNKING_COMPLETED"
  | "VECTOR_INDEXING_STARTED"
  | "CHUNKS_WRITTEN"
  | "VECTOR_INDEXING_COMPLETED"
  | "READABILITY_CHECK_STARTED"
  | "READABILITY_CHECK_COMPLETED"
  | "JOB_SUCCEEDED"
  | "JOB_FAILED"
  | "JOB_CANCELLED";
export type IndexJobEventProgressUnit = "files" | "documents" | "chunks";

export type IndexJobEventProgress = {
  phase: number;
  phaseCount: number;
  itemsCompleted?: number;
  itemsTotal?: number;
  unit?: IndexJobEventProgressUnit;
};

export type CollectionIndexSnapshot = {
  sourcePath: string;
  distanceMetric: DistanceMetric;
  chunkSize: number;
  chunkOverlap: number;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  /** Normalized: null for builtin, the service id (or "server") for openai-compatible. */
  embeddingServiceId: string | null;
};

export type CollectionIndexState = {
  status: "no_active_index" | "synced" | "reindex_required";
  reindexRequired: boolean;
  activeSnapshot: CollectionIndexSnapshot | null;
  desiredSnapshot: CollectionIndexSnapshot;
  changedFields: Array<keyof CollectionIndexSnapshot>;
  /** Documents were uploaded (added or replaced) through the API since the last successful index; deletes apply to the index at once. */
  documentsChanged: boolean;
  note: string;
};

/**
 * Where a collection's documents come from:
 * - "uploads": its own folder (`data/collections/<id>`), managed through the files API.
 * - "folder": a folder on the server chosen by path; the API only lists its files.
 */
export type CollectionSourceKind = "uploads" | "folder";

export type RagCollection = {
  id: string;
  tenantId: string;
  displayName: string;
  description?: string;
  status: CollectionStatus;
  activePhysicalCollection?: string;
  activeVersion?: string;
  sourceKind: CollectionSourceKind;
  sourcePath: string;
  /** Embedding for the next re-index (desired). Reads always use the active pair below. */
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  /**
   * Embedding service of an openai-compatible collection (desired): a service from the embedding services
   * API, or "server" (the service configured in .env / config). Unset on older collections, meaning "server".
   */
  embeddingServiceId?: string;
  distanceMetric: DistanceMetric;
  chromaCollectionConfiguration: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  retrievalK: number;
  retrievalDistanceThreshold: number;
  /** Embedding the active index was built with; queries must use it. */
  activeEmbeddingProvider?: EmbeddingProvider;
  activeEmbeddingModel?: string;
  activeEmbeddingServiceId?: string;
  /** Files with indexable content in the index (documentCount counts loaded parts: a PDF gives one per page). */
  indexedFileCount?: number;
  documentCount?: number;
  chunkCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastIndexedAt?: string;
  /** Documents were uploaded (added or replaced) through the API since the last successful index; deletes apply to the index at once. */
  documentsChanged: boolean;
  indexState?: CollectionIndexState;
};

export type IndexJob = {
  id: string;
  collectionId: string;
  tenantId: string;
  status: IndexJobStatus;
  targetPhysicalCollection: string;
  targetVersion: string;
  targetEmbeddingProvider: EmbeddingProvider;
  targetEmbeddingModel: string;
  targetEmbeddingServiceId?: string;
  targetChromaConfiguration: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Files with indexable content in the index (documentCount counts loaded parts: a PDF gives one per page). */
  indexedFileCount?: number;
  documentCount?: number;
  chunkCount?: number;
  lockToken: string;
  createdAt: string;
  updatedAt: string;
};

export type IndexJobEvent = {
  id: string;
  jobId: string;
  tenantId: string;
  collectionId: string;
  sequence: number;
  status: IndexJobStatus;
  stage: IndexJobEventStage;
  code: IndexJobEventCode;
  level: IndexJobEventLevel;
  message: string;
  details?: Record<string, unknown>;
  progress?: IndexJobEventProgress;
  createdAt: string;
};

export type CreateIndexJobEventInput = {
  status: IndexJobStatus;
  stage: IndexJobEventStage;
  code: IndexJobEventCode;
  message: string;
  level?: IndexJobEventLevel;
  details?: Record<string, unknown>;
  progress?: IndexJobEventProgress;
  createdAt?: string;
};

export type IndexJobCollectionSnapshot = Pick<RagCollection, "id" | "displayName" | "status">;

export type IndexJobListItem = {
  job: IndexJob;
  collection: IndexJobCollectionSnapshot | null;
};

export type ListJobsInput = {
  collectionId?: string;
  statuses?: IndexJobStatus[];
  limit?: number;
  cursor?: string | null;
};

export type ListJobsResult = {
  jobs: IndexJobListItem[];
  nextCursor: string | null;
};

export type SystemOperationsAggregateSummary = {
  observedAt: string;
  collections: {
    total: number;
    creating: number;
    indexing: number;
    ready: number;
    failed: number;
    archived: number;
  };
  jobs: {
    total: number;
    active: number;
    queued: number;
    running: number;
    terminal: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    oldestActiveUpdatedAt: string | null;
    oldestActiveAgeSec: number | null;
    newestFailureAt: string | null;
  };
  physicalCollections: {
    total: number;
    building: number;
    active: number;
    failedBuild: number;
    deletePending: number;
    cleanupFailed: number;
    deleted: number;
    cleanupBacklog: number;
    oldestDueDeleteAt: string | null;
  };
};

export type CreateCollectionInput = {
  displayName: string;
  description?: string;
  /** Defaults to "folder". */
  sourceKind?: CollectionSourceKind;
  /**
   * For "folder": the folder to index. For "uploads": the uploads root (e.g. `data/collections`);
   * the registry stores `<uploads root>/<collection id>` once the id is generated.
   */
  sourcePath: string;
  /** Defaults to "builtin" when omitted (the HTTP API always fills it from the configured default). */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel: string;
  embeddingServiceId?: string;
  distanceMetric: DistanceMetric;
  chromaCollectionConfiguration?: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  retrievalK: number;
  retrievalDistanceThreshold: number;
};

export type UpdateCollectionPatch = {
  displayName?: RagCollection["displayName"];
  description?: RagCollection["description"] | null;
  status?: RagCollection["status"];
  sourcePath?: RagCollection["sourcePath"];
  embeddingProvider?: RagCollection["embeddingProvider"];
  embeddingModel?: RagCollection["embeddingModel"];
  embeddingServiceId?: RagCollection["embeddingServiceId"] | null;
  distanceMetric?: RagCollection["distanceMetric"];
  chromaCollectionConfiguration?: RagCollection["chromaCollectionConfiguration"];
  chunkSize?: RagCollection["chunkSize"];
  chunkOverlap?: RagCollection["chunkOverlap"];
  retrievalK?: RagCollection["retrievalK"];
  retrievalDistanceThreshold?: RagCollection["retrievalDistanceThreshold"];
  activeEmbeddingProvider?: RagCollection["activeEmbeddingProvider"] | null;
  activeEmbeddingModel?: RagCollection["activeEmbeddingModel"] | null;
  activeEmbeddingServiceId?: RagCollection["activeEmbeddingServiceId"] | null;
  activePhysicalCollection?: RagCollection["activePhysicalCollection"] | null;
  activeVersion?: RagCollection["activeVersion"] | null;
  indexedFileCount?: RagCollection["indexedFileCount"] | null;
  documentCount?: RagCollection["documentCount"] | null;
  chunkCount?: RagCollection["chunkCount"] | null;
  lastIndexedAt?: RagCollection["lastIndexedAt"] | null;
};

export type BeginIndexJobInput = {
  targetPhysicalCollection?: string;
  targetVersion?: string;
  targetChromaConfiguration?: Record<string, unknown>;
  lockToken?: string;
};

export type CompleteIndexJobResult = {
  /** Files with indexable content in the index (documentCount counts loaded parts: a PDF gives one per page). */
  indexedFileCount?: number;
  documentCount?: number;
  chunkCount?: number;
  activePhysicalCollection?: string;
  activeVersion?: string;
  retentionMs: number;
};

export type PhysicalCollectionRecord = {
  name: string;
  tenantId: string;
  collectionId: string;
  version: string;
  status: PhysicalCollectionStatus;
  chromaConfiguration: Record<string, unknown>;
  /** Files with indexable content in the index (documentCount counts loaded parts: a PDF gives one per page). */
  indexedFileCount?: number;
  documentCount?: number;
  chunkCount?: number;
  createdAt: string;
  activatedAt?: string;
  retiredAt?: string;
  deleteAfter?: string;
  deletedAt?: string;
  cleanupError?: string;
};

export type AuditLogRecord = {
  timestamp: string;
  collectionId?: string;
  operation: string;
  status: OperationalLogStatus;
  requestId?: string;
  userId?: string;
  jobId?: string;
  physicalCollection?: string;
  errorCode?: string;
  message?: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
};

export type ListAuditLogInput = {
  collectionId?: string[];
  operation?: string[];
  limit?: number;
  cursor?: string | null;
};

export type ListAuditLogResult = {
  auditLog: AuditLogRecord[];
  nextCursor: string | null;
};

/**
 * A tenant's connection to an OpenAI-compatible API (embedding or chat), managed through the
 * embedding services / chat services API.
 */
export type ServiceConnection = {
  id: string;
  tenantId: string;
  displayName: string;
  baseUrl: string;
  /** Stored as plain text in the registry; never returned by the API. */
  apiKey?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateServiceConnectionInput = { displayName: string; baseUrl: string; apiKey?: string };
export type UpdateServiceConnectionPatch = { displayName?: string; baseUrl?: string; apiKey?: string | null };

export type EmbeddingService = ServiceConnection;
export type CreateEmbeddingServiceInput = CreateServiceConnectionInput;
export type UpdateEmbeddingServicePatch = UpdateServiceConnectionPatch;

export type ChatService = ServiceConnection;
export type CreateChatServiceInput = CreateServiceConnectionInput;
export type UpdateChatServicePatch = UpdateServiceConnectionPatch;

/** A tenant's choice of chat service and model for answer generation (/query). */
export type ChatSettings = {
  tenantId: string;
  /** "server" (the chat LLM from .env / config) or a chat service id. */
  serviceId: string;
  model: string;
  updatedBy: string;
  updatedAt: string;
};

export interface CollectionRegistry {
  listVisibleCollections(context: RequestContext): Promise<RagCollection[]>;
  /** Every collection ever created, across tenants and including archived (deleted) ones. */
  countAllCollections(): Promise<number>;
  getVisibleCollection(context: RequestContext, collectionId: string): Promise<RagCollection | null>;
  listPhysicalCollectionsForCollection(
    context: RequestContext,
    collectionId: string,
  ): Promise<PhysicalCollectionRecord[]>;
  listJobs(context: RequestContext, filters?: ListJobsInput): Promise<ListJobsResult>;
  getSystemOperationsSummary(nowIso: string): Promise<SystemOperationsAggregateSummary>;
  getJob(jobId: string): Promise<IndexJob | null>;
  listJobEvents(context: RequestContext, jobId: string): Promise<IndexJobEvent[]>;
  appendJobEvent(jobId: string, input: CreateIndexJobEventInput): Promise<IndexJobEvent>;
  appendOperationalLog?(event: OperationalLogEvent): Promise<void>;
  listAuditLog?(context: RequestContext, filters?: ListAuditLogInput): Promise<ListAuditLogResult>;
  /** The distinct operation names in the tenant's audit log, for filters. */
  listAuditOperations?(context: RequestContext): Promise<string[]>;
  deleteJob(context: RequestContext, jobId: string): Promise<void>;
  deleteJobs(context: RequestContext, jobIds: string[]): Promise<void>;
  getActiveJobForCollection(context: RequestContext, collectionId: string): Promise<IndexJob | null>;
  createCollection(context: RequestContext, input: CreateCollectionInput): Promise<RagCollection>;
  listEmbeddingServices(context: RequestContext): Promise<EmbeddingService[]>;
  getEmbeddingService(context: RequestContext, serviceId: string): Promise<EmbeddingService | null>;
  createEmbeddingService(context: RequestContext, input: CreateEmbeddingServiceInput): Promise<EmbeddingService>;
  updateEmbeddingService(context: RequestContext, serviceId: string, patch: UpdateEmbeddingServicePatch): Promise<EmbeddingService>;
  /** Deletes a service; throws when it does not exist. Callers check that no collection uses it. */
  deleteEmbeddingService(context: RequestContext, serviceId: string): Promise<void>;
  /** Visible collections whose desired or active embedding uses the service ("server" includes unset ones; "builtin" = the built-in model). */
  listCollectionsUsingEmbeddingService(context: RequestContext, serviceId: string): Promise<Array<{ id: string; displayName: string }>>;
  listChatServices(context: RequestContext): Promise<ChatService[]>;
  getChatService(context: RequestContext, serviceId: string): Promise<ChatService | null>;
  createChatService(context: RequestContext, input: CreateChatServiceInput): Promise<ChatService>;
  updateChatService(context: RequestContext, serviceId: string, patch: UpdateChatServicePatch): Promise<ChatService>;
  /** Deletes a service; throws when it does not exist. Callers check that the tenant's chat settings do not use it. */
  deleteChatService(context: RequestContext, serviceId: string): Promise<void>;
  /** The tenant's chat choice, or null when it follows the server's chat LLM (.env / config). */
  getChatSettings(context: RequestContext): Promise<ChatSettings | null>;
  setChatSettings(context: RequestContext, input: { serviceId: string; model: string }): Promise<ChatSettings>;
  clearChatSettings(context: RequestContext): Promise<void>;
  /** Records that documents were uploaded; cleared when the next index job succeeds. */
  markDocumentsChanged(context: RequestContext, collectionId: string): Promise<void>;
  updateCollection(
    context: RequestContext,
    collectionId: string,
    patch: UpdateCollectionPatch,
  ): Promise<RagCollection>;
  beginIndexJob(
    context: RequestContext,
    collectionId: string,
    input?: BeginIndexJobInput,
  ): Promise<IndexJob>;
  markIndexJobRunning(jobId: string, input?: { lockToken?: string }): Promise<IndexJob>;
  cancelIndexJob(jobId: string): Promise<IndexJob>;
  completeIndexJob(jobId: string, result: CompleteIndexJobResult): Promise<IndexJob>;
  failIndexJob(jobId: string, error: string): Promise<IndexJob>;
  /** A running job's "still alive" mark (every JOB_HEARTBEAT_INTERVAL_MS); no-op once the job has finished. */
  recordIndexJobHeartbeat(jobId: string): Promise<void>;
  /**
   * Fails queued/running jobs with no heartbeat (or, for older rows, no update) for staleThresholdMs:
   * their process stopped or crashed. The collection goes back to its active index.
   */
  failStaleJobs(staleThresholdMs: number): Promise<number>;
  getPhysicalCollection(name: string): Promise<PhysicalCollectionRecord | null>;
  
  createPhysicalCollectionRecord(input: {
    name: string;
    tenantId: string;
    collectionId: string;
    version: string;
    chromaConfiguration: Record<string, unknown>;
  }): Promise<PhysicalCollectionRecord>;
  markPhysicalCollectionDeleted(name: string): Promise<void>;
  markPhysicalCollectionCleanupFailed(name: string, error: string): Promise<void>;
  listDuePhysicalCollectionsForCleanup(nowIso: string, limit: number): Promise<PhysicalCollectionRecord[]>;
  deleteCollection(context: RequestContext, collectionId: string): Promise<string[]>;
  collectionExists(collectionId: string): Promise<boolean>;

  close?(): void;
}
