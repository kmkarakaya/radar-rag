import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import type { EmbeddingTargetStatus } from "../src/embeddings/index.js";
import { DEFAULT_BUILTIN_EMBEDDING_MODEL } from "../src/embeddings/models.js";
import type { IndexJobRunner } from "../src/indexing/jobRunner.js";
import { ensureSampleCollection, findSampleSourcePath, SAMPLE_COLLECTION_NAME } from "../src/samples/sampleCollection.js";

const silentLog = { log: () => {}, error: () => {} };

function recordingRunner(started: string[]): IndexJobRunner {
  return {
    start: (jobId: string) => { started.push(jobId); },
    abort: () => false,
    drain: async () => {},
    shutdown: async () => {},
  } as unknown as IndexJobRunner;
}

const availableBuiltin = async (): Promise<EmbeddingTargetStatus> => ({
  provider: "builtin",
  model: DEFAULT_BUILTIN_EMBEDDING_MODEL,
  configured: true,
  supported: true,
  downloaded: false,
  approxDownloadMb: 346,
  ok: true,
  latencyMs: 0,
});

describe("first-run sample collection", () => {
  let projectRoot: string;
  let registry: CollectionRegistry;
  let runtimeConfig: ResolvedConfig;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "rag-sample-"));
    await mkdir(path.join(projectRoot, "data", "sample"), { recursive: true });
    await writeFile(path.join(projectRoot, "data", "sample", "doc.md"), "# Sample\nHello.");
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:", projectRoot });
    runtimeConfig = {
      ...config,
      projectRoot,
      sampleCollectionEnabled: true,
      embedding: { ...config.embedding, provider: "builtin", model: DEFAULT_BUILTIN_EMBEDDING_MODEL, baseUrl: "" },
    };
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("creates the sample collection from data/sample and starts indexing it on an empty registry", async () => {
    const started: string[] = [];
    const result = await ensureSampleCollection({
      registry, jobRunner: recordingRunner(started), runtimeConfig, log: silentLog, checkEmbedding: availableBuiltin,
    });

    assert.equal(result.status, "created-and-indexing");
    const collections = await registry.listVisibleCollections({ tenantId: "default", userId: "x", requestId: "r" });
    assert.equal(collections.length, 1);
    assert.equal(collections[0].displayName, SAMPLE_COLLECTION_NAME);
    assert.equal(collections[0].sourcePath, "data/sample");
    assert.equal(collections[0].embeddingProvider, "builtin");
    assert.equal(started.length, 1);
  });

  it("never runs again once any collection exists, even if the sample was deleted", async () => {
    const started: string[] = [];
    const first = await ensureSampleCollection({
      registry, jobRunner: recordingRunner(started), runtimeConfig, log: silentLog, checkEmbedding: availableBuiltin,
    });
    assert.equal(first.status, "created-and-indexing");
    const context = { tenantId: "default", userId: "x", requestId: "r" };
    const [sample] = await registry.listVisibleCollections(context);
    await registry.deleteCollection(context, sample.id);
    assert.equal((await registry.listVisibleCollections(context)).length, 0);

    const second = await ensureSampleCollection({
      registry, jobRunner: recordingRunner(started), runtimeConfig, log: silentLog, checkEmbedding: availableBuiltin,
    });
    assert.equal(second.status, "not-first-start");
    assert.equal(started.length, 1);
  });

  it("does nothing when disabled or when there are no sample documents", async () => {
    const disabled = await ensureSampleCollection({
      registry, jobRunner: recordingRunner([]), runtimeConfig: { ...runtimeConfig, sampleCollectionEnabled: false }, log: silentLog,
    });
    assert.equal(disabled.status, "disabled");

    await rm(path.join(projectRoot, "data", "sample"), { recursive: true, force: true });
    const missing = await ensureSampleCollection({ registry, jobRunner: recordingRunner([]), runtimeConfig, log: silentLog });
    assert.equal(missing.status, "no-sample-documents");
    assert.equal(await registry.countAllCollections(), 0);
  });

  it("keeps the collection but does not start indexing when the embedding is unavailable", async () => {
    const started: string[] = [];
    const result = await ensureSampleCollection({
      registry,
      jobRunner: recordingRunner(started),
      runtimeConfig: {
        ...runtimeConfig,
        embedding: { ...runtimeConfig.embedding, provider: "openai-compatible", model: "nomic-embed-text", baseUrl: "http://embed.test/v1" },
      },
      log: silentLog,
      checkEmbedding: async () => ({
        provider: "openai-compatible",
        model: "nomic-embed-text",
        configured: true,
        supported: true,
        reachable: false,
        authOk: false,
        modelListed: "unknown",
        ok: false,
        latencyMs: 1,
        error: "connect ECONNREFUSED",
      }),
    });

    assert.equal(result.status, "created-not-indexed");
    assert.equal(await registry.countAllCollections(), 1);
    assert.equal(started.length, 0);
  });

  it("falls back to samples/ (the Docker image layout) when data/sample does not exist", async () => {
    await rm(path.join(projectRoot, "data", "sample"), { recursive: true, force: true });
    await mkdir(path.join(projectRoot, "samples"), { recursive: true });
    await writeFile(path.join(projectRoot, "samples", "doc.md"), "Hello.");
    assert.equal(findSampleSourcePath(projectRoot), path.join(projectRoot, "samples"));
  });
});
