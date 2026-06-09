import type { CollectionRegistry, IndexJob, RequestContext, RagCollection } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
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
  signal?: AbortSignal;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
  deps?: {
    buildPhysicalCollection?: typeof buildPhysicalCollection;
  };
}): Promise<IndexJob> {
  const { registry, jobId, runtimeConfig, signal } = input;
  const log = input.log ?? console.log;
  const buildCollection = input.deps?.buildPhysicalCollection ?? buildPhysicalCollection;
  const startedAt = Date.now();

  let job = await registry.getJob(jobId);
  if (!job) {
    emitOperationalLog(input.logEvent, {
      jobId,
      operation: "index_job",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: "JOB_NOT_FOUND",
      message: `Job not found: ${jobId}`,
    });
    throw new Error(`Job not found: ${jobId}`);
  }

  // Mark job as running
  job = await registry.markIndexJobRunning(jobId);
  emitOperationalLog(input.logEvent, {
    tenantId: job.tenantId,
    collectionId: job.collectionId,
    physicalCollection: job.targetPhysicalCollection,
    jobId,
    operation: "index_job",
    status: "started",
    details: {
      targetVersion: job.targetVersion,
    },
  });

  const collection = await registry.getVisibleCollection({ 
    tenantId: job.tenantId, 
    userId: "system", 
    requestId: `job-${jobId}` 
  }, job.collectionId);

  if (!collection) {
    const message = `Collection not found: ${job.collectionId}`;
    job = await registry.failIndexJob(jobId, message);
    emitOperationalLog(input.logEvent, {
      tenantId: job.tenantId,
      collectionId: job.collectionId,
      physicalCollection: job.targetPhysicalCollection,
      jobId,
      operation: "index_job",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: "COLLECTION_NOT_FOUND",
      message,
    });
    return job;
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

    // Override collection settings with job snapshots to ensure consistency
    const collectionForBuild: RagCollection = {
      ...collection,
      embeddingModel: job.targetEmbeddingModel,
      chromaCollectionConfiguration: job.targetChromaConfiguration,
    };

    const result = await buildCollection({
      collection: collectionForBuild,
      targetPhysicalCollection: job.targetPhysicalCollection,
      targetVersion,
      runtimeConfig,
      jobId,
      signal,
      log,
      logEvent: input.logEvent,
    });

    job = await registry.completeIndexJob(jobId, {
      documentCount: result.parsedSourceDocumentCount,
      chunkCount: result.chunkCount,
      activePhysicalCollection: job.targetPhysicalCollection,
      activeVersion: targetVersion,
      retentionMs: runtimeConfig.cleanupRetentionMs,
    });
    
    log(`Job ${jobId} completed successfully.`);
    emitOperationalLog(input.logEvent, {
      tenantId: job.tenantId,
      collectionId: job.collectionId,
      physicalCollection: job.targetPhysicalCollection,
      jobId,
      operation: "index_job",
      status: "succeeded",
      latencyMs: Date.now() - startedAt,
      details: {
        targetVersion,
        documentCount: result.parsedSourceDocumentCount,
        chunkCount: result.chunkCount,
      },
    });
    return job;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAbort = message === "Build aborted" || signal?.aborted;

    if (isAbort) {
      job = await registry.getJob(jobId) || job;
      if (job.status === "cancelled") {
        return job;
      }
      if (job.status === "queued" || job.status === "running") {
        job = await registry.cancelIndexJob(jobId);
        emitOperationalLog(input.logEvent, {
            tenantId: job.tenantId,
            collectionId: job.collectionId,
            physicalCollection: job.targetPhysicalCollection,
            jobId,
            operation: "index_job",
            status: "cancelled",
            latencyMs: Date.now() - startedAt,
        });
        return job;
      }
    }

    job = await registry.failIndexJob(jobId, message);
    log(`Job ${jobId} failed: ${message}`);
    emitOperationalLog(input.logEvent, {
      tenantId: job.tenantId,
      collectionId: job.collectionId,
      physicalCollection: job.targetPhysicalCollection,
      jobId,
      operation: "index_job",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: "INDEX_JOB_FAILED",
      message,
      details: {
        targetVersion,
      },
    });
    return job;
  }
}
