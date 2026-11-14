import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyConfigEnvOverrides, loadConfig, parseConfig, readConfigFile } from "../src/config.js";

describe("config defaults (the config file is optional)", () => {
  it("treats a missing config file as an empty config and resolves every setting to its default", () => {
    const missing = path.join(os.tmpdir(), `rag-missing-${process.pid}-${Date.now()}.yaml`);
    assert.deepEqual(readConfigFile(missing), {});

    const resolved = loadConfig(missing, {});
    assert.equal(resolved.port, 3010);
    assert.equal(resolved.chromaUrl, "http://localhost:8000");
    assert.equal(resolved.registryPath, path.resolve(process.cwd(), "data/registry.sqlite"));
    assert.equal(resolved.collectionDefaults.sourcePath, path.resolve(process.cwd(), "data"));
    assert.equal(resolved.chunkSize, 500);
    assert.equal(resolved.chunkOverlap, 200);
    assert.equal(resolved.embedding.provider, "builtin");
    assert.equal(resolved.chat.enabled, false);
    assert.equal(resolved.adminAuth.enabled, false);
    assert.equal(resolved.sampleCollectionEnabled, true);
  });

  it("turns the sample collection off with sampleCollection.enabled or RAG_SAMPLE_COLLECTION", () => {
    assert.equal(parseConfig({ sampleCollection: { enabled: false } }).sampleCollection.enabled, false);

    const overridden = parseConfig(applyConfigEnvOverrides({}, { RAG_SAMPLE_COLLECTION: "false" }));
    assert.equal(overridden.sampleCollection.enabled, false);
    const enabled = parseConfig(applyConfigEnvOverrides({ sampleCollection: { enabled: false } }, { RAG_SAMPLE_COLLECTION: "TRUE" }));
    assert.equal(enabled.sampleCollection.enabled, true);

    assert.throws(() => applyConfigEnvOverrides({}, { RAG_SAMPLE_COLLECTION: "yes" }), /RAG_SAMPLE_COLLECTION: expected true or false/);
  });

  it("still validates the defaults together (chunkOverlap must stay below chunkSize)", () => {
    assert.throws(() => parseConfig({ collectionDefaults: { chunkSize: 100 } }), /chunkOverlap must be smaller than chunkSize/);
  });
});
