import type { CollectionRegistry, IndexJob, RequestContext } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { buildPhysicalCollection } from "./buildPhysicalCollection.js";

export async function startReindexJob(input: {
  registry: CollectionRegistry;
  collectionId: string;
  context: RequestContext;
  runtimeConfig: ResolvedConfig;
}): Promise<IndexJob> {
  const { registry, collectionId, context } = input;
  
  try {
    return await registry.beginIndexJob(context, collectionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("queued or running index job")) {
      const err = new Error(message);
      err.name = "RagQueryError";
      (err as any).code = "COLLECTION_INDEX_ALREADY_RUNNING";
      (err as any).statusCode = 409;
      throw err;
    }
    throw error;
  }
}

export async function runIndexJob(input: {
  registry: CollectionRegistry;
  jobId: string;
  runtimeConfig: ResolvedConfig;
  log?: (message: string) => void;
}): Promise<void> {
  const { registry, jobId, runtimeConfig } = input;
  const log = input.log ?? console.log;

  const job = await registry.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const collection = await registry.getVisibleCollection({ 
    tenantId: job.tenantId, 
    userId: "system", 
    requestId: `job-${jobId}` 
  }, job.collectionId);

  if (!collection) {
    await registry.failIndexJob(jobId, `Collection not found: ${job.collectionId}`);
    return;
  }

  const targetVersion = job.id.split("_")[0] || "unknown";

  try {
    const result = await buildPhysicalCollection({
      collection,
      targetPhysicalCollection: job.targetPhysicalCollection,
      targetVersion,
      runtimeConfig,
      log,
    });

    await registry.completeIndexJob(jobId, {
      documentCount: result.parsedSourceDocumentCount,
      chunkCount: result.chunkCount,
      activePhysicalCollection: job.targetPhysicalCollection,
      activeVersion: targetVersion,
    });
    
    log(`Job ${jobId} completed successfully.`);

    if (collection.activePhysicalCollection && collection.activePhysicalCollection !== job.targetPhysicalCollection) {
      log(`Scheduling cleanup for old physical collection: ${collection.activePhysicalCollection}`);
      import("../collections/chromaCollections.js").then(({ deletePhysicalChromaCollection }) => {
        deletePhysicalChromaCollection({ name: collection.activePhysicalCollection!, runtimeConfig }).catch((err) => {
          console.error(`Failed to clean up old physical collection ${collection.activePhysicalCollection}:`, err);
        });
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await registry.failIndexJob(jobId, message);
    log(`Job ${jobId} failed: ${message}`);
  }
}
