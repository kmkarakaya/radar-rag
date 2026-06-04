import type { DistanceMetric } from "../config.js";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  userId: string;
};

export type CollectionStatus = "creating" | "indexing" | "ready" | "failed" | "archived";
export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type PhysicalCollectionStatus = "building" | "failed_build" | "active" | "retired" | "delete_pending" | "deleted" | "cleanup_failed";

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
  documentCount?: number;
  chunkCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastIndexedAt?: string;
};

export type IndexJob = {
  id: string;
  collectionId: string;
  tenantId: string;
  status: IndexJobStatus;
  targetPhysicalCollection: string;
  targetVersion: string;
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
  getJob(jobId: string): Promise<IndexJob | null>;
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
  collectionExists(collectionId: string): Promise<boolean>;

  close?(): void;
}
