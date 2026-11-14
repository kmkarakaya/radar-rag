import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { ChatOpenAICompletions } from "@langchain/openai";
import { config, type ResolvedConfig } from "../src/config.js";
import { BuiltinEmbeddings } from "../src/embeddings/builtin.js";
import path from "node:path";
import {
  answerQuestion,
  buildSystemPrompt,
  RagQueryError,
  retrieveSources,
  selectSourcesForGeneration,
  stripNoAnswerSignal,
  type RagSource,
} from "../src/rag.js";

// Query embedding is stubbed: these tests never download the built-in model.
mock.method(BuiltinEmbeddings.prototype, "embedQuery", async () => [0.1, 0.2, 0.3]);
const EMBEDDING = { embeddingProvider: "builtin" as const, embeddingModel: "onnx-community/embeddinggemma-2-ONNX" };

const chatEnabledConfig: ResolvedConfig = {
  ...config,
  chat: {
    enabled: true,
    baseUrl: "http://chat.test/v1",
    model: "test-model",
    apiKey: "secret-key-123",
    apiKeySource: "env",
    temperature: undefined,
    maxTokens: undefined,
    maxContextTokens: undefined,
  },
};

describe("rag core", () => {
  it("NO_RELEVANT_CONTEXT reports the effective retrievalK in error details", async (t) => {
    const runtimeConfig = {
      ...chatEnabledConfig,
      retrievalK: 9,
      retrievalDistanceThreshold: 0.5,
    };

    t.mock.method(ChromaClient.prototype, "getCollection", async () => ({
      count: async () => 1,
    }) as any);

    t.mock.method(Chroma.prototype, "similaritySearchVectorWithScore", async (_vector: number[], k: number) => {
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
        collectionName: "test-core-collection", ...EMBEDDING,
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
    t.mock.method(Chroma.prototype, "similaritySearchVectorWithScore", async () => [
      [{ metadata: { documentId: "a", sourcePath: path.join(projectRoot, "data", "docs", "a.txt") }, pageContent: "a" }, 0.1],
      [{ metadata: { documentId: "b", sourcePath: path.resolve("elsewhere", "b.txt") }, pageContent: "b" }, 0.2],
    ] as any);

    const result = await retrieveSources("question", { collectionName: "test-core-collection", ...EMBEDDING, runtimeConfig });

    assert.deepEqual(result.sources.map((source) => source.sourcePath), [
      "data/docs/a.txt",
      path.resolve("elsewhere", "b.txt"),
    ]);
  });
});

describe("answer generation with the optional chat LLM", () => {
  function mockRetrieval(t: { mock: { method: (...args: any[]) => unknown } }) {
    t.mock.method(ChromaClient.prototype, "getCollection", async () => ({ count: async () => 1 }) as any);
    t.mock.method(Chroma.prototype, "similaritySearchVectorWithScore", async () => [
      [{ metadata: { documentId: "doc-1", sourcePath: "data/a.txt" }, pageContent: "Murat Karakaya is a professor." }, 0.1],
    ] as any);
  }

  it("rejects /query with CHAT_NOT_CONFIGURED when no chat LLM is configured", async () => {
    await assert.rejects(
      answerQuestion("q", { collectionName: "c", ...EMBEDDING, runtimeConfig: { ...config, chat: { ...chatEnabledConfig.chat, enabled: false } } }),
      (error) => {
        assert.ok(error instanceof RagQueryError);
        assert.equal(error.code, "CHAT_NOT_CONFIGURED");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
  });

  it("returns the generated answer and the global chat model", async (t) => {
    mockRetrieval(t);
    t.mock.method(ChatOpenAICompletions.prototype, "invoke", async () => ({ content: "He is a professor." }) as any);

    const result = await answerQuestion("Who is Murat Karakaya?", { collectionName: "c", ...EMBEDDING, runtimeConfig: chatEnabledConfig });
    assert.equal(result.answer, "He is a professor.");
    assert.equal(result.chatModel, "test-model");
    assert.equal(result.sources.length, 1);
  });

  it("maps provider and connection failures to clear errors without leaking the API key", async (t) => {
    mockRetrieval(t);
    const invoke = t.mock.method(ChatOpenAICompletions.prototype, "invoke", async () => {
      throw Object.assign(new Error("Incorrect API key provided: secret-key-123"), { status: 401 });
    });

    await assert.rejects(answerQuestion("q", { collectionName: "c", ...EMBEDDING, runtimeConfig: chatEnabledConfig }), (error) => {
      assert.ok(error instanceof RagQueryError);
      assert.equal(error.code, "CHAT_PROVIDER_ERROR");
      assert.equal(error.statusCode, 502);
      assert.equal(error.details?.upstreamStatus, 401);
      assert.ok(!JSON.stringify({ message: error.message, details: error.details }).includes("secret-key-123"));
      return true;
    });

    invoke.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    });
    await assert.rejects(answerQuestion("q", { collectionName: "c", ...EMBEDDING, runtimeConfig: chatEnabledConfig }), (error) => {
      assert.ok(error instanceof RagQueryError);
      assert.equal(error.code, "CHAT_PROVIDER_UNREACHABLE");
      assert.equal(error.statusCode, 503);
      return true;
    });
  });
});

describe("generation context and prompt", () => {
  const sources: RagSource[] = Array.from({ length: 5 }, (_, index) => ({
    documentId: `doc-${index}`,
    content: "x".repeat(400),
  }));

  it("sends every retrieved source unless chat.maxContextTokens caps it", () => {
    assert.equal(selectSourcesForGeneration(sources, chatEnabledConfig).length, 5);

    const capped = { ...chatEnabledConfig, chat: { ...chatEnabledConfig.chat, maxContextTokens: 700 } };
    const selected = selectSourcesForGeneration(sources, capped);
    assert.ok(selected.length >= 1 && selected.length < 5);
  });

  it("uses a domain-neutral grounding prompt", () => {
    const prompt = buildSystemPrompt(sources.slice(0, 1));
    assert.doesNotMatch(prompt, /tax|ruling|Turkish/i);
    assert.match(prompt, /__NO_ANSWER_FROM_CONTEXT__/);
    assert.match(prompt, /language of the question/);
  });
});
