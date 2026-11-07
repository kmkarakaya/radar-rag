import type { ResolvedConfig } from "../config.js";
import { getOllamaModelDiscovery, hasConfiguredModel, type OllamaModelDiscovery } from "../rag.js";
import { HttpError } from "./errors.js";

export type RequiredOllamaModel = {
  role: "embedding" | "chat";
  name: string;
};

export type OllamaModelDiscoveryFn = (runtimeConfig: ResolvedConfig) => Promise<OllamaModelDiscovery>;

const ROLE_LABEL: Record<RequiredOllamaModel["role"], string> = {
  embedding: "Embedding model",
  chat: "Chat model",
};

/**
 * Fail fast before persisting a collection or starting an index job whose
 * Ollama models are missing, instead of letting the job fail in the background.
 *
 * - Ollama unreachable  -> 503 OLLAMA_UNREACHABLE
 * - any model missing   -> 422 UNAVAILABLE_MODEL (details list missing + available models)
 */
export async function assertOllamaModelsAvailable(input: {
  runtimeConfig: ResolvedConfig;
  required: RequiredOllamaModel[];
  /** Sentence prefix describing the blocked action, e.g. "Re-index cannot start." */
  action: string;
  discover?: OllamaModelDiscoveryFn;
}): Promise<void> {
  const { runtimeConfig, required, action } = input;
  const discover = input.discover ?? getOllamaModelDiscovery;

  let discovery: OllamaModelDiscovery;
  try {
    discovery = await discover(runtimeConfig);
  } catch (error) {
    discovery = {
      reachable: false,
      models: [],
      embeddingModels: [],
      chatModels: [],
      defaults: {
        embeddingModel: runtimeConfig.ollamaEmbeddingModel,
        chatModel: runtimeConfig.ollamaChatModel,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!discovery.reachable) {
    throw new HttpError(
      503,
      "OLLAMA_UNREACHABLE",
      `${action} Ollama is not reachable at ${runtimeConfig.ollamaBaseUrl}.`,
      {
        ollamaBaseUrl: runtimeConfig.ollamaBaseUrl,
        ...(discovery.error ? { error: discovery.error } : {}),
      },
    );
  }

  const missing = required.filter((model) => !hasConfiguredModel(discovery.models, model.name));
  if (missing.length === 0) {
    return;
  }

  const recommendedActions = [...new Set(missing.map((model) => `ollama pull ${model.name}`))];
  const description = missing
    .map((model) => `${ROLE_LABEL[model.role]} '${model.name}' is not available in Ollama.`)
    .join(" ");

  throw new HttpError(
    422,
    "UNAVAILABLE_MODEL",
    `${action} ${description} Run: ${recommendedActions.join(" && ")}`,
    {
      missingModels: missing,
      availableModels: discovery.models,
      recommendedActions,
    },
  );
}
