import type { DistanceMetric } from "../config.js";
import { isEmbeddingProvider, SERVER_EMBEDDING_SERVICE_ID, type EmbeddingProvider } from "../embeddings/models.js";

export { SERVER_EMBEDDING_SERVICE_ID };
import type { CollectionIndexSnapshot, CollectionIndexState, RagCollection } from "./types.js";

const INDEX_SNAPSHOT_FIELDS = [
  "sourcePath",
  "distanceMetric",
  "chunkSize",
  "chunkOverlap",
  "embeddingProvider",
  "embeddingModel",
  "embeddingServiceId",
] as const satisfies Array<keyof CollectionIndexSnapshot>;

/**
 * One value per embedding connection, so old records (no service id) compare equal to new ones:
 * builtin has no service; an openai-compatible collection without a service id uses "server".
 */
export function normalizeEmbeddingServiceId(provider: EmbeddingProvider, serviceId: string | null | undefined): string | null {
  if (provider !== "openai-compatible") return null;
  return serviceId || SERVER_EMBEDDING_SERVICE_ID;
}

export function buildCollectionIndexSnapshot(collection: Pick<
  RagCollection,
  "sourcePath" | "distanceMetric" | "chunkSize" | "chunkOverlap" | "embeddingProvider" | "embeddingModel"
> & { embeddingServiceId?: string | null }): CollectionIndexSnapshot {
  return {
    sourcePath: collection.sourcePath,
    distanceMetric: collection.distanceMetric,
    chunkSize: collection.chunkSize,
    chunkOverlap: collection.chunkOverlap,
    embeddingProvider: collection.embeddingProvider,
    embeddingModel: collection.embeddingModel,
    embeddingServiceId: normalizeEmbeddingServiceId(collection.embeddingProvider, collection.embeddingServiceId),
  };
}

export function parseCollectionIndexSnapshot(input: unknown): CollectionIndexSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Partial<Record<keyof CollectionIndexSnapshot, unknown>>;

  if (
    typeof value.sourcePath !== "string"
    || !isDistanceMetric(value.distanceMetric)
    || typeof value.chunkSize !== "number"
    || typeof value.chunkOverlap !== "number"
    || !isEmbeddingProvider(value.embeddingProvider)
    || typeof value.embeddingModel !== "string"
  ) {
    return null;
  }

  return {
    sourcePath: value.sourcePath,
    distanceMetric: value.distanceMetric,
    chunkSize: value.chunkSize,
    chunkOverlap: value.chunkOverlap,
    embeddingProvider: value.embeddingProvider,
    embeddingModel: value.embeddingModel,
    // Snapshots written before embedding services have no service id: derive it like new ones.
    embeddingServiceId: normalizeEmbeddingServiceId(
      value.embeddingProvider,
      typeof value.embeddingServiceId === "string" ? value.embeddingServiceId : null,
    ),
  };
}

export function buildCollectionIndexState(
  collection: Pick<
    RagCollection,
    "sourcePath" | "distanceMetric" | "chunkSize" | "chunkOverlap" | "embeddingProvider" | "embeddingModel" | "activePhysicalCollection"
  > & { documentsChanged?: boolean; embeddingServiceId?: string | null },
  activeSnapshot: CollectionIndexSnapshot | null,
): CollectionIndexState {
  const desiredSnapshot = buildCollectionIndexSnapshot(collection);
  const hasActiveIndex = Boolean(collection.activePhysicalCollection);
  const documentsChanged = collection.documentsChanged === true;

  if (!hasActiveIndex) {
    return {
      status: "no_active_index",
      reindexRequired: true,
      activeSnapshot,
      desiredSnapshot,
      changedFields: [...INDEX_SNAPSHOT_FIELDS],
      documentsChanged,
      note: "Not indexed yet. Add documents, then re-index to make the collection searchable.",
    };
  }

  if (!activeSnapshot) {
    return {
      status: "reindex_required",
      reindexRequired: true,
      activeSnapshot: null,
      desiredSnapshot,
      changedFields: [...INDEX_SNAPSHOT_FIELDS],
      documentsChanged,
      note: "The settings of the current index are not known. Re-index to apply the saved settings.",
    };
  }

  const changedFields = INDEX_SNAPSHOT_FIELDS.filter((field) => activeSnapshot[field] !== desiredSnapshot[field]);
  if (changedFields.length > 0) {
    return {
      status: "reindex_required",
      reindexRequired: true,
      activeSnapshot,
      desiredSnapshot,
      changedFields,
      documentsChanged,
      note: "Some saved settings differ from the ones the current index was built with. Re-index to apply them; until then searches use the current index.",
    };
  }

  if (documentsChanged) {
    return {
      status: "reindex_required",
      reindexRequired: true,
      activeSnapshot,
      desiredSnapshot,
      changedFields: [],
      documentsChanged,
      note: "Documents were uploaded since the last index. Re-index to search them.",
    };
  }

  return {
    status: "synced",
    reindexRequired: false,
    activeSnapshot,
    desiredSnapshot,
    changedFields: [],
    documentsChanged,
    note: "The index matches the saved settings.",
  };
}

export function isCollectionIndexState(value: unknown): value is CollectionIndexState {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof (value as CollectionIndexState).status === "string"
    && typeof (value as CollectionIndexState).reindexRequired === "boolean";
}

function isDistanceMetric(value: unknown): value is DistanceMetric {
  return value === "l2" || value === "cosine" || value === "ip";
}
