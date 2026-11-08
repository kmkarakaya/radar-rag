import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { config, type ResolvedConfig } from "../src/config.js";
import {
  BuiltinEmbeddings,
  clearLoadedBuiltinModels,
  isBuiltinModelCached,
  type BuiltinModelLoader,
} from "../src/embeddings/builtin.js";
import {
  checkEmbeddingTarget,
  clearEmbeddingInstances,
  DEFAULT_BUILTIN_EMBEDDING_MODEL,
  getEmbeddings,
} from "../src/embeddings/index.js";
import { clearProviderStatusCache } from "../src/providers/openaiCompatible.js";
import { RagQueryError, retrieveSources } from "../src/rag.js";

const BUILTIN = DEFAULT_BUILTIN_EMBEDDING_MODEL;

function externalConfig(overrides: Partial<ResolvedConfig["embedding"]> = {}): ResolvedConfig {
  return {
    ...config,
    embedding: {
      ...config.embedding,
      provider: "openai-compatible",
      model: "nomic-embed-text",
      baseUrl: "http://embed.test/v1",
      apiKey: "secret-embed-key",
      apiKeySource: "env",
      ...overrides,
    },
  };
}

afterEach(() => {
  clearLoadedBuiltinModels();
  clearEmbeddingInstances();
  clearProviderStatusCache();
});

describe("BuiltinEmbeddings", () => {
  function recordingLoader(calls: string[][], loads: { count: number }): BuiltinModelLoader {
    return async () => {
      loads.count += 1;
      return {
        async embed(texts) {
          calls.push(texts);
          return texts.map((_, index) => [index, 1]);
        },
      };
    };
  }

  it("adds the model's query and document prefixes and embeds documents in small batches", async () => {
    const calls: string[][] = [];
    const loads = { count: 0 };
    const embeddings = new BuiltinEmbeddings({ model: BUILTIN, cacheDir: "unused", loader: recordingLoader(calls, loads), batchSize: 2 });

    const vectors = await embeddings.embedDocuments(["a", "b", "c"]);
    const query = await embeddings.embedQuery("q");

    assert.equal(vectors.length, 3);
    assert.deepEqual(calls, [
      ["title: none | text: a", "title: none | text: b"],
      ["title: none | text: c"],
      ["task: search result | query: q"],
    ]);
    assert.deepEqual(query, [0, 1]);
    assert.equal(loads.count, 1);
  });

  it("loads a model once even when requests arrive together", async () => {
    const loads = { count: 0 };
    const loader = recordingLoader([], loads);
    const a = new BuiltinEmbeddings({ model: BUILTIN, cacheDir: "same", loader });
    const b = new BuiltinEmbeddings({ model: BUILTIN, cacheDir: "same", loader });
    await Promise.all([a.embedQuery("x"), b.embedQuery("y"), a.embedDocuments(["z"])]);
    assert.equal(loads.count, 1);
  });

  it("rejects models outside the built-in catalog", () => {
    assert.throws(() => new BuiltinEmbeddings({ model: "not-in-catalog", cacheDir: "x" }), /not a supported built-in embedding model/);
  });

  it("knows whether a model is already downloaded, without loading it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rag-model-cache-"));
    try {
      assert.equal(isBuiltinModelCached(BUILTIN, dir), false);
      const modelDir = path.join(dir, ...BUILTIN.split("/"));
      await mkdir(path.join(modelDir, "onnx"), { recursive: true });
      for (const file of ["config.json", "tokenizer.json", "onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"]) {
        await writeFile(path.join(modelDir, file), "x");
      }
      assert.equal(isBuiltinModelCached(BUILTIN, dir), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("openai-compatible embeddings", () => {
  it("sends float encoding (local servers may not support base64) to the configured base URL", async () => {
    const requests: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
        model: "nomic-embed-text",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const embeddings = getEmbeddings(externalConfig(), { provider: "openai-compatible", model: "nomic-embed-text" }, { fetch: fakeFetch });
    assert.deepEqual(await embeddings.embedQuery("hello"), [0.1, 0.2]);
    assert.equal(requests[0].url, "http://embed.test/v1/embeddings");
    assert.equal(requests[0].auth, "Bearer secret-embed-key");
    assert.equal(requests[0].body.encoding_format, "float");
    assert.equal(requests[0].body.model, "nomic-embed-text");
  });

  it("reports an unconfigured service and a missing model without sending an embedding", async () => {
    const notConfigured = await checkEmbeddingTarget(externalConfig({ baseUrl: "" }), { provider: "openai-compatible", model: "m" });
    assert.equal(notConfigured.configured, false);
    assert.equal(notConfigured.ok, false);

    const listing = (async () => new Response(JSON.stringify({ data: [{ id: "other" }] }), { status: 200 })) as unknown as typeof fetch;
    const missing = await checkEmbeddingTarget(externalConfig(), { provider: "openai-compatible", model: "nomic-embed-text" }, { fetch: listing });
    assert.equal(missing.modelListed, false);
    assert.deepEqual(missing.availableModels, ["other"]);

    const builtin = await checkEmbeddingTarget(config, { provider: "builtin", model: BUILTIN });
    assert.equal(builtin.supported, true);
    assert.equal(builtin.ok, true);
  });
});

describe("retrieval error mapping", () => {
  function mockStoredCollection(t: { mock: { method: (...args: any[]) => unknown } }) {
    t.mock.method(ChromaClient.prototype, "getCollection", async () => ({ count: async () => 1 }) as any);
  }

  it("turns a Chroma dimension mismatch into 409 EMBEDDING_DIMENSION_MISMATCH instead of a 500", async (t) => {
    mockStoredCollection(t);
    t.mock.method(BuiltinEmbeddings.prototype, "embedQuery", async () => [0.1, 0.2]);
    t.mock.method(Chroma.prototype, "similaritySearchVectorWithScore", async () => {
      throw new Error("Bad request to http://localhost:8000/api/v2/.../query with status: Collection expecting embedding with dimension of 768, got 1024");
    });

    await assert.rejects(
      retrieveSources("q", { collectionName: "c", runtimeConfig: config, embeddingProvider: "builtin", embeddingModel: BUILTIN }),
      (error) => {
        assert.ok(error instanceof RagQueryError);
        assert.equal(error.code, "EMBEDDING_DIMENSION_MISMATCH");
        assert.equal(error.statusCode, 409);
        assert.equal(error.details?.expectedDimensions, 768);
        assert.equal(error.details?.gotDimensions, 1024);
        return true;
      },
    );
  });

  it("maps embedding service failures and a missing service without leaking the API key", async (t) => {
    mockStoredCollection(t);
    const runtimeConfig = externalConfig();
    const embeddings = getEmbeddings(runtimeConfig, { provider: "openai-compatible", model: "nomic-embed-text" });
    const embedQuery = t.mock.method(embeddings, "embedQuery", async () => {
      throw Object.assign(new Error("Incorrect API key provided: secret-embed-key"), { status: 401 });
    });

    await assert.rejects(
      retrieveSources("q", { collectionName: "c", runtimeConfig, embeddingProvider: "openai-compatible", embeddingModel: "nomic-embed-text" }),
      (error) => {
        assert.ok(error instanceof RagQueryError);
        assert.equal(error.code, "EMBEDDING_PROVIDER_ERROR");
        assert.equal(error.statusCode, 502);
        assert.ok(!JSON.stringify({ m: error.message, d: error.details }).includes("secret-embed-key"));
        return true;
      },
    );

    embedQuery.mock.mockImplementation(async () => {
      throw Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    });
    await assert.rejects(
      retrieveSources("q", { collectionName: "c", runtimeConfig, embeddingProvider: "openai-compatible", embeddingModel: "nomic-embed-text" }),
      (error) => error instanceof RagQueryError && error.code === "EMBEDDING_PROVIDER_UNREACHABLE" && error.statusCode === 503,
    );

    await assert.rejects(
      retrieveSources("q", {
        collectionName: "c",
        runtimeConfig: externalConfig({ baseUrl: "" }),
        embeddingProvider: "openai-compatible",
        embeddingModel: "nomic-embed-text",
      }),
      (error) => error instanceof RagQueryError && error.code === "EMBEDDING_PROVIDER_NOT_CONFIGURED",
    );
  });
});
