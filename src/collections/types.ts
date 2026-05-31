import type { DistanceMetric } from "../config.js";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  userId: string;
};

export type CollectionStatus = "creating" | "indexing" | "ready" | "failed" | "archived";
export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

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

export type UpdateCollectionPatch = Partial<Pick<
  RagCollection,
  | "displayName"
  | "description"
  | "status"
  | "sourcePath"
  | "ozelgeDataPath"
  | "embeddingModel"
  | "chatModel"
  | "distanceMetric"
  | "chromaCollectionConfiguration"
  | "chunkSize"
  | "chunkOverlap"
  | "retrievalK"
  | "retrievalDistanceThreshold"
  | "activePhysicalCollection"
  | "activeVersion"
  | "documentCount"
  | "chunkCount"
  | "lastIndexedAt"
>>;

export type BeginIndexJobInput = {
  targetPhysicalCollection?: string;
  targetChromaConfiguration?: Record<string, unknown>;
  lockToken?: string;
};

export type CompleteIndexJobResult = {
  documentCount?: number;
  chunkCount?: number;
  activePhysicalCollection?: string;
  activeVersion?: string;
};

export interface CollectionRegistry {
  listVisibleCollections(context: RequestContext): Promise<RagCollection[]>;
  getVisibleCollection(context: RequestContext, collectionId: string): Promise<RagCollection | null>;
  getJob(jobId: string): Promise<IndexJob | null>;
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
  completeIndexJob(jobId: string, result: CompleteIndexJobResult): Promise<IndexJob>;
  failIndexJob(jobId: string, error: string): Promise<IndexJob>;
  close?(): void;
}
