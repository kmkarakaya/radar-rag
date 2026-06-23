import type { Request } from "express";
import type { RequestContext } from "../http/requestContext.js";
import type { CollectionRegistry, RagCollection } from "./types.js";
import { assertChromaCollectionReadable } from "./chromaCollections.js";
import { HttpError } from "../http/errors.js";
import { config, type ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";

export async function resolveReadableCollection(
  req: Request,
  deps: { registry: CollectionRegistry },
  runtimeConfig: ResolvedConfig = config,
  options?: {
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    assertChromaCollectionReadable?: typeof assertChromaCollectionReadable;
    logEvent?: OperationalLogSink;
  }
): Promise<RagCollection> {
  const collectionId = Array.isArray(req.params.collectionId) ? req.params.collectionId[0] : req.params.collectionId;
  if (!collectionId || typeof collectionId !== "string") {
    throw new HttpError(400, "INVALID_REQUEST_BODY", "Collection ID is required.");
  }

  const context = req.res?.locals.requestContext as RequestContext;
  if (!context) {
    throw new HttpError(500, "INTERNAL_ERROR", "Request context is missing.");
  }

  const collection = await deps.registry.getVisibleCollection(context, collectionId);
  if (!collection) {
    // Check if it exists globally
    const exists = await deps.registry.collectionExists(collectionId);
    if (exists) {
      throw new HttpError(403, "COLLECTION_FORBIDDEN", `Collection access forbidden: ${collectionId}`, { collectionId });
    }
    throw new HttpError(404, "COLLECTION_NOT_FOUND", `Collection not found: ${collectionId}`, { collectionId });
  }

  if (!collection.activePhysicalCollection) {
    if (collection.status === "creating" || collection.status === "indexing") {
      throw new HttpError(503, "COLLECTION_INDEXING", "Collection has no active indexed version yet and is currently indexing.", { collectionId });
    }
    throw new HttpError(404, "COLLECTION_NOT_READY", "Collection has no active indexed version yet.", { collectionId });
  }

  try {
    const assertFn = options?.assertChromaCollectionReadable ?? assertChromaCollectionReadable;
    await assertFn({
      name: collection.activePhysicalCollection,
      runtimeConfig,
      timeoutMs: options?.timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404|could not be found/i.test(message)) {
      emitOperationalLog(options?.logEvent, {
        tenantId: collection.tenantId,
        collectionId,
        physicalCollection: collection.activePhysicalCollection,
        operation: "collection_readiness",
        status: "failed",
        errorCode: "COLLECTION_STORAGE_INCONSISTENT",
        message: "Active physical collection is missing in Chroma.",
      });
      throw new HttpError(503, "COLLECTION_STORAGE_INCONSISTENT", "Active physical collection is missing in Chroma.", {
        collectionId,
        physicalCollection: collection.activePhysicalCollection,
      });
    }
    throw error;
  }

  return collection;
}
