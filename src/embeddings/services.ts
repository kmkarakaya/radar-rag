import { normalizeEmbeddingServiceId } from "../collections/indexState.js";
import type { CollectionRegistry, EmbeddingService, RequestContext } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import {
  connectionForTarget,
  serverEmbeddingConnection,
  SERVER_EMBEDDING_SERVICE_ID,
  type EmbeddingConnection,
  type EmbeddingTarget,
} from "./index.js";

/** The connection of a service stored through the embedding services API. */
export function serviceConnection(service: EmbeddingService): EmbeddingConnection {
  return {
    serviceId: service.id,
    baseUrl: service.baseUrl,
    apiKey: service.apiKey,
    version: service.updatedAt,
  };
}

export function deletedServiceMessage(serviceId: string): string {
  return `The embedding service "${serviceId}" does not exist (it may have been deleted). `
    + "Pick another embedding service for this collection and re-index.";
}

/**
 * Turns a collection's embedding (provider, model, service id) into a target with its connection.
 * builtin needs none; "server" (or no id) is the service from .env / config; any other id is read from
 * the tenant's embedding services. A missing service yields connection: null, never the "server" one,
 * so documents are never sent to a service the collection did not choose.
 */
export async function resolveEmbeddingTarget(input: {
  registry?: Pick<CollectionRegistry, "getEmbeddingService">;
  runtimeConfig: ResolvedConfig;
  context: RequestContext;
  target: EmbeddingTarget;
}): Promise<EmbeddingTarget> {
  const { target } = input;
  if (target.provider !== "openai-compatible") {
    return { provider: target.provider, model: target.model };
  }

  const serviceId = normalizeEmbeddingServiceId(target.provider, target.serviceId) ?? SERVER_EMBEDDING_SERVICE_ID;
  if (serviceId === SERVER_EMBEDDING_SERVICE_ID) {
    return { provider: target.provider, model: target.model, serviceId, connection: serverEmbeddingConnection(input.runtimeConfig) };
  }

  const service = input.registry ? await input.registry.getEmbeddingService(input.context, serviceId) : null;
  if (!service) {
    return {
      provider: target.provider,
      model: target.model,
      serviceId,
      connection: null,
      connectionError: deletedServiceMessage(serviceId),
    };
  }
  return { provider: target.provider, model: target.model, serviceId, connection: serviceConnection(service) };
}

/** The API key to redact from errors of this target (the service's key, not only the config one). */
export function targetApiKey(runtimeConfig: ResolvedConfig, target: EmbeddingTarget): string | undefined {
  return connectionForTarget(runtimeConfig, target)?.apiKey;
}
