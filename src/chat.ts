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
  options: { fetch?: FetchLike; useCache?: boolean } = {},
): Promise<ChatProviderStatus> {
  const chat = runtimeConfig.chat;
  if (!chat.enabled) {
    return notConfiguredStatus(chat.baseUrl, chat.model);
  }

  return checkOpenAICompatibleProvider(
    { baseUrl: chat.baseUrl, model: chat.model, apiKey: chat.apiKey, apiKeySource: chat.apiKeySource },
    { timeoutMs: runtimeConfig.readyTimeoutMs, fetch: options.fetch, useCache: options.useCache, serviceLabel: "chat provider" },
  );
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
