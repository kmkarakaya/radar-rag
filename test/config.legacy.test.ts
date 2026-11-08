import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig, resolveConfig } from "../src/config.js";

const baseRawConfig = {
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

describe("config legacy keys", () => {
  it("drops the removed ozelge keys from older config files instead of rejecting them", () => {
    const parsed = parseConfig({
      ...baseRawConfig,
      collectionDefaults: {
        ...baseRawConfig.collectionDefaults,
        ozelgeDataPath: "data/ozelge_veri.json",
        indexSampleSize: 0,
      },
    });

    assert.equal("ozelgeDataPath" in parsed.collectionDefaults, false);
    assert.equal("indexSampleSize" in parsed.collectionDefaults, false);
    assert.equal(parsed.collectionDefaults.sourcePath, "data");
  });

  it("still rejects other unknown collectionDefaults keys", () => {
    assert.throws(
      () => parseConfig({
        ...baseRawConfig,
        collectionDefaults: { ...baseRawConfig.collectionDefaults, typoField: true },
      }),
      /Invalid config file/,
    );
  });
});

describe("embedding config", () => {
  it("defaults to the built-in model when the embedding section is missing", () => {
    const resolved = resolveConfig(parseConfig(baseRawConfig), "test.yaml", process.cwd(), { env: {} });
    assert.equal(resolved.embedding.provider, "builtin");
    assert.equal(resolved.embedding.model, "onnx-community/embeddinggemma-2-ONNX");
    assert.equal(resolved.embedding.baseUrl, "");
    assert.ok(resolved.embedding.cacheDir.endsWith("models"));
  });

  it("requires a base URL for openai-compatible and a catalog model for builtin", () => {
    assert.throws(
      () => parseConfig({ ...baseRawConfig, embedding: { provider: "openai-compatible", model: "nomic-embed-text" } }),
      /embedding\.baseUrl/,
    );
    assert.throws(
      () => parseConfig({ ...baseRawConfig, embedding: { provider: "builtin", model: "not-in-catalog" } }),
      /embedding\.model/,
    );
    const external = parseConfig({
      ...baseRawConfig,
      embedding: { provider: "openai-compatible", model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1/" },
    });
    assert.equal(resolveConfig(external, "test.yaml", process.cwd(), { env: {} }).embedding.baseUrl, "http://localhost:11434/v1");
  });

  it("rejects the removed ollama section instead of silently ignoring it (no backward compatibility)", () => {
    assert.throws(
      () => parseConfig({ ...baseRawConfig, ollama: { baseUrl: "http://localhost:11434", embeddingModel: "bge-m3" } }),
      /Invalid config file/,
    );
  });

  it("reads the embedding API key from RAG_EMBEDDING_API_KEY and never from the YAML", () => {
    const raw = parseConfig({
      ...baseRawConfig,
      embedding: { provider: "openai-compatible", model: "m", baseUrl: "https://api.example.com/v1" },
    });
    const resolved = resolveConfig(raw, "test.yaml", process.cwd(), {
      env: { RAG_EMBEDDING_API_KEY: "env-key" },
      embeddingApiKeyFilePath: "does-not-exist.secret",
    });
    assert.equal(resolved.embedding.apiKey, "env-key");
    assert.equal(resolved.embedding.apiKeySource, "env");
    assert.throws(() => parseConfig({ ...baseRawConfig, embedding: { provider: "builtin", apiKey: "x" } }));
  });
});
