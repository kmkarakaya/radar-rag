import type { CollectionRegistry } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { deletePhysicalChromaCollection } from "../collections/chromaCollections.js";

export async function cleanupRetiredPhysicalCollections(input: {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  now?: Date;
  limit?: number;
  log?: (message: string) => void;
}): Promise<number> {
  const { registry, runtimeConfig } = input;
  const nowIso = (input.now ?? new Date()).toISOString();
  const limit = input.limit ?? 10;
  const log = input.log ?? console.log;

  const dueCollections = await registry.listDuePhysicalCollectionsForCleanup(nowIso, limit);
  if (dueCollections.length === 0) {
    return 0;
  }

  let cleanedCount = 0;

  for (const record of dueCollections) {
    log(`Attempting to clean up retired physical collection: ${record.name}`);
    try {
      await deletePhysicalChromaCollection({
        name: record.name,
        runtimeConfig,
      });
      await registry.markPhysicalCollectionDeleted(record.name);
      log(`Successfully cleaned up: ${record.name}`);
      cleanedCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to clean up ${record.name}: ${message}`);
      await registry.markPhysicalCollectionCleanupFailed(record.name, message);
    }
  }

  return cleanedCount;
}
