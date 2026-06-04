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

  let job = await registry.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Mark job as running
  job = await registry.markIndexJobRunning(jobId);

  const collection = await registry.getVisibleCollection({ 
    tenantId: job.tenantId, 
    userId: "system", 
    requestId: `job-${jobId}` 
  }, job.collectionId);

  if (!collection) {
    await registry.failIndexJob(jobId, `Collection not found: ${job.collectionId}`);
    return;
  }

  const targetVersion = job.targetVersion;

  try {
    await registry.createPhysicalCollectionRecord({
      name: job.targetPhysicalCollection,
      tenantId: collection.tenantId,
      collectionId: collection.id,
      version: targetVersion,
      chromaConfiguration: job.targetChromaConfiguration,
    });

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
      retentionMs: runtimeConfig.cleanupRetentionMs,
    });
    
    log(`Job ${jobId} completed successfully.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await registry.failIndexJob(jobId, message);
    log(`Job ${jobId} failed: ${message}`);
  }
}
