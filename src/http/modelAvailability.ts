import type { ResolvedConfig } from "../config.js";
import {
  builtinEmbeddingModelIds,
  checkEmbeddingTarget,
  connectionForTarget,
  type EmbeddingTarget,
} from "../embeddings/index.js";
import { HttpError } from "./errors.js";

/**
 * Fail fast before persisting a collection or starting an index job whose embedding cannot work,
 * instead of letting the job fail in the background. Never downloads a model or runs an embedding.
 *
 * - no model given / built-in model not in the catalog / model not offered by the service -> 422 UNAVAILABLE_MODEL
 * - openai-compatible chosen but embedding.baseUrl not set -> 422 EMBEDDING_PROVIDER_NOT_CONFIGURED
 * - embedding service unreachable or rejects the key -> 503 EMBEDDING_PROVIDER_UNREACHABLE
 *
 * A built-in model that is not downloaded yet is fine: it is downloaded at the start of indexing.
 */
export async function assertEmbeddingAvailable(input: {
  runtimeConfig: ResolvedConfig;
  /** Resolved with resolveEmbeddingTarget when the collection uses an embedding service. */
  target: EmbeddingTarget;
  /** Sentence prefix describing the blocked action, e.g. "Re-index cannot start." */
  action: string;
  check?: typeof checkEmbeddingTarget;
}): Promise<void> {
  const { runtimeConfig, target, action } = input;

  if (!target.model) {
    throw new HttpError(422, "UNAVAILABLE_MODEL", `${action} An embedding model is required for the ${target.provider} provider.`, {
      embeddingProvider: target.provider,
      recommendedActions: ["Set embeddingModel in the request."],
    });
  }

  const status = await (input.check ?? checkEmbeddingTarget)(runtimeConfig, target);
  const details = {
    embeddingProvider: target.provider,
    embeddingModel: target.model,
    ...(target.serviceId ? { embeddingServiceId: target.serviceId } : {}),
  };

  if (target.provider === "builtin") {
    if (!status.supported) {
      throw new HttpError(422, "UNAVAILABLE_MODEL", `${action} ${target.model} is not a supported built-in embedding model.`, {
        ...details,
        availableModels: builtinEmbeddingModelIds(),
        recommendedActions: [`Use one of: ${builtinEmbeddingModelIds().join(", ")}`],
      });
    }
    return;
  }

  if (!status.configured) {
    throw new HttpError(422, "EMBEDDING_PROVIDER_NOT_CONFIGURED", `${action} ${status.error ?? "No embedding service is configured."}`, {
      ...details,
      recommendedActions: [
        "Add an embedding service in the admin panel (Embedding services) or with POST /v1/admin/embedding-services, "
          + "or set RAG_EMBEDDING_BASE_URL / embedding.baseUrl; or use the builtin provider.",
      ],
    });
  }

  if (!status.reachable || status.authOk === false) {
    throw new HttpError(503, "EMBEDDING_PROVIDER_UNREACHABLE", `${action} ${status.error ?? "The embedding service is not reachable."}`, {
      ...details,
      embeddingBaseUrl: connectionForTarget(runtimeConfig, target)?.baseUrl ?? runtimeConfig.embedding.baseUrl,
      ...(status.httpStatus !== undefined ? { httpStatus: status.httpStatus } : {}),
    });
  }

  if (status.modelListed === false) {
    throw new HttpError(422, "UNAVAILABLE_MODEL", `${action} Embedding model '${target.model}' is not offered by the embedding service.`, {
      ...details,
      availableModels: status.availableModels ?? [],
      recommendedActions: [`Pick one of the available models, or pull it there (for Ollama: ollama pull ${target.model}).`],
    });
  }
}
