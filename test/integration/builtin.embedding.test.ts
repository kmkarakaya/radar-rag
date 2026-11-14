import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config } from "../../src/config.js";
import { BuiltinEmbeddings, isBuiltinModelCached } from "../../src/embeddings/builtin.js";
import { DEFAULT_BUILTIN_EMBEDDING_MODEL, getBuiltinEmbeddingModelSpec } from "../../src/embeddings/models.js";

// Real built-in model: downloads ~350 MB into embedding.cacheDir on the first run, so it is opt-in.
const enabled = process.env.RAG_TEST_BUILTIN === "1";

describe("built-in embedding model (RAG_TEST_BUILTIN=1)", { skip: !enabled && "set RAG_TEST_BUILTIN=1 to download and run the real built-in model" }, () => {
  it("embeds queries and documents into normalized vectors that rank the relevant text first", async () => {
    const spec = getBuiltinEmbeddingModelSpec(DEFAULT_BUILTIN_EMBEDDING_MODEL);
    assert.ok(spec);
    const embeddings = new BuiltinEmbeddings({ model: DEFAULT_BUILTIN_EMBEDDING_MODEL, cacheDir: config.embedding.cacheDir });

    const [relevant, unrelated] = await embeddings.embedDocuments([
      "Murat Karakaya üniversitede hocadır.",
      "Çanakkale geçilmez, düşman kalesine yaklaşamaz.",
    ]);
    const query = await embeddings.embedQuery("Murat Karakaya kimdir?");

    assert.equal(query.length, spec.dimensions);
    assert.ok(Math.abs(Math.hypot(...query) - 1) < 1e-6);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    assert.ok(dot(query, relevant) > dot(query, unrelated));
    assert.equal(isBuiltinModelCached(DEFAULT_BUILTIN_EMBEDDING_MODEL, config.embedding.cacheDir), true);
  });
});
