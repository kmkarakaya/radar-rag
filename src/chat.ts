import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import type { ResolvedConfig } from "./config.js";
import { isTimeoutOrAbortError, withTimeoutAndAbort } from "./observability/timeout.js";

/**
 * The optional chat LLM behind /query. Any OpenAI-compatible chat completions endpoint works
 * (Ollama's /v1, LM Studio, vLLM, OpenAI, OpenRouter, ...), called through LangChain.
 *
 * ChatOpenAICompletions is used instead of ChatOpenAI because ChatOpenAI silently switches to
 * OpenAI's Responses API for some model names (e.g. "*codex*", "*-pro"), which other providers
 * do not implement.
 */

/** Local servers ignore the key, but the OpenAI client refuses to start without one. */
const PLACEHOLDER_API_KEY = "not-needed";
const PROVIDER_CHECK_CACHE_TTL_MS = 30_000;
const MAX_LISTED_MODELS = 50;

type FetchLike = typeof fetch;

export function createChatModel(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike } = {},
): ChatOpenAICompletions {
  const chat = runtimeConfig.chat;
  if (!chat.enabled) {
    throw new Error("Chat LLM is not configured (chat.baseUrl and chat.model are required).");
  }

  return new ChatOpenAICompletions({
    model: chat.model,
    apiKey: chat.apiKey ?? PLACEHOLDER_API_KEY,
    configuration: {
      baseURL: chat.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
    // Reliability settings of this service, not model parameters: fail fast instead of
    // LangChain's default 6 retries, and never wait longer than a RAG request may take.
    maxRetries: 1,
    timeout: runtimeConfig.ragTimeoutMs,
    // Model parameters are only sent when set explicitly in config; otherwise the provider defaults apply.
    ...(chat.temperature !== undefined ? { temperature: chat.temperature } : {}),
    ...(chat.maxTokens !== undefined ? { maxTokens: chat.maxTokens } : {}),
  });
}

export type ChatProviderStatus = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** The endpoint answered (any HTTP status). */
  reachable: boolean;
  /** False when the endpoint rejected the API key (401/403). */
  authOk: boolean;
  /** "unknown" when the provider has no usable GET /models listing. */
  modelListed: boolean | "unknown";
  /** Configured, reachable, key accepted and the model is not known to be missing. */
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  availableModels?: string[];
  error?: string;
};

const providerStatusCache = new Map<string, { at: number; status: ChatProviderStatus }>();

export function clearChatProviderCache(): void {
  providerStatusCache.clear();
}

function normalizeModelId(modelId: string): string {
  return modelId.endsWith(":latest") ? modelId.slice(0, -":latest".length) : modelId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Free health check: GET {baseUrl}/models. It never runs a generation, so /ready can call it often
 * (results are cached for 30 s). Nothing is requested when chat is not configured.
 */
export async function checkChatProvider(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike; useCache?: boolean } = {},
): Promise<ChatProviderStatus> {
  const chat = runtimeConfig.chat;
  if (!chat.enabled) {
    return {
      configured: false,
      baseUrl: chat.baseUrl || null,
      model: chat.model || null,
      reachable: false,
      authOk: false,
      modelListed: "unknown",
      ok: false,
      latencyMs: 0,
    };
  }

  const cacheKey = `${chat.baseUrl}|${chat.model}|${chat.apiKeySource}`;
  const useCache = options.useCache ?? true;
  const cached = providerStatusCache.get(cacheKey);
  if (useCache && cached && Date.now() - cached.at < PROVIDER_CHECK_CACHE_TTL_MS) {
    return cached.status;
  }

  const status = await fetchProviderStatus(runtimeConfig, options.fetch ?? fetch);
  providerStatusCache.set(cacheKey, { at: Date.now(), status });
  return status;
}

async function fetchProviderStatus(runtimeConfig: ResolvedConfig, fetchImpl: FetchLike): Promise<ChatProviderStatus> {
  const chat = runtimeConfig.chat;
  const startedAt = Date.now();
  const base = {
    configured: true,
    baseUrl: chat.baseUrl,
    model: chat.model,
  };

  let response: Response;
  try {
    response = await fetchImpl(`${chat.baseUrl}/models`, {
      headers: chat.apiKey ? { Authorization: `Bearer ${chat.apiKey}` } : {},
      signal: AbortSignal.timeout(runtimeConfig.readyTimeoutMs),
    });
  } catch (error) {
    return {
      ...base,
      reachable: false,
      authOk: false,
      modelListed: "unknown",
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: redactSecret(errorMessage(error), chat.apiKey),
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
      error: `The chat provider rejected the API key (HTTP ${response.status}).`,
    };
  }

  if (response.status === 404 || response.status === 405) {
    // Provider does not offer a model listing; the model can only be verified by a real request.
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

  const wanted = normalizeModelId(chat.model);
  const modelListed = modelIds.some((id) => normalizeModelId(id) === wanted);
  return {
    ...base,
    reachable: true,
    authOk: true,
    modelListed,
    ok: modelListed,
    latencyMs,
    httpStatus: response.status,
    availableModels: modelIds.slice(0, MAX_LISTED_MODELS),
    error: modelListed ? undefined : `Model ${chat.model} is not offered by ${chat.baseUrl}.`,
  };
}

export type ChatGenerationCheck = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
};

/** Real generation smoke test (costs a request on paid APIs). Used by onboarding only. */
export async function checkChatGeneration(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike } = {},
): Promise<ChatGenerationCheck> {
  const startedAt = Date.now();

  try {
    const model = createChatModel(runtimeConfig, options);
    const response = await withTimeoutAndAbort({
      promise: model.invoke([
        new SystemMessage("Reply with one short sentence."),
        new HumanMessage(runtimeConfig.readyChatProbeText),
      ]),
      timeoutMs: runtimeConfig.readyTimeoutMs,
      label: "Chat generation smoke test",
    });
    const content = typeof response.content === "string" ? response.content.trim() : JSON.stringify(response.content);

    return {
      ok: content.length > 0,
      latencyMs: Date.now() - startedAt,
      error: content.length > 0 ? undefined : "Chat generation smoke test returned an empty response.",
      details: { probeText: runtimeConfig.readyChatProbeText, responseLength: content.length },
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: redactSecret(errorMessage(error), runtimeConfig.chat.apiKey),
      details: { probeText: runtimeConfig.readyChatProbeText },
    };
  }
}

export type ChatErrorClassification =
  | { kind: "timeout" }
  | { kind: "unreachable"; message: string }
  | { kind: "provider"; message: string; upstreamStatus: number }
  | { kind: "unknown" };

const CONNECTION_ERROR_MARKERS = ["Connection error", "fetch failed", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"];

/** Sorts a chat call failure into the API error it should become (see rag.ts answerQuestion). */
export function classifyChatError(error: unknown, apiKey?: string): ChatErrorClassification {
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
