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
  type EmbeddingProvider,
} from "./models.js";

export { BuiltinModelLoadError, clearLoadedBuiltinModels, isBuiltinModelCached } from "./builtin.js";
export * from "./models.js";

/** The embedding a collection is indexed with (and must be queried with). */
export type EmbeddingTarget = {
  provider: EmbeddingProvider;
  model: string;
};

/** Thrown when a collection uses the openai-compatible provider but no base URL is configured. */
export class EmbeddingProviderNotConfiguredError extends Error {
  constructor() {
    super("The openai-compatible embedding provider is not configured: set embedding.baseUrl (npm run onboard or RAG_EMBEDDING_BASE_URL).");
    this.name = "EmbeddingProviderNotConfiguredError";
  }
}

/** The embedding a collection's active index was built with (reads must use exactly this). */
export function activeEmbeddingTarget(
  collection: Pick<RagCollection, "embeddingProvider" | "embeddingModel" | "activeEmbeddingProvider" | "activeEmbeddingModel">,
): EmbeddingTarget {
  return {
    provider: collection.activeEmbeddingProvider ?? collection.embeddingProvider,
    model: collection.activeEmbeddingModel ?? collection.embeddingModel,
  };
}

export function defaultEmbeddingTarget(runtimeConfig: ResolvedConfig): EmbeddingTarget {
  return { provider: runtimeConfig.embedding.provider, model: runtimeConfig.embedding.model };
}

function createOpenAICompatibleEmbeddings(runtimeConfig: ResolvedConfig, model: string, fetchImpl?: FetchLike): OpenAIEmbeddings {
  const embedding = runtimeConfig.embedding;
  if (!embedding.baseUrl) {
    throw new EmbeddingProviderNotConfiguredError();
  }

  return new OpenAIEmbeddings({
    model,
    apiKey: embedding.apiKey ?? PLACEHOLDER_API_KEY,
    configuration: {
      baseURL: embedding.baseUrl,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
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
  const key = target.provider === "builtin"
    ? `builtin|${target.model}|${embedding.cacheDir}`
    : `openai-compatible|${target.model}|${embedding.baseUrl}|${embedding.apiKeySource}`;

  if (options.fetch) {
    return target.provider === "builtin"
      ? new BuiltinEmbeddings({ model: target.model, cacheDir: embedding.cacheDir })
      : createOpenAICompatibleEmbeddings(runtimeConfig, target.model, options.fetch);
  }

  let instance = instances.get(key);
  if (!instance) {
    instance = target.provider === "builtin"
      ? new BuiltinEmbeddings({ model: target.model, cacheDir: embedding.cacheDir })
      : createOpenAICompatibleEmbeddings(runtimeConfig, target.model);
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

  const embedding = runtimeConfig.embedding;
  if (!embedding.baseUrl) {
    return {
      provider: "openai-compatible",
      model: target.model,
      configured: false,
      supported: true,
      ok: false,
      latencyMs: 0,
      error: new EmbeddingProviderNotConfiguredError().message,
    };
  }

  const status = await checkOpenAICompatibleProvider(
    { baseUrl: embedding.baseUrl, model: target.model, apiKey: embedding.apiKey, apiKeySource: embedding.apiKeySource },
    { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, useCache: options.useCache, serviceLabel: "embedding provider" },
  );
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

export type EmbeddingModelCatalog = {
  default: EmbeddingTarget;
  providers: {
    builtin: { models: string[]; cacheDir: string };
    "openai-compatible": {
      configured: boolean;
      baseUrl: string | null;
      reachable: boolean;
      models: string[];
      error?: string;
    };
  };
};

/** Model suggestions for the admin panel (GET /v1/admin/models). */
export async function listEmbeddingModels(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike } = {},
): Promise<EmbeddingModelCatalog> {
  const embedding = runtimeConfig.embedding;
  let external: EmbeddingModelCatalog["providers"]["openai-compatible"] = {
    configured: false,
    baseUrl: null,
    reachable: false,
    models: [],
  };

  if (embedding.baseUrl) {
    const status = await checkOpenAICompatibleProvider(
      { baseUrl: embedding.baseUrl, model: "", apiKey: embedding.apiKey, apiKeySource: embedding.apiKeySource },
      { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, serviceLabel: "embedding provider" },
    );
    external = {
      configured: true,
      baseUrl: embedding.baseUrl,
      reachable: status.reachable && status.authOk,
      models: status.availableModels ?? [],
      ...(status.error ? { error: status.error } : {}),
    };
  }

  return {
    default: defaultEmbeddingTarget(runtimeConfig),
    providers: {
      builtin: { models: builtinEmbeddingModelIds(), cacheDir: embedding.cacheDir },
      "openai-compatible": external,
    },
  };
}
