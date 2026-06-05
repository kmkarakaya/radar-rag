import type { CollectionRegistry } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { deletePhysicalChromaCollection } from "../collections/chromaCollections.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";

export type DeletePhysicalCollectionFn = (input: {
  name: string;
  runtimeConfig: ResolvedConfig;
}) => Promise<void>;

export async function cleanupRetiredPhysicalCollections(input: {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  now?: Date;
  limit?: number;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
  deletePhysicalCollection?: DeletePhysicalCollectionFn;
}): Promise<number> {
  const { registry, runtimeConfig } = input;
  const nowIso = (input.now ?? new Date()).toISOString();
  const limit = input.limit ?? 10;
  const log = input.log ?? console.log;
  const deletePhysicalCollection = input.deletePhysicalCollection ?? deletePhysicalChromaCollection;

  const dueCollections = await registry.listDuePhysicalCollectionsForCleanup(nowIso, limit);
  if (dueCollections.length === 0) {
    return 0;
  }

  let cleanedCount = 0;

  for (const record of dueCollections) {
    const startedAt = Date.now();
    log(`Attempting to clean up retired physical collection: ${record.name}`);
    try {
      await deletePhysicalCollection({
        name: record.name,
        runtimeConfig,
      });
      await registry.markPhysicalCollectionDeleted(record.name);
      log(`Successfully cleaned up: ${record.name}`);
      emitOperationalLog(input.logEvent, {
        tenantId: record.tenantId,
        collectionId: record.collectionId,
        physicalCollection: record.name,
        operation: "cleanup",
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
        details: {
          previousStatus: record.status,
          idempotentStorageMissing: false,
        },
      });
      cleanedCount++;
    } catch (error) {
      if (isPhysicalCollectionMissingError(error)) {
        log(`Physical collection ${record.name} was already missing in storage. Marking as deleted.`);
        await registry.markPhysicalCollectionDeleted(record.name);
        emitOperationalLog(input.logEvent, {
          tenantId: record.tenantId,
          collectionId: record.collectionId,
          physicalCollection: record.name,
          operation: "cleanup",
          status: "succeeded",
          latencyMs: Date.now() - startedAt,
          details: {
            previousStatus: record.status,
            idempotentStorageMissing: true,
          },
        });
        cleanedCount++;
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to clean up ${record.name}: ${message}`);
      await registry.markPhysicalCollectionCleanupFailed(record.name, message);
      emitOperationalLog(input.logEvent, {
        tenantId: record.tenantId,
        collectionId: record.collectionId,
        physicalCollection: record.name,
        operation: "cleanup",
        status: "failed",
        latencyMs: Date.now() - startedAt,
        errorCode: "PHYSICAL_CLEANUP_FAILED",
        message,
        details: {
          previousStatus: record.status,
        },
      });
    }
  }

  return cleanedCount;
}

function isPhysicalCollectionMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|404|could not be found/i.test(message);
}
