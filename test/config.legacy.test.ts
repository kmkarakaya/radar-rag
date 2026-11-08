import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig } from "../src/config.js";

const baseRawConfig = {
  server: { port: 3010 },
  registry: { path: "data/registry.sqlite" },
  chroma: { url: "http://localhost:8000" },
  ollama: {
    baseUrl: "http://localhost:11434",
    embeddingModel: "bge-m3",
  },
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
