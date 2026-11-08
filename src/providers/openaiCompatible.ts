import { isTimeoutOrAbortError } from "../observability/timeout.js";

/**
 * Helpers shared by every OpenAI-compatible service the backend talks to (the optional chat LLM and the
 * openai-compatible embedding provider): a free GET /models health check, error classification and
 * secret redaction.
 */

/** Local servers ignore the key, but the OpenAI client refuses to start without one. */
export const PLACEHOLDER_API_KEY = "not-needed";

const PROVIDER_CHECK_CACHE_TTL_MS = 30_000;
const MAX_LISTED_MODELS = 50;

export type FetchLike = typeof fetch;

export type ProviderTarget = {
  baseUrl: string;
  /** Model to look for in the listing; empty = only check reachability and the key. */
  model: string;
  apiKey?: string;
  apiKeySource: string;
};

export type ProviderStatus = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** The endpoint answered (any HTTP status). */
  reachable: boolean;
  /** False when the endpoint rejected the API key (401/403). */
  authOk: boolean;
  /** "unknown" when the provider has no usable GET /models listing (or no model was asked for). */
  modelListed: boolean | "unknown";
  /** Configured, reachable, key accepted and the model is not known to be missing. */
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  availableModels?: string[];
  error?: string;
};

const providerStatusCache = new Map<string, { at: number; status: ProviderStatus }>();

export function clearProviderStatusCache(): void {
  providerStatusCache.clear();
}

export function normalizeModelId(modelId: string): string {
  return modelId.endsWith(":latest") ? modelId.slice(0, -":latest".length) : modelId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function notConfiguredStatus(baseUrl: string, model: string): ProviderStatus {
  return {
    configured: false,
    baseUrl: baseUrl || null,
    model: model || null,
    reachable: false,
    authOk: false,
    modelListed: "unknown",
    ok: false,
    latencyMs: 0,
  };
}

/**
 * Free health check: GET {baseUrl}/models. Never runs a generation or an embedding, so /ready can call
 * it often (results are cached for 30 s per service, model and key source).
 */
export async function checkOpenAICompatibleProvider(
  target: ProviderTarget,
  options: { timeoutMs: number; fetch?: FetchLike; useCache?: boolean; serviceLabel: string },
): Promise<ProviderStatus> {
  const cacheKey = `${target.baseUrl}|${target.model}|${target.apiKeySource}`;
  const useCache = options.useCache ?? true;
  const cached = providerStatusCache.get(cacheKey);
  if (useCache && cached && Date.now() - cached.at < PROVIDER_CHECK_CACHE_TTL_MS) {
    return cached.status;
  }

  const status = await fetchProviderStatus(target, options.fetch ?? fetch, options.timeoutMs, options.serviceLabel);
  providerStatusCache.set(cacheKey, { at: Date.now(), status });
  return status;
}

async function fetchProviderStatus(
  target: ProviderTarget,
  fetchImpl: FetchLike,
  timeoutMs: number,
  serviceLabel: string,
): Promise<ProviderStatus> {
  const startedAt = Date.now();
  const base = { configured: true, baseUrl: target.baseUrl, model: target.model || null };

  let response: Response;
  try {
    response = await fetchImpl(`${target.baseUrl}/models`, {
      headers: target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ...base,
      reachable: false,
      authOk: false,
      modelListed: "unknown",
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: redactSecret(errorMessage(error), target.apiKey),
    };
  }

  const latencyMs = Date.now() - startedAt;
  if (response.status === 401 || response.status === 403) {
    return {
      ...base,
      reachable: true,
      authOk: false,
      modelListed: "unknown",
      ok: false,
      latencyMs,
      httpStatus: response.status,
      error: `The ${serviceLabel} rejected the API key (HTTP ${response.status}).`,
    };
  }

  if (response.status === 404 || response.status === 405) {
    // No model listing; the model can only be verified by a real request.
    return { ...base, reachable: true, authOk: true, modelListed: "unknown", ok: true, latencyMs, httpStatus: response.status };
  }

  if (!response.ok) {
    return {
      ...base,
      reachable: false,
      authOk: true,
      modelListed: "unknown",
      ok: false,
      latencyMs,
      httpStatus: response.status,
      error: `GET /models returned HTTP ${response.status}.`,
    };
  }

  let modelIds: string[] | null = null;
  try {
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    if (Array.isArray(body?.data)) {
      modelIds = body.data.map((item) => item?.id).filter((id): id is string => typeof id === "string");
    }
  } catch {
    modelIds = null;
  }

  if (!modelIds) {
    return { ...base, reachable: true, authOk: true, modelListed: "unknown", ok: true, latencyMs, httpStatus: response.status };
  }

  const availableModels = modelIds.slice(0, MAX_LISTED_MODELS);
  if (!target.model) {
    return { ...base, reachable: true, authOk: true, modelListed: "unknown", ok: true, latencyMs, httpStatus: response.status, availableModels };
  }

  const wanted = normalizeModelId(target.model);
  const modelListed = modelIds.some((id) => normalizeModelId(id) === wanted);
  return {
    ...base,
    reachable: true,
    authOk: true,
    modelListed,
    ok: modelListed,
    latencyMs,
    httpStatus: response.status,
    availableModels,
    error: modelListed ? undefined : `Model ${target.model} is not offered by ${target.baseUrl}.`,
  };
}

export type ProviderErrorClassification =
  | { kind: "timeout" }
  | { kind: "unreachable"; message: string }
  | { kind: "provider"; message: string; upstreamStatus: number }
  | { kind: "unknown" };

const CONNECTION_ERROR_MARKERS = ["Connection error", "fetch failed", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"];

/** Sorts a failed call to an OpenAI-compatible service into the API error it should become. */
export function classifyProviderError(error: unknown, apiKey?: string): ProviderErrorClassification {
  if (isTimeoutOrAbortError(error) || (error instanceof Error && error.name === "TimeoutError")) {
    return { kind: "timeout" };
  }

  const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
  // LangChain appends its own "Troubleshooting URL" paragraph; keep only the provider's message.
  const message = redactSecret(errorMessage(error), apiKey).split("\n\nTroubleshooting URL")[0].trim().slice(0, 500);

  if (typeof status === "number") {
    return { kind: "provider", message, upstreamStatus: status };
  }

  const name = error instanceof Error ? error.name : "";
  const cause = error instanceof Error && error.cause ? errorMessage(error.cause) : "";
  if (name === "APIConnectionError" || CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker) || cause.includes(marker))) {
    return { kind: "unreachable", message };
  }

  return { kind: "unknown" };
}

/** Removes the API key (and OpenAI-style key fragments) from text that may reach clients or logs. */
export function redactSecret(text: string, secret?: string): string {
  let result = text;
  if (secret && secret.length >= 4) {
    result = result.split(secret).join("[redacted]");
  }
  return result.replace(/\bsk-[A-Za-z0-9*_-]{6,}/g, "sk-[redacted]");
}
