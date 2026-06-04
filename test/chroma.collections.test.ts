import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCreateCollectionRequest,
  normalizeChromaCollectionConfiguration,
} from "../src/collections/chromaCollections.js";

describe("chroma collection helpers", () => {
  it("preserves the registry chroma configuration in the create request", () => {
    const request = buildCreateCollectionRequest({
      name: "rag_default_test-collection-abcdef1234_20260604t120000_001z",
      chromaConfiguration: {
        hnsw: {
          space: "cosine",
          ef_construction: 128,
        },
      },
    });

    assert.equal(request.name, "rag_default_test-collection-abcdef1234_20260604t120000_001z");
    assert.equal(request.embeddingFunction, null);
    assert.deepEqual(request.configuration, {
      hnsw: {
        space: "cosine",
        ef_construction: 128,
      },
    });
  });

  it("rejects invalid physical collection names before calling Chroma", () => {
    assert.throws(
      () => buildCreateCollectionRequest({
        name: "ab",
        chromaConfiguration: { hnsw: { space: "l2" } },
      }),
      /invalid/i,
    );
  });

  it("forces configuration.hnsw.space to match the selected distance metric", () => {
    const configuration = normalizeChromaCollectionConfiguration({
      distanceMetric: "cosine",
      chromaConfiguration: {
        hnsw: {
          space: "l2",
          ef_construction: 128,
        },
        custom: {
          preserved: true,
        },
      },
    });

    assert.deepEqual(configuration, {
      hnsw: {
        space: "cosine",
        ef_construction: 128,
      },
      custom: {
        preserved: true,
      },
    });
  });
});