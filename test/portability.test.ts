import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { applyConfigEnvOverrides, parseConfig } from "../src/config.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CreateCollectionInput } from "../src/collections/types.js";
import { toPortablePath } from "../src/paths.js";

const context = { tenantId: "default", userId: "local-dev", requestId: "portability" };

function collectionInput(sourcePath: string): CreateCollectionInput {
  return {
    displayName: "Portable",
    sourcePath,
    embeddingModel: "bge-m3",
    distanceMetric: "l2",
    chunkSize: 500,
    chunkOverlap: 50,
    retrievalK: 5,
    retrievalDistanceThreshold: 1,
  };
}

describe("toPortablePath", () => {
  const root = path.resolve(os.tmpdir(), "portable-root");

  it("makes absolute paths inside the project relative with forward slashes", () => {
    assert.equal(toPortablePath(path.join(root, "data", "dataset1"), root), "data/dataset1");
  });

  it("keeps relative paths inside the project relative", () => {
    assert.equal(toPortablePath("data", root), "data");
    assert.equal(toPortablePath("./data/dataset1/", root), "data/dataset1");
  });

  it("returns '.' for the project root itself", () => {
    assert.equal(toPortablePath(root, root), ".");
  });

  it("leaves paths outside the project unchanged", () => {
    const outside = path.resolve(os.tmpdir(), "elsewhere", "docs");
    assert.equal(toPortablePath(outside, root), outside);
  });
});

describe("registry source path portability", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radar-rag-portable-"));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stores new and patched source paths inside the project relative to it", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: path.join(tempDir, "new.sqlite"), projectRoot: tempDir });
    try {
      const created = await registry.createCollection(context, collectionInput(path.join(tempDir, "data", "dataset1")));
      assert.equal(created.sourcePath, "data/dataset1");

      const patched = await registry.updateCollection(context, created.id, { sourcePath: path.join(tempDir, "docs") });
      assert.equal(patched.sourcePath, "docs");

      const outside = path.resolve(os.tmpdir(), "outside-project");
      const external = await registry.createCollection(context, collectionInput(outside));
      assert.equal(external.sourcePath, outside);
    } finally {
      registry.close?.();
    }
  });

  it("rewrites existing absolute rows and their index snapshot once at startup", async () => {
    const dbPath = path.join(tempDir, "legacy.sqlite");
    const absoluteSource = path.join(tempDir, "data", "dataset1");

    // A registry written before this change, without projectRoot: absolute path + matching snapshot.
    const legacy = createSqliteCollectionRegistry({ dbPath });
    const collection = await legacy.createCollection(context, collectionInput(absoluteSource));
    legacy.close?.();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE collections SET indexed_snapshot_json = ?, active_physical_collection = 'phys_v1' WHERE id = ?")
      .run(JSON.stringify({
        sourcePath: absoluteSource,
        distanceMetric: "l2",
        chunkSize: 500,
        chunkOverlap: 50,
        embeddingProvider: "builtin",
        embeddingModel: "bge-m3",
      }), collection.id);
    raw.close();

    const migrated = createSqliteCollectionRegistry({ dbPath, projectRoot: tempDir });
    try {
      const reloaded = await migrated.getVisibleCollection(context, collection.id);
      assert.equal(reloaded?.sourcePath, "data/dataset1");
      // Snapshot was rewritten too, so the move does not make the collection look out of date.
      assert.equal(reloaded?.indexState?.status, "synced");
    } finally {
      migrated.close?.();
    }
  });
});

describe("config environment overrides", () => {
  const raw = {
    server: { port: 3010 },
    registry: { path: "data/registry.sqlite" },
    chroma: { url: "http://localhost:8000" },
    collectionDefaults: {
      sourcePath: "data",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 200,
      retrievalK: 5,
      retrievalDistanceThreshold: 1.2,
      timeoutMs: 180000,
    },
    readiness: { timeoutMs: 30000, embeddingProbeText: "Merhaba", chatProbeText: "Orda misin?" },
  };

  it("lets RAG_* variables override file values without mutating the input", () => {
    const overridden = parseConfig(applyConfigEnvOverrides(raw, {
      RAG_PORT: "8080",
      RAG_CHROMA_URL: "http://chroma:8000",
      RAG_EMBEDDING_PROVIDER: "openai-compatible",
      RAG_EMBEDDING_BASE_URL: "http://host.docker.internal:11434/v1",
      RAG_EMBEDDING_MODEL: "nomic-embed-text",
      RAG_EMBEDDING_CACHE_DIR: "/models",
      RAG_SOURCE_PATH: "/data",
      RAG_CHAT_BASE_URL: "http://ollama:11434/v1",
      RAG_CHAT_MODEL: "gemma3:4b",
    }));

    assert.equal(overridden.server.port, 8080);
    assert.equal(overridden.chroma.url, "http://chroma:8000");
    // The embedding section does not exist in the file; the overrides create it.
    assert.deepEqual(overridden.embedding, {
      provider: "openai-compatible",
      baseUrl: "http://host.docker.internal:11434/v1",
      model: "nomic-embed-text",
      cacheDir: "/models",
    });
    // The chat section does not exist in the file; the override creates it.
    assert.deepEqual(overridden.chat, { baseUrl: "http://ollama:11434/v1", model: "gemma3:4b" });
    assert.equal(overridden.collectionDefaults.sourcePath, "/data");
    assert.equal(raw.server.port, 3010);
  });

  it("ignores empty variables and rejects a non-integer port", () => {
    assert.deepEqual(applyConfigEnvOverrides(raw, { RAG_CHROMA_URL: "  " }), raw);
    assert.throws(() => applyConfigEnvOverrides(raw, { RAG_PORT: "abc" }), /Invalid RAG_PORT/);
  });
});
