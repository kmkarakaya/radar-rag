import type { ChatProviderStatus } from "./chat.js";
import type { ResolvedConfig } from "./config.js";

export type Capability = "retrieve" | "query" | "index";

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
    case "CHAT_NOT_CONFIGURED":
      return "Optional: to enable /query, run npm run onboard or set RAG_CHAT_BASE_URL and RAG_CHAT_MODEL (plus RAG_CHAT_API_KEY if the provider needs one).";
    case "CHAT_PROVIDER_UNREACHABLE":
      return `Check that the chat LLM is running and that chat.baseUrl (${runtimeConfig.chat.baseUrl}) is correct; it must point to an OpenAI-compatible API such as http://localhost:11434/v1.`;
    case "CHAT_PROVIDER_AUTH_FAILED":
      return "Check the chat API key: set RAG_CHAT_API_KEY or rerun npm run onboard to store it in .local/rag_chat_api_key.secret.";
    case "CHAT_MODEL_MISSING":
      return `Use a model offered by ${runtimeConfig.chat.baseUrl} (see details.availableModels) or pull it there, e.g. ollama pull ${runtimeConfig.chat.model} for a local Ollama.`;
    case "CHAT_MODEL_UNVERIFIED":
      return "The chat provider does not list its models, so the model name could not be verified; a failed /query will report the provider error.";
    case "EMBED_MODEL_MISSING":
      return `Pull the embedding model with: ollama pull ${runtimeConfig.ollamaEmbeddingModel}`;
    case "EMBED_SMOKE_FAILED":
      return "Verify Ollama embedding inference is working and that the embedding model can generate vectors.";
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

const CAPABILITY_LABELS: Record<Capability, { ready: string; notReady: string }> = {
  retrieve: { ready: "Ready to retrieve evidence.", notReady: "Not ready to retrieve evidence." },
  query: { ready: "Ready to serve RAG queries.", notReady: "Not ready to serve RAG queries." },
  index: {
    ready: "Ready to run indexing from the configured data source.",
    notReady: "Not ready to run indexing from the configured data source.",
  },
};

export const QUERY_DISABLED_SUMMARY =
  "Answer generation (/query) is disabled because no chat LLM is configured; retrieval and indexing work without it.";

export function capabilitySummary(capability: Capability, ready: boolean, blockers: ReadinessIssue[]): string {
  if (ready) {
    return CAPABILITY_LABELS[capability].ready;
  }

  const relevantBlockers = blockers.filter((issue) => issue.capabilities.includes(capability));
  if (relevantBlockers.length === 0) {
    return CAPABILITY_LABELS[capability].notReady;
  }

  return relevantBlockers.map((issue) => issue.message).join(" ");
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export type ChatReadiness = {
  code: string;
  status: "pass" | "fail" | "warn" | "skip";
  /** Blocking checks gate /query only; retrieval never depends on the chat LLM. */
  blocking: boolean;
  message: string;
  details: Record<string, unknown>;
};

/** Readiness of the optional chat LLM, from the free GET /models probe (see chat.ts). */
export function describeChatReadiness(status: ChatProviderStatus, runtimeConfig: ResolvedConfig): ChatReadiness {
  const chat = runtimeConfig.chat;
  const details = {
    baseUrl: status.baseUrl,
    model: status.model,
    latencyMs: status.latencyMs,
    httpStatus: status.httpStatus,
    error: status.error,
  };

  if (!status.configured) {
    return {
      code: "CHAT_NOT_CONFIGURED",
      status: "skip",
      blocking: false,
      message: QUERY_DISABLED_SUMMARY,
      details,
    };
  }
  if (!status.reachable) {
    return {
      code: "CHAT_PROVIDER_UNREACHABLE",
      status: "fail",
      blocking: true,
      message: `The chat LLM at ${chat.baseUrl} is not reachable. ${status.error ?? ""}`.trim(),
      details,
    };
  }
  if (!status.authOk) {
    return {
      code: "CHAT_PROVIDER_AUTH_FAILED",
      status: "fail",
      blocking: true,
      message: `The chat LLM at ${chat.baseUrl} rejected the API key.`,
      details,
    };
  }
  if (status.modelListed === false) {
    return {
      code: "CHAT_MODEL_MISSING",
      status: "fail",
      blocking: true,
      message: `Chat model ${chat.model} is not offered by ${chat.baseUrl}, so answer generation cannot run.`,
      details: { ...details, availableModels: status.availableModels },
    };
  }
  if (status.modelListed === "unknown") {
    return {
      code: "CHAT_MODEL_UNVERIFIED",
      status: "warn",
      blocking: false,
      message: `The chat LLM at ${chat.baseUrl} is reachable but does not list its models, so ${chat.model} could not be verified.`,
      details,
    };
  }
  return {
    code: "CHAT_MODEL_AVAILABLE",
    status: "pass",
    blocking: true,
    message: `Chat model ${chat.model} is available at ${chat.baseUrl}.`,
    details,
  };
}
