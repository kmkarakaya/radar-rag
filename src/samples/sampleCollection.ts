import fs from "node:fs";
import path from "node:path";
import type { CollectionRegistry, RequestContext } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { buildCreateCollectionInput } from "../http/collectionValidation.js";
import { assertEmbeddingAvailable } from "../http/modelAvailability.js";
import type { IndexJobRunner } from "../indexing/jobRunner.js";
import { startReindexJob } from "../indexing/jobs.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";

/**
 * First-run experience: when the registry has never had a collection, create one from the bundled
 * sample documents and start indexing it, so a new user can search right away.
 *
 * Runs once per registry: a deleted sample is only archived, so it is never recreated, and existing
 * installs (which already have collections) never get one.
 */

export const SAMPLE_COLLECTION_NAME = "Sample documents";

/** Where the sample documents live: data/sample in a clone, samples/ in the Docker image (data/ is a mount). */
export const SAMPLE_SOURCE_CANDIDATES = ["data/sample", "samples"] as const;

const SAMPLE_CONTEXT: RequestContext = { tenantId: "default", userId: "system", requestId: "startup-sample" };

export type SampleCollectionResult =
  | { status: "disabled" | "not-first-start" | "no-sample-documents" }
  | { status: "created-not-indexed"; collectionId: string; reason: string }
  | { status: "created-and-indexing"; collectionId: string; jobId: string };

export function findSampleSourcePath(projectRoot: string): string | null {
  for (const candidate of SAMPLE_SOURCE_CANDIDATES) {
    const dir = path.resolve(projectRoot, candidate);
    try {
      if (fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0) return dir;
    } catch {
      // not there; try the next candidate
    }
  }
  return null;
}

export async function ensureSampleCollection(input: {
  registry: CollectionRegistry;
  jobRunner: IndexJobRunner;
  runtimeConfig: ResolvedConfig;
  log?: Pick<Console, "log" | "error">;
  logEvent?: OperationalLogSink;
  /** Injectable for tests. */
  checkEmbedding?: Parameters<typeof assertEmbeddingAvailable>[0]["check"];
}): Promise<SampleCollectionResult> {
  const { registry, jobRunner, runtimeConfig } = input;
  const log = input.log ?? console;

  if (!runtimeConfig.sampleCollectionEnabled) return { status: "disabled" };
  if (await registry.countAllCollections() > 0) return { status: "not-first-start" };

  const sourcePath = findSampleSourcePath(runtimeConfig.projectRoot);
  if (!sourcePath) {
    log.log("Sample collection skipped: no sample documents found (data/sample or samples/).");
    return { status: "no-sample-documents" };
  }

  const collection = await registry.createCollection(SAMPLE_CONTEXT, buildCreateCollectionInput({
    displayName: SAMPLE_COLLECTION_NAME,
    description: "English documents about this backend and how RAG works. Created on the first start; delete it any time.",
    sourcePath,
  }, runtimeConfig));

  try {
    await assertEmbeddingAvailable({
      runtimeConfig,
      target: { provider: collection.embeddingProvider, model: collection.embeddingModel },
      action: "The sample collection cannot be indexed.",
      check: input.checkEmbedding,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.log(`Sample collection created but not indexed: ${reason} Fix the embedding setup, then re-index "${SAMPLE_COLLECTION_NAME}" in the admin panel.`);
    emitOperationalLog(input.logEvent, {
      ...SAMPLE_CONTEXT,
      collectionId: collection.id,
      operation: "sample_collection",
      status: "skipped",
      message: reason,
    });
    return { status: "created-not-indexed", collectionId: collection.id, reason };
  }

  const job = await startReindexJob({ registry, collectionId: collection.id, context: SAMPLE_CONTEXT, runtimeConfig });
  jobRunner.start(job.id);
  log.log(`Sample collection "${SAMPLE_COLLECTION_NAME}" created; indexing started (job ${job.id}). The first indexing with the built-in model downloads it once (~350 MB).`);
  emitOperationalLog(input.logEvent, {
    ...SAMPLE_CONTEXT,
    collectionId: collection.id,
    jobId: job.id,
    operation: "sample_collection",
    status: "started",
  });
  return { status: "created-and-indexing", collectionId: collection.id, jobId: job.id };
}
