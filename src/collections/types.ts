import type { DistanceMetric } from "../config.js";

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
  ozelgeDataPath: string;
  distanceMetric: DistanceMetric;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
};

export type CollectionIndexState = {
  status: "no_active_index" | "synced" | "reindex_required";
  reindexRequired: boolean;
  activeSnapshot: CollectionIndexSnapshot | null;
  desiredSnapshot: CollectionIndexSnapshot;
  changedFields: Array<keyof CollectionIndexSnapshot>;
  note: string;
};

export type RagCollection = {
  id: string;
  tenantId: string;
  displayName: string;
  description?: string;
  status: CollectionStatus;
  activePhysicalCollection?: string;
  activeVersion?: string;
  sourcePath: string;
  ozelgeDataPath: string;
  embeddingModel: string;
  chatModel: string;
  distanceMetric: DistanceMetric;
  chromaCollectionConfiguration: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  retrievalK: number;
  retrievalDistanceThreshold: number;
  activeEmbeddingModel?: string;
  documentCount?: number;
  chunkCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastIndexedAt?: string;
  indexState?: CollectionIndexState;
};

export type IndexJob = {
  id: string;
  collectionId: string;
  tenantId: string;
  status: IndexJobStatus;
  targetPhysicalCollection: string;
  targetVersion: string;
  targetEmbeddingModel: string;
  targetChromaConfiguration: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
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
  sourcePath: string;
  ozelgeDataPath: string;
  embeddingModel: string;
  chatModel: string;
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
  ozelgeDataPath?: RagCollection["ozelgeDataPath"];
  embeddingModel?: RagCollection["embeddingModel"];
  chatModel?: RagCollection["chatModel"];
  distanceMetric?: RagCollection["distanceMetric"];
  chromaCollectionConfiguration?: RagCollection["chromaCollectionConfiguration"];
  chunkSize?: RagCollection["chunkSize"];
  chunkOverlap?: RagCollection["chunkOverlap"];
  retrievalK?: RagCollection["retrievalK"];
  retrievalDistanceThreshold?: RagCollection["retrievalDistanceThreshold"];
  activeEmbeddingModel?: RagCollection["activeEmbeddingModel"] | null;
  activePhysicalCollection?: RagCollection["activePhysicalCollection"] | null;
  activeVersion?: RagCollection["activeVersion"] | null;
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
  documentCount?: number;
  chunkCount?: number;
  createdAt: string;
  activatedAt?: string;
  retiredAt?: string;
  deleteAfter?: string;
  deletedAt?: string;
  cleanupError?: string;
};

export interface CollectionRegistry {
  listVisibleCollections(context: RequestContext): Promise<RagCollection[]>;
  getVisibleCollection(context: RequestContext, collectionId: string): Promise<RagCollection | null>;
  listJobs(context: RequestContext, filters?: ListJobsInput): Promise<ListJobsResult>;
  getSystemOperationsSummary(nowIso: string): Promise<SystemOperationsAggregateSummary>;
  getJob(jobId: string): Promise<IndexJob | null>;
  listJobEvents(context: RequestContext, jobId: string): Promise<IndexJobEvent[]>;
  appendJobEvent(jobId: string, input: CreateIndexJobEventInput): Promise<IndexJobEvent>;
  deleteJob(context: RequestContext, jobId: string): Promise<void>;
  deleteJobs(context: RequestContext, jobIds: string[]): Promise<void>;
  getActiveJobForCollection(context: RequestContext, collectionId: string): Promise<IndexJob | null>;
  createCollection(context: RequestContext, input: CreateCollectionInput): Promise<RagCollection>;
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
