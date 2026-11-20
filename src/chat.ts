import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import type { ResolvedConfig } from "./config.js";
import { withTimeoutAndAbort } from "./observability/timeout.js";
import {
  checkOpenAICompatibleProvider,
  classifyProviderError,
  clearProviderStatusCache,
  notConfiguredStatus,
  PLACEHOLDER_API_KEY,
  redactSecret,
  type FetchLike,
  type ProviderErrorClassification,
  type ProviderStatus,
} from "./providers/openaiCompatible.js";

export { redactSecret };

/**
 * The optional chat LLM behind /query. Any OpenAI-compatible chat completions endpoint works
 * (Ollama's /v1, LM Studio, vLLM, OpenAI, OpenRouter, ...), called through LangChain.
 *
 * ChatOpenAICompletions is used instead of ChatOpenAI because ChatOpenAI silently switches to
 * OpenAI's Responses API for some model names (e.g. "*codex*", "*-pro"), which other providers
 * do not implement.
 */

export const SERVER_CHAT_SERVICE_ID = "server";
export const SERVER_CHAT_SERVICE_NAME = "Server (.env / config)";

/** A resolved connection to an OpenAI-compatible chat API. */
export type ChatConnection = {
  serviceId: string;
  baseUrl: string;
  apiKey?: string;
  /** Changes whenever the URL or key changes, so cached checks are never reused for a new setting. */
  version: string;
};

/**
 * The chat LLM that answers /query for a tenant (see resolveChatTarget in chatServices.ts).
 * - tenant: the tenant chose a chat service and model (PUT /v1/admin/chat-settings);
 * - server: no choice, the chat LLM from .env / config is used;
 * - none: no chat LLM at all (retrieve-only).
 */
export type ChatTarget = {
  source: "tenant" | "server" | "none";
  serviceId: string | null;
  model: string | null;
  /** null when there is no usable connection: none, or the chosen service is gone (never a fallback). */
  connection: ChatConnection | null;
  /** Why a chosen service has no connection. */
  connectionError?: string;
};

export type ReadyChatTarget = ChatTarget & { connection: ChatConnection; model: string };

/** The "server" chat service (chat.baseUrl / RAG_CHAT_BASE_URL), or null when none is configured. */
export function serverChatConnection(runtimeConfig: ResolvedConfig): ChatConnection | null {
  const chat = runtimeConfig.chat;
  if (!chat.baseUrl) return null;
  return {
    serviceId: SERVER_CHAT_SERVICE_ID,
    baseUrl: chat.baseUrl,
    apiKey: chat.apiKey,
    version: `config:${chat.apiKeySource}`,
  };
}

/** The chat LLM from .env / config, used when the tenant has not chosen one. */
export function serverChatTarget(runtimeConfig: ResolvedConfig): ChatTarget {
  if (!runtimeConfig.chat.enabled) {
    return { source: "none", serviceId: null, model: null, connection: null };
  }
  return {
    source: "server",
    serviceId: SERVER_CHAT_SERVICE_ID,
    model: runtimeConfig.chat.model,
    connection: serverChatConnection(runtimeConfig),
  };
}

export function isChatTargetReady(target: ChatTarget): target is ReadyChatTarget {
  return Boolean(target.connection && target.model);
}

export const CHAT_SETUP_HINT = "choose a chat service and model with PUT /v1/admin/chat-settings (admin panel: Chat services), "
  + "or set RAG_CHAT_BASE_URL and RAG_CHAT_MODEL (npm run onboard).";

/** The CHAT_NOT_CONFIGURED message for a target that cannot generate. */
export function chatNotConfiguredMessage(target: ChatTarget): string {
  if (target.connectionError) {
    return `Answer generation is unavailable: ${target.connectionError}`;
  }
  return `Answer generation is disabled: no chat LLM is configured. Use /retrieve, or ${CHAT_SETUP_HINT}`;
}

export function createChatModel(
  runtimeConfig: ResolvedConfig,
  options: { fetch?: FetchLike; target?: ChatTarget } = {},
): ChatOpenAICompletions {
  const target = options.target ?? serverChatTarget(runtimeConfig);
  if (!isChatTargetReady(target)) {
    throw new Error(target.connectionError ?? "Chat LLM is not configured (chat.baseUrl and chat.model are required).");
  }
  const chat = runtimeConfig.chat;
  const baseFetch = options.fetch ?? fetch;

  return new ChatOpenAICompletions({
    model: target.model,
    apiKey: target.connection.apiKey ?? PLACEHOLDER_API_KEY,
    configuration: {
      baseURL: target.connection.baseUrl,
      // Redirects are not followed (as in the GET /models checks): questions, document text and the key
      // only go to the URL the admin entered; a redirect fails as an HTTP error instead.
      fetch: ((url: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) =>
        baseFetch(url, { ...init, redirect: "manual" })) as FetchLike,
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

export type ChatProviderStatus = ProviderStatus;

export function clearChatProviderCache(): void {
  clearProviderStatusCache();
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
  options: { fetch?: FetchLike; useCache?: boolean; target?: ChatTarget } = {},
): Promise<ChatProviderStatus> {
  const target = options.target ?? serverChatTarget(runtimeConfig);
  if (!isChatTargetReady(target)) {
    const status = target.source === "none"
      ? notConfiguredStatus(runtimeConfig.chat.baseUrl, runtimeConfig.chat.model)
      : notConfiguredStatus(target.connection?.baseUrl ?? "", target.model ?? "");
    return target.connectionError ? { ...status, error: target.connectionError } : status;
  }

  return checkOpenAICompatibleProvider(
    {
      baseUrl: target.connection.baseUrl,
      model: target.model,
      apiKey: target.connection.apiKey,
      // The cache is keyed by service and version: a changed URL or key is checked again at once.
      apiKeySource: `${target.connection.serviceId}|${target.connection.version}`,
    },
    { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, useCache: options.useCache, serviceLabel: "chat provider" },
  );
}

export type ChatServiceModels = {
  id: string;
  name: string;
  reachable: boolean;
  authOk: boolean;
  models: string[];
  error?: string;
};

/** Reachability and model list of one chat service (free GET /models; never runs a generation). */
export async function listChatConnectionModels(
  runtimeConfig: ResolvedConfig,
  connection: ChatConnection,
  name: string,
  options: { fetch?: FetchLike; useCache?: boolean } = {},
): Promise<ChatServiceModels> {
  const status = await checkOpenAICompatibleProvider(
    {
      baseUrl: connection.baseUrl,
      model: "",
      apiKey: connection.apiKey,
      apiKeySource: `${connection.serviceId}|${connection.version}`,
    },
    { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, useCache: options.useCache, serviceLabel: "chat provider" },
  );
  return {
    id: connection.serviceId,
    name,
    reachable: status.reachable,
    authOk: status.authOk,
    models: status.availableModels ?? [],
    ...(status.error ? { error: status.error } : {}),
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

export type ChatErrorClassification = ProviderErrorClassification;

/** Sorts a chat call failure into the API error it should become (see rag.ts answerQuestion). */
export function classifyChatError(error: unknown, apiKey?: string): ChatErrorClassification {
  return classifyProviderError(error, apiKey);
}
