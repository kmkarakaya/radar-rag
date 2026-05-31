import type { Request } from "express";
import type { RequestContext } from "../http/requestContext.js";
import type { CollectionRegistry, RagCollection } from "./types.js";
import { assertChromaCollectionReadable } from "./chromaCollections.js";
import { HttpError } from "../http/errors.js";
import { config, type ResolvedConfig } from "../config.js";

export async function resolveReadableCollection(
  req: Request,
  deps: { registry: CollectionRegistry },
  runtimeConfig: ResolvedConfig = config
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
    throw new HttpError(404, "COLLECTION_NOT_FOUND", `Collection not found: ${collectionId}`, { collectionId });
  }

  // Auth logic is bypassed in local dev since we have no roles/permissions logic yet,
  // but if tenantId matches (which it does via getVisibleCollection), we assume allowed.
  // if tenantId mismatches, getVisibleCollection returns null, triggering 404 above. 
  // If we had cross-tenant but forbidden access, it would be 403 COLLECTION_FORBIDDEN.

  if (!collection.activePhysicalCollection) {
    if (collection.status === "creating" || collection.status === "indexing") {
      throw new HttpError(503, "COLLECTION_INDEXING", "Collection has no active indexed version yet and is currently indexing.", { collectionId });
    }
    throw new HttpError(404, "COLLECTION_NOT_READY", "Collection has no active indexed version yet.", { collectionId });
  }

  try {
    await assertChromaCollectionReadable({
      name: collection.activePhysicalCollection,
      runtimeConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404|could not be found/i.test(message)) {
      throw new HttpError(503, "COLLECTION_STORAGE_INCONSISTENT", "Active physical collection is missing in Chroma.", {
        collectionId,
        physicalCollection: collection.activePhysicalCollection,
      });
    }
    throw error;
  }

  return collection;
}
