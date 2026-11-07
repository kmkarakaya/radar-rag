import type { ResolvedConfig } from "./config.js";

export type Capability = "query" | "index";

export type ReadinessIssue = {
  code: string;
  capabilities: Capability[];
  message: string;
  details?: Record<string, unknown>;
  recommendedAction?: string;
};

export function recommendedActionFor(code: string, runtimeConfig: ResolvedConfig): string | undefined {
  switch (code) {
    case "CHROMA_UNREACHABLE":
      return "Start Chroma and verify config/rag.config.yaml chroma.url is correct.";
    case "COLLECTION_MISSING":
    case "COLLECTION_EMPTY":
      return "Run npm run index to create or populate the Chroma collection before sending RAG queries.";
    case "COLLECTION_STATE_UNREADABLE":
      return "Inspect the Chroma collection state and verify the collection can be counted.";
    case "OLLAMA_UNREACHABLE":
      return "Start Ollama and verify config/rag.config.yaml ollama.baseUrl is correct.";
    case "REGISTRY_UNREACHABLE":
      return "Verify SQLite registry database file path is accessible and not corrupted.";
    case "CHAT_MODEL_MISSING":
      return `Pull the chat model with: ollama pull ${runtimeConfig.ollamaChatModel}`;
    case "EMBED_MODEL_MISSING":
      return `Pull the embedding model with: ollama pull ${runtimeConfig.ollamaEmbeddingModel}`;
    case "EMBED_SMOKE_FAILED":
      return "Verify Ollama embedding inference is working and that the embedding model can generate vectors.";
    case "CHAT_SMOKE_FAILED":
      return "Verify Ollama chat generation can load the configured model. If Ollama reports memory allocation errors, reduce config/rag.config.yaml ollama.numCtx, ollama.numPredict, or collectionDefaults.retrievalK, then restart Ollama and the backend.";
    case "INDEXING_SOURCE_UNREADABLE":
      return "Verify config/rag.config.yaml collectionDefaults.sourcePath points to a readable file or directory.";
    case "NO_INDEXABLE_DOCUMENTS":
      return "Verify the configured indexing source contains supported files with non-empty document content before running indexing.";
    case "COLLECTION_CHUNK_OVERLAP_INVALID":
      return "Reduce chunkOverlap so it stays smaller than chunkSize before saving or re-indexing.";
    case "COLLECTION_NO_ACTIVE_PHYSICAL_COLLECTION":
      return "Run re-index for this collection.";
    case "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE":
      return "Inspect the active physical collection in Chroma and re-index if it is stale or corrupted.";
    case "COLLECTION_INDEX_JOB_ACTIVE":
      return "Wait for the current indexing job to finish before changing settings or starting another re-index.";
    default:
      return undefined;
  }
}

export function capabilitySummary(capability: Capability, ready: boolean, blockers: ReadinessIssue[]): string {
  if (ready) {
    return capability === "query"
      ? "Ready to serve RAG queries."
      : "Ready to run indexing from the configured data source.";
  }

  const relevantBlockers = blockers.filter((issue) => issue.capabilities.includes(capability));
  if (relevantBlockers.length === 0) {
    return capability === "query"
      ? "Not ready to serve RAG queries."
      : "Not ready to run indexing from the configured data source.";
  }

  return relevantBlockers.map((issue) => issue.message).join(" ");
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}
