import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { config } from "../src/config.js";
import { answerQuestion, RagQueryError } from "../src/rag.js";

describe("rag core", () => {
  it("NO_RELEVANT_CONTEXT reports the effective retrievalK in error details", async (t) => {
    const runtimeConfig = {
      ...config,
      retrievalK: 9,
      retrievalDistanceThreshold: 0.5,
    };

    t.mock.method(ChromaClient.prototype, "getCollection", async () => ({
      count: async () => 1,
    }) as any);

    t.mock.method(Chroma.prototype, "similaritySearchWithScore", async (_question: string, k: number) => {
      assert.equal(k, 2);

      return [[
        {
          metadata: {
            documentId: "doc-1",
          },
          pageContent: "irrelevant chunk",
        },
        0.9,
      ]] as any;
    });

    await assert.rejects(
      answerQuestion("thresholded question", {
        collectionName: "test-core-collection",
        runtimeConfig,
        retrievalK: 2,
      }),
      (error) => {
        assert.ok(error instanceof RagQueryError);
        assert.equal(error.code, "NO_RELEVANT_CONTEXT");
        assert.equal(error.details?.retrievalK, 2);
        assert.notEqual(error.details?.retrievalK, runtimeConfig.retrievalK);
        assert.equal(error.details?.distanceScoreThreshold, 0.5);
        return true;
      },
    );
  });
});
