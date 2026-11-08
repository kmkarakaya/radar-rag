/**
 * Embedding providers and the built-in model catalog. Dependency-free so config validation can use it.
 *
 * - builtin: runs inside the backend process (transformers.js, CPU); the model is downloaded on first use.
 * - openai-compatible: any OpenAI-compatible /v1/embeddings API (Ollama, OpenAI, LM Studio, vLLM, ...).
 *
 * Every collection stores the provider and model it was indexed with; the configured default only
 * applies to new collections.
 */
export const EMBEDDING_PROVIDERS = ["builtin", "openai-compatible"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export type BuiltinEmbeddingModelSpec = {
  id: string;
  /** Quantization is fixed per catalog entry: a different dtype produces different vectors. */
  dtype: "q8";
  dimensions: number;
  /** Task prefixes recommended by the model card; fixed for the same reason. */
  queryPrefix: string;
  documentPrefix: string;
  /** Files (relative to the model folder in the cache) that must exist for the model to count as downloaded. */
  requiredFiles: string[];
  approxDownloadMb: number;
};

export const DEFAULT_BUILTIN_EMBEDDING_MODEL = "onnx-community/embeddinggemma-2-ONNX";

export const BUILTIN_EMBEDDING_MODELS: Record<string, BuiltinEmbeddingModelSpec> = {
  [DEFAULT_BUILTIN_EMBEDDING_MODEL]: {
    id: DEFAULT_BUILTIN_EMBEDDING_MODEL,
    dtype: "q8",
    dimensions: 768,
    queryPrefix: "task: search result | query: ",
    documentPrefix: "title: none | text: ",
    requiredFiles: ["config.json", "tokenizer.json", "onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"],
    approxDownloadMb: 346,
  },
};

export function getBuiltinEmbeddingModelSpec(model: string): BuiltinEmbeddingModelSpec | undefined {
  return BUILTIN_EMBEDDING_MODELS[model];
}

export function builtinEmbeddingModelIds(): string[] {
  return Object.keys(BUILTIN_EMBEDDING_MODELS);
}

export function isEmbeddingProvider(value: unknown): value is EmbeddingProvider {
  return typeof value === "string" && (EMBEDDING_PROVIDERS as readonly string[]).includes(value);
}
