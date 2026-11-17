import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildCollectionIndexState } from "../src/collections/indexState.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry, RagCollection } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import { DEFAULT_BUILTIN_EMBEDDING_MODEL } from "../src/embeddings/models.js";
import {
  buildCreateCollectionInput,
  buildCreateValidationDraft,
  buildUpdateValidationDraft,
  looksLikeHostWindowsPath,
  validateCollectionDraft,
} from "../src/http/collectionValidation.js";
import { analyzeIndexingSource, listSourceFilePaths, sourceScanExcludes } from "../src/ingestion/pipeline.js";

const context = { tenantId: "default", userId: "tester", requestId: "req-1" };

// No network: Chroma and the embedding are reported healthy.
const healthChecks = {
  checkChromaHealth: async () => ({ ok: true, latencyMs: 0, details: { reachable: true } }),
  checkEmbeddingTarget: async () => ({
    provider: "builtin" as const,
    model: DEFAULT_BUILTIN_EMBEDDING_MODEL,
    configured: true,
    supported: true,
    downloaded: true,
    approxDownloadMb: 0,
    ok: true,
    latencyMs: 0,
  }),
} as any;

describe("document management model", () => {
  let projectRoot: string;
  let runtimeConfig: ResolvedConfig;
  let registry: CollectionRegistry;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "radar-rag-docs-model-"));
    runtimeConfig = {
      ...config,
      projectRoot,
      registryPath: path.join(projectRoot, "data", "registry.sqlite"),
      uploadsDir: path.join(projectRoot, "data", "collections"),
      embedding: { ...config.embedding, provider: "builtin", model: DEFAULT_BUILTIN_EMBEDDING_MODEL, baseUrl: "" },
    };
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:", projectRoot });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function createUploadsCollection(): Promise<RagCollection> {
    return registry.createCollection(context, buildCreateCollectionInput({ displayName: "My docs" }, runtimeConfig));
  }

  it("gives a collection without a source path its own uploads folder", async () => {
    const collection = await createUploadsCollection();
    assert.equal(collection.sourceKind, "uploads");
    // Stored relative to the project root, like every path inside the project.
    assert.equal(collection.sourcePath, `data/collections/${collection.id}`);
    assert.equal(collection.documentsChanged, false);

    const folder = await registry.createCollection(
      context,
      buildCreateCollectionInput({ displayName: "Folder", sourcePath: path.join(projectRoot, "data", "docs") }, runtimeConfig),
    );
    assert.equal(folder.sourceKind, "folder");
    assert.equal(folder.sourcePath, "data/docs");
  });

  it("marks documents as changed until the next index job succeeds", async () => {
    const collection = await createUploadsCollection();
    await registry.markDocumentsChanged(context, collection.id);
    const changed = await registry.getVisibleCollection(context, collection.id);
    assert.equal(changed?.documentsChanged, true);
    assert.equal(changed?.indexState?.documentsChanged, true);

    const queued = await registry.beginIndexJob(context, collection.id);
    const running = await registry.markIndexJobRunning(queued.id);
    await registry.createPhysicalCollectionRecord({
      name: running.targetPhysicalCollection,
      tenantId: context.tenantId,
      collectionId: collection.id,
      version: running.targetVersion,
      chromaConfiguration: running.targetChromaConfiguration,
    });
    await registry.completeIndexJob(running.id, {
      activePhysicalCollection: running.targetPhysicalCollection,
      activeVersion: running.targetVersion,
      documentCount: 1,
      chunkCount: 1,
      retentionMs: 1000,
    });

    const indexed = await registry.getVisibleCollection(context, collection.id);
    assert.equal(indexed?.documentsChanged, false);
    assert.equal(indexed?.indexState?.status, "synced");
  });

  it("reports changed documents as re-index required even when the settings are unchanged", () => {
    const collection = {
      sourcePath: "data/collections/x",
      distanceMetric: "l2" as const,
      chunkSize: 500,
      chunkOverlap: 200,
      embeddingProvider: "builtin" as const,
      embeddingModel: "m",
      activePhysicalCollection: "rag_x_v1",
    };
    const snapshot = { ...collection };
    delete (snapshot as Partial<typeof snapshot>).activePhysicalCollection;

    const synced = buildCollectionIndexState({ ...collection, documentsChanged: false }, snapshot);
    assert.equal(synced.status, "synced");
    const changed = buildCollectionIndexState({ ...collection, documentsChanged: true }, snapshot);
    assert.equal(changed.status, "reindex_required");
    assert.equal(changed.reindexRequired, true);
    assert.equal(changed.documentsChanged, true);
    assert.match(changed.note, /Documents were added or removed/);
  });

  it("never scans the uploads root from a folder collection, but scans an uploads collection's own folder", async () => {
    const data = path.join(projectRoot, "data");
    await mkdir(path.join(data, "collections", "other-tenant-collection"), { recursive: true });
    await writeFile(path.join(data, "public.md"), "# Public\nVisible to the data folder collection.");
    await writeFile(path.join(data, "collections", "other-tenant-collection", "private.md"), "# Private\nUploaded elsewhere.");

    const excludes = sourceScanExcludes(runtimeConfig);
    const dataFiles = await listSourceFilePaths(data, excludes);
    assert.deepEqual(dataFiles.map((file) => path.basename(file)), ["public.md"]);
    const analysis = await analyzeIndexingSource({ sourcePath: data, ...excludes });
    assert.equal(analysis.fileCount, 1);

    const ownFiles = await listSourceFilePaths(path.join(data, "collections", "other-tenant-collection"), excludes);
    assert.deepEqual(ownFiles.map((file) => path.basename(file)), ["private.md"]);
  });

  it("does not block creating an uploads collection, but blocks re-indexing it while it has no documents", async () => {
    const createDraft = buildCreateValidationDraft(buildCreateCollectionInput({ displayName: "Empty" }, runtimeConfig));
    const created = await validateCollectionDraft(createDraft, runtimeConfig, undefined, undefined, healthChecks);
    assert.deepEqual(created.blockers, []);

    const collection = await createUploadsCollection();
    const reindex = await validateCollectionDraft(
      buildUpdateValidationDraft({ ...collection, sourcePath: path.join(projectRoot, collection.sourcePath) }, {}),
      runtimeConfig,
      registry,
      context,
      healthChecks,
    );
    assert.deepEqual(reindex.blockers.map((issue) => issue.code), ["NO_INDEXABLE_DOCUMENTS"]);
    assert.match(reindex.blockers[0].recommendedAction ?? "", /Upload documents/);
  });

  it("does not let an uploads collection change its source path", async () => {
    const collection = await createUploadsCollection();
    const result = await validateCollectionDraft(
      buildUpdateValidationDraft(collection, { sourcePath: "data/elsewhere" }),
      runtimeConfig,
      registry,
      context,
      healthChecks,
    );
    assert.ok(result.blockers.some((issue) => issue.code === "COLLECTION_SOURCE_FIXED"));
  });

  it("points a missing folder at the source path, with a hint for Windows paths on a Linux server", async () => {
    const draft = buildCreateValidationDraft(
      buildCreateCollectionInput({ displayName: "Missing", sourcePath: path.join(projectRoot, "data", "missing") }, runtimeConfig),
    );
    const result = await validateCollectionDraft(draft, runtimeConfig, undefined, undefined, healthChecks);
    const unreadable = result.blockers.find((issue) => issue.code === "INDEXING_SOURCE_UNREADABLE");
    assert.ok(unreadable);
    assert.match(unreadable.recommendedAction ?? "", /data\/my-docs/);
    assert.doesNotMatch(unreadable.recommendedAction ?? "", /rag\.config\.yaml/);

    assert.equal(looksLikeHostWindowsPath("C:\\Deneme\\radar-rag\\data\\my-docs", "linux"), true);
    assert.equal(looksLikeHostWindowsPath("D:/docs", "linux"), true);
    assert.equal(looksLikeHostWindowsPath("C:\\docs", "win32"), false);
    assert.equal(looksLikeHostWindowsPath("data/my-docs", "linux"), false);
  });
});
