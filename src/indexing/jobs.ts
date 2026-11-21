import type {
  CollectionRegistry,
  CreateIndexJobEventInput,
  IndexJob,
  RequestContext,
  RagCollection,
} from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
import { buildPhysicalCollection } from "./buildPhysicalCollection.js";
import type { EmbeddingTarget } from "../embeddings/index.js";
import { resolveEmbeddingTarget, targetApiKey } from "../embeddings/services.js";
import { redactSecret } from "../providers/openaiCompatible.js";

const JOB_PHASE_COUNT = 6;

/** A running job marks itself alive this often (see recordIndexJobHeartbeat). */
export const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
/** A job without a heartbeat for this long is failed as interrupted (its process stopped or crashed). */
export const STALE_JOB_THRESHOLD_MS = 3 * 60_000;

/** Abort reason when the server stops: the job is failed with this message instead of being cancelled. */
export class JobInterruptedError extends Error {
  constructor() {
    super("Interrupted: the server stopped while this job was running. Re-index again.");
    this.name = "JobInterruptedError";
  }
}

async function recordJobEvent(
  registry: CollectionRegistry,
  jobId: string,
  input: CreateIndexJobEventInput,
): Promise<void> {
  try {
    await registry.appendJobEvent(jobId, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to persist job event for ${jobId}: ${message}`);
  }
}

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

  // Marks the job alive until it ends, so a job whose process dies is failed after STALE_JOB_THRESHOLD_MS.
  const heartbeat = setInterval(() => {
    registry.recordIndexJobHeartbeat(jobId).catch(() => {});
  }, JOB_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();
  try {
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
    let embeddingTarget: EmbeddingTarget | undefined;

    try {
      await registry.createPhysicalCollectionRecord({
        name: job.targetPhysicalCollection,
        tenantId: collection.tenantId,
        collectionId: collection.id,
        version: targetVersion,
        chromaConfiguration: job.targetChromaConfiguration,
      });
      await recordJobEvent(registry, jobId, {
        status: "running",
        stage: "preparing_target",
        code: "TARGET_RECORD_CREATED",
        message: "New index version registered.",
        details: {
          targetPhysicalCollection: job.targetPhysicalCollection,
          targetVersion,
        },
        progress: {
          phase: 2,
          phaseCount: JOB_PHASE_COUNT,
        },
      });

      // Override collection settings with job snapshots to ensure consistency
      const collectionForBuild: RagCollection = {
        ...collection,
        embeddingProvider: job.targetEmbeddingProvider,
        embeddingModel: job.targetEmbeddingModel,
        chromaCollectionConfiguration: job.targetChromaConfiguration,
      };

      // The job builds with the embedding service it was started with (copied from the collection).
      embeddingTarget = await resolveEmbeddingTarget({
        registry,
        runtimeConfig,
        context: { tenantId: job.tenantId, userId: "system", requestId: jobId },
        target: {
          provider: job.targetEmbeddingProvider,
          model: job.targetEmbeddingModel,
          serviceId: job.targetEmbeddingServiceId ?? null,
        },
      });

      const result = await buildCollection({
        collection: collectionForBuild,
        embeddingTarget,
        targetPhysicalCollection: job.targetPhysicalCollection,
        targetVersion,
        runtimeConfig,
        jobId,
        signal,
        log,
        logEvent: input.logEvent,
        onEvent: (event) => recordJobEvent(registry, jobId, event),
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
      // Job errors are returned by the jobs API: never store an embedding service's API key in them.
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = embeddingTarget
        ? redactSecret(redactSecret(rawMessage, targetApiKey(runtimeConfig, embeddingTarget)), runtimeConfig.embedding.apiKey)
        : redactSecret(rawMessage, runtimeConfig.embedding.apiKey);
      const isAbort = rawMessage === "Build aborted" || signal?.aborted;

      if (isAbort) {
        job = await registry.getJob(jobId) || job;
        if (job.status !== "queued" && job.status !== "running") {
          // Already cancelled, or failed by the shutdown (see the job runner).
          return job;
        }
        if (signal?.reason instanceof JobInterruptedError) {
          job = await registry.failIndexJob(jobId, signal.reason.message);
          log(`Job ${jobId} interrupted: the server is stopping.`);
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
  } finally {
    clearInterval(heartbeat);
  }
}
