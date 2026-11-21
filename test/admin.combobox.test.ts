import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";

type FilterOptions = (options: unknown, query: unknown, settings?: { showAll?: boolean }) => string[];

// The panel module is plain browser JavaScript without DOM access at import time; loaded by URL so the
// TypeScript check does not need declarations for it.
let filterOptions: FilterOptions;

before(async () => {
  const url = pathToFileURL(path.resolve(process.cwd(), "admin", "js", "combobox.js")).href;
  ({ filterOptions } = await import(url) as { filterOptions: FilterOptions });
});

const MODELS = ["bge-m3:latest", "Qwen3-Embedding-8B-mxfp8", "nomic-embed-text:latest", "gemma3:4b"];

describe("admin model combobox filterOptions", () => {
  it("lists every model for an empty query", () => {
    assert.deepEqual(filterOptions(MODELS, ""), MODELS);
    assert.deepEqual(filterOptions(MODELS, "   "), MODELS);
    assert.deepEqual(filterOptions(MODELS, undefined), MODELS);
  });

  it("matches anywhere in the name, ignoring case", () => {
    assert.deepEqual(filterOptions(MODELS, "EMBED"), ["Qwen3-Embedding-8B-mxfp8", "nomic-embed-text:latest"]);
    assert.deepEqual(filterOptions(MODELS, "latest"), ["bge-m3:latest", "nomic-embed-text:latest"]);
  });

  it("gives nothing when no name matches (a model of another provider in the field)", () => {
    assert.deepEqual(filterOptions(MODELS, "onnx-community/embeddinggemma-2-ONNX"), []);
  });

  it("lists every model when asked, or when the query is exactly one of them", () => {
    assert.deepEqual(filterOptions(MODELS, "qwen", { showAll: true }), MODELS);
    assert.deepEqual(filterOptions(MODELS, "gemma3:4b"), MODELS);
    assert.deepEqual(filterOptions(MODELS, "GEMMA3:4B"), MODELS);
  });

  it("drops duplicates, blanks and non-strings, keeping the server's order", () => {
    assert.deepEqual(filterOptions(["b", " a ", "b", "", null, 3, "c"], ""), ["b", "a", "c"]);
    assert.deepEqual(filterOptions(null, "x"), []);
  });
});
