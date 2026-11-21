import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { RagCollection } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import {
  checkOpenAICompatibleProvider,
  PLACEHOLDER_API_KEY,
  type FetchLike,
} from "../providers/openaiCompatible.js";
import { BuiltinEmbeddings, isBuiltinModelCached } from "./builtin.js";
import {
  builtinEmbeddingModelIds,
  getBuiltinEmbeddingModelSpec,
  SERVER_EMBEDDING_SERVICE_ID,
  type EmbeddingProvider,
} from "./models.js";

export { BuiltinModelLoadError, clearLoadedBuiltinModels, closeBuiltinModels, isBuiltinModelCached } from "./builtin.js";
export * from "./models.js";

/** A resolved connection to an OpenAI-compatible embedding API. */
export type EmbeddingConnection = {
  serviceId: string;
  baseUrl: string;
  apiKey?: string;
  /** Changes whenever the URL or key changes, so cached clients and checks are never reused for a new setting. */
  version: string;
};

/** The embedding a collection is indexed with (and must be queried with). */
export type EmbeddingTarget = {
  provider: EmbeddingProvider;
  model: string;
  /** openai-compatible: the collection's embedding service (null/undefined = "server"). */
  serviceId?: string | null;
  /**
   * The resolved connection (see resolveEmbeddingTarget). undefined = the "server" service from config;
   * null = no usable connection (for example a deleted service), never a silent fallback to "server".
   */
  connection?: EmbeddingConnection | null;
  /** Why connection is null; shown in the not-configured error. */
  connectionError?: string;
};

const NOT_CONFIGURED_MESSAGE = "No embedding service is configured for this collection: add one in the admin panel "
  + "(Embedding services, or POST /v1/admin/embedding-services) or set RAG_EMBEDDING_BASE_URL / embedding.baseUrl.";

/** Thrown when an openai-compatible collection has no usable embedding service. */
export class EmbeddingProviderNotConfiguredError extends Error {
  constructor(message: string = NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = "EmbeddingProviderNotConfiguredError";
  }
}

/** The embedding a collection's active index was built with (reads must use exactly this). */
export function activeEmbeddingTarget(
  collection: Pick<
    RagCollection,
    "embeddingProvider" | "embeddingModel" | "activeEmbeddingProvider" | "activeEmbeddingModel" | "embeddingServiceId" | "activeEmbeddingServiceId"
  >,
): EmbeddingTarget {
  const hasActive = Boolean(collection.activeEmbeddingProvider);
  return {
    provider: collection.activeEmbeddingProvider ?? collection.embeddingProvider,
    model: collection.activeEmbeddingModel ?? collection.embeddingModel,
    serviceId: hasActive ? collection.activeEmbeddingServiceId ?? null : collection.embeddingServiceId ?? null,
  };
}

/** The embedding a collection's next re-index will use. */
export function desiredEmbeddingTarget(
  collection: Pick<RagCollection, "embeddingProvider" | "embeddingModel" | "embeddingServiceId">,
): EmbeddingTarget {
  return {
    provider: collection.embeddingProvider,
    model: collection.embeddingModel,
    serviceId: collection.embeddingServiceId ?? null,
  };
}

export function defaultEmbeddingTarget(runtimeConfig: ResolvedConfig): EmbeddingTarget {
  return { provider: runtimeConfig.embedding.provider, model: runtimeConfig.embedding.model };
}

/** The "server" service (embedding.baseUrl / RAG_EMBEDDING_BASE_URL), or null when none is configured. */
export function serverEmbeddingConnection(runtimeConfig: ResolvedConfig): EmbeddingConnection | null {
  const embedding = runtimeConfig.embedding;
  if (!embedding.baseUrl) return null;
  return {
    serviceId: SERVER_EMBEDDING_SERVICE_ID,
    baseUrl: embedding.baseUrl,
    apiKey: embedding.apiKey,
    version: `config:${embedding.apiKeySource}`,
  };
}

/** The connection an openai-compatible target uses; never falls back to "server" for a named service. */
export function connectionForTarget(runtimeConfig: ResolvedConfig, target: EmbeddingTarget): EmbeddingConnection | null {
  if (target.connection !== undefined) return target.connection;
  if (target.serviceId && target.serviceId !== SERVER_EMBEDDING_SERVICE_ID) return null;
  return serverEmbeddingConnection(runtimeConfig);
}

function notConfiguredError(target: EmbeddingTarget): EmbeddingProviderNotConfiguredError {
  return new EmbeddingProviderNotConfiguredError(target.connectionError ?? NOT_CONFIGURED_MESSAGE);
}

function createOpenAICompatibleEmbeddings(
  runtimeConfig: ResolvedConfig,
  target: EmbeddingTarget,
  fetchImpl?: FetchLike,
): OpenAIEmbeddings {
  const connection = connectionForTarget(runtimeConfig, target);
  if (!connection) {
    throw notConfiguredError(target);
  }

  const baseFetch = fetchImpl ?? fetch;
  return new OpenAIEmbeddings({
    model: target.model,
    apiKey: connection.apiKey ?? PLACEHOLDER_API_KEY,
    configuration: {
      baseURL: connection.baseUrl,
      // Redirects are not followed (as in the GET /models checks): document text and the key only go to the
      // URL the admin entered; a redirect fails as an HTTP error instead.
      fetch: ((url: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) =>
        baseFetch(url, { ...init, redirect: "manual" })) as FetchLike,
    },
    // The SDK defaults to base64, which some local servers do not support.
    encodingFormat: "float",
    stripNewLines: false,
    batchSize: 64,
    maxRetries: 1,
    timeout: runtimeConfig.ragTimeoutMs,
  });
}

/** One instance per provider/model (a built-in model is loaded once, not on every request). */
const instances = new Map<string, Embeddings>();

export function clearEmbeddingInstances(): void {
  instances.clear();
}

export function getEmbeddings(
  runtimeConfig: ResolvedConfig,
  target: EmbeddingTarget,
  options: { fetch?: FetchLike } = {},
): Embeddings {
  const embedding = runtimeConfig.embedding;

  if (options.fetch) {
    return target.provider === "builtin"
      ? new BuiltinEmbeddings({ model: target.model, cacheDir: embedding.cacheDir })
      : createOpenAICompatibleEmbeddings(runtimeConfig, target, options.fetch);
  }

  let key: string;
  if (target.provider === "builtin") {
    key = `builtin|${target.model}|${embedding.cacheDir}`;
  } else {
    const connection = connectionForTarget(runtimeConfig, target);
    if (!connection) throw notConfiguredError(target);
    // The version makes a changed URL or key take effect at once (no restart).
    key = `openai-compatible|${target.model}|${connection.serviceId}|${connection.baseUrl}|${connection.version}`;
  }

  let instance = instances.get(key);
  if (!instance) {
    instance = target.provider === "builtin"
      ? new BuiltinEmbeddings({ model: target.model, cacheDir: embedding.cacheDir })
      : createOpenAICompatibleEmbeddings(runtimeConfig, target);
    instances.set(key, instance);
  }
  return instance;
}

export type EmbeddingTargetStatus = {
  provider: EmbeddingProvider;
  model: string;
  /** builtin: always true; openai-compatible: a base URL is configured. */
  configured: boolean;
  /** builtin: the model is in the built-in catalog; openai-compatible: always true. */
  supported: boolean;
  /** builtin only: the model files are already in the cache. */
  downloaded?: boolean;
  approxDownloadMb?: number;
  /** openai-compatible only (free GET /models check). */
  reachable?: boolean;
  authOk?: boolean;
  modelListed?: boolean | "unknown";
  availableModels?: string[];
  httpStatus?: number;
  /** Usable now. A built-in model that is not downloaded yet is still usable (it downloads on first use). */
  ok: boolean;
  latencyMs: number;
  error?: string;
};

/**
 * Cheap availability check for readiness and preflight: never downloads a model and never runs an
 * embedding. builtin = catalog + cache check; openai-compatible = free, cached GET /models.
 */
export async function checkEmbeddingTarget(
  runtimeConfig: ResolvedConfig,
  target: EmbeddingTarget,
  options: { fetch?: FetchLike; useCache?: boolean } = {},
): Promise<EmbeddingTargetStatus> {
  if (target.provider === "builtin") {
    const spec = getBuiltinEmbeddingModelSpec(target.model);
    return {
      provider: "builtin",
      model: target.model,
      configured: true,
      supported: Boolean(spec),
      downloaded: spec ? isBuiltinModelCached(target.model, runtimeConfig.embedding.cacheDir) : false,
      approxDownloadMb: spec?.approxDownloadMb,
      ok: Boolean(spec),
      latencyMs: 0,
      error: spec ? undefined : `${target.model} is not a supported built-in model (supported: ${builtinEmbeddingModelIds().join(", ")}).`,
    };
  }

  const connection = connectionForTarget(runtimeConfig, target);
  if (!connection) {
    return {
      provider: "openai-compatible",
      model: target.model,
      configured: false,
      supported: true,
      ok: false,
      latencyMs: 0,
      error: notConfiguredError(target).message,
    };
  }

  const status = await checkConnection(runtimeConfig, connection, target.model, options);
  return {
    provider: "openai-compatible",
    model: target.model,
    configured: true,
    supported: true,
    reachable: status.reachable,
    authOk: status.authOk,
    modelListed: status.modelListed,
    availableModels: status.availableModels,
    httpStatus: status.httpStatus,
    ok: status.ok,
    latencyMs: status.latencyMs,
    error: status.error,
  };
}

/** Free, cached GET /models check of one connection; the cache is keyed by service and version. */
function checkConnection(
  runtimeConfig: ResolvedConfig,
  connection: EmbeddingConnection,
  model: string,
  options: { fetch?: FetchLike; useCache?: boolean } = {},
) {
  return checkOpenAICompatibleProvider(
    {
      baseUrl: connection.baseUrl,
      model,
      apiKey: connection.apiKey,
      apiKeySource: `${connection.serviceId}|${connection.version}`,
    },
    { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, useCache: options.useCache, serviceLabel: "embedding service" },
  );
}

export type EmbeddingServiceModels = {
  id: string;
  name: string;
  reachable: boolean;
  authOk: boolean;
  models: string[];
  error?: string;
};

/** Reachability and model list of one service (free GET /models; never runs an embedding). */
export async function listConnectionModels(
  runtimeConfig: ResolvedConfig,
  connection: EmbeddingConnection,
  name: string,
  options: { fetch?: FetchLike; useCache?: boolean } = {},
): Promise<EmbeddingServiceModels> {
  const status = await checkConnection(runtimeConfig, connection, "", options);
  return {
    id: connection.serviceId,
    name,
    reachable: status.reachable,
    authOk: status.authOk,
    models: status.availableModels ?? [],
    ...(status.error ? { error: status.error } : {}),
  };
}

export type EmbeddingModelCatalog = {
  default: EmbeddingTarget;
  providers: {
    builtin: { models: string[]; cacheDir: string };
    /** The "server" service from .env / config (kept for older clients; also listed in embeddingServices). */
    "openai-compatible": {
      configured: boolean;
      baseUrl: string | null;
      reachable: boolean;
      models: string[];
      error?: string;
    };
  };
  /** Every embedding service the tenant can use, with its models ("server" first when configured). */
  embeddingServices: EmbeddingServiceModels[];
};

export const SERVER_EMBEDDING_SERVICE_NAME = "Server (.env / config)";
export const BUILTIN_EMBEDDING_SERVICE_NAME = "Built-in (inside the backend)";

/** Model suggestions for the admin panel (GET /v1/admin/models). */
export async function listEmbeddingModels(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike; services?: Array<{ connection: EmbeddingConnection; name: string }> } = {},
): Promise<EmbeddingModelCatalog> {
  const embedding = runtimeConfig.embedding;
  const server = serverEmbeddingConnection(runtimeConfig);
  const serverModels = server
    ? await listConnectionModels(runtimeConfig, server, SERVER_EMBEDDING_SERVICE_NAME, { fetch: options.fetch })
    : null;
  const others = await Promise.all((options.services ?? []).map(
    (service) => listConnectionModels(runtimeConfig, service.connection, service.name, { fetch: options.fetch }),
  ));

  return {
    default: defaultEmbeddingTarget(runtimeConfig),
    providers: {
      builtin: { models: builtinEmbeddingModelIds(), cacheDir: embedding.cacheDir },
      "openai-compatible": serverModels
        ? {
          configured: true,
          baseUrl: embedding.baseUrl,
          reachable: serverModels.reachable && serverModels.authOk,
          models: serverModels.models,
          ...(serverModels.error ? { error: serverModels.error } : {}),
        }
        : { configured: false, baseUrl: null, reachable: false, models: [] },
    },
    embeddingServices: [...(serverModels ? [serverModels] : []), ...others],
  };
}
