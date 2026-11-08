import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { config } from "../src/config.js";
import path from "node:path";
import { answerQuestion, RagQueryError, retrieveSources, stripNoAnswerSignal } from "../src/rag.js";

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

describe("stripNoAnswerSignal", () => {
  it("removes exact and loosely formatted no-answer markers", () => {
    assert.equal(stripNoAnswerSignal("__NO_ANSWER_FROM_CONTEXT__"), "");
    assert.equal(stripNoAnswerSignal("**NO_ANSWER_FROM_CONTEXT**"), "");
    assert.equal(stripNoAnswerSignal("`no answer from context`."), "");
  });

  it("keeps the answer when a marker is appended to it", () => {
    assert.equal(
      stripNoAnswerSignal("Murat Karakaya üniversitede hocadır.\n\n**NO_ANSWER_FROM_CONTEXT**"),
      "Murat Karakaya üniversitede hocadır.",
    );
    assert.equal(stripNoAnswerSignal("Çanakkale 1915."), "Çanakkale 1915.");
  });
});

describe("retrieveSources", () => {
  it("returns source paths relative to the project root", async (t) => {
    const projectRoot = path.resolve("project-root");
    const runtimeConfig = { ...config, projectRoot, retrievalDistanceThreshold: 1 };

    t.mock.method(ChromaClient.prototype, "getCollection", async () => ({
      count: async () => 2,
    }) as any);
    t.mock.method(Chroma.prototype, "similaritySearchWithScore", async () => [
      [{ metadata: { documentId: "a", sourcePath: path.join(projectRoot, "data", "docs", "a.txt") }, pageContent: "a" }, 0.1],
      [{ metadata: { documentId: "b", sourcePath: path.resolve("elsewhere", "b.txt") }, pageContent: "b" }, 0.2],
    ] as any);

    const result = await retrieveSources("question", { collectionName: "test-core-collection", runtimeConfig });

    assert.deepEqual(result.sources.map((source) => source.sourcePath), [
      "data/docs/a.txt",
      path.resolve("elsewhere", "b.txt"),
    ]);
  });
});
