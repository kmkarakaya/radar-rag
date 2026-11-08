import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach } from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import {
  checkChatProvider,
  classifyChatError,
  clearChatProviderCache,
  createChatModel,
  redactSecret,
} from "../src/chat.js";
import { config, parseConfig, resolveConfig, type ResolvedConfig } from "../src/config.js";
import { Semaphore } from "../src/http/semaphore.js";
import { isTimeoutOrAbortError, OperationTimeoutError } from "../src/observability/timeout.js";

const baseRawConfig = {
  server: { port: 3010 },
  registry: { path: "data/registry.sqlite" },
  chroma: { url: "http://localhost:8000" },
  collectionDefaults: {
    sourcePath: "data",
    distanceMetric: "l2",
    chunkSize: 500,
    chunkOverlap: 200,
    retrievalK: 5,
    retrievalDistanceThreshold: 1.2,
    timeoutMs: 180000,
  },
  readiness: { timeoutMs: 30000, embeddingProbeText: "Merhaba" },
};

function chatConfig(chat: Partial<ResolvedConfig["chat"]> = {}): ResolvedConfig {
  return {
    ...config,
    chat: {
      enabled: true,
      baseUrl: "http://chat.test/v1",
      model: "test-model",
      apiKey: "secret-key-123",
      apiKeySource: "env",
      temperature: undefined,
      maxTokens: undefined,
      maxContextTokens: undefined,
      ...chat,
    },
  };
}

type Captured = { url: string; headers: Record<string, string>; body?: Record<string, unknown> };

function completionFetch(captured: Captured[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("chat config", () => {
  it("is disabled when the chat section is missing or empty", () => {
    const missing = resolveConfig(parseConfig(baseRawConfig), "test.yaml", process.cwd(), { env: {} });
    assert.equal(missing.chat.enabled, false);

    const empty = resolveConfig(parseConfig({ ...baseRawConfig, chat: { baseUrl: "", model: "" } }), "test.yaml", process.cwd(), { env: {} });
    assert.equal(empty.chat.enabled, false);

    const onlyUrl = resolveConfig(parseConfig({ ...baseRawConfig, chat: { baseUrl: "http://x/v1", model: "" } }), "test.yaml", process.cwd(), { env: {} });
    assert.equal(onlyUrl.chat.enabled, false);
  });

  it("is enabled with a base URL and a model, strips a trailing slash and sends no model parameters by default", () => {
    const resolved = resolveConfig(
      parseConfig({ ...baseRawConfig, chat: { baseUrl: "http://localhost:11434/v1/", model: "gemma3:4b" } }),
      "test.yaml",
      process.cwd(),
      { env: {}, chatApiKeyFilePath: "does-not-exist.secret" },
    );

    assert.equal(resolved.chat.enabled, true);
    assert.equal(resolved.chat.baseUrl, "http://localhost:11434/v1");
    assert.equal(resolved.chat.temperature, undefined);
    assert.equal(resolved.chat.maxTokens, undefined);
    assert.equal(resolved.chat.maxContextTokens, undefined);
    assert.equal(resolved.chat.apiKeySource, "none");
  });

  it("rejects a base URL that is neither empty nor a URL", () => {
    assert.throws(() => parseConfig({ ...baseRawConfig, chat: { baseUrl: "localhost", model: "m" } }), /chat\.baseUrl/);
  });

  it("reads the API key from RAG_CHAT_API_KEY first, then the local secret file, never from the YAML", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "rag-chat-key-"));
    try {
      await mkdir(path.join(dir, ".local"), { recursive: true });
      await writeFile(path.join(dir, ".local", "rag_chat_api_key.secret"), "file-key\n");
      const raw = parseConfig({ ...baseRawConfig, chat: { baseUrl: "https://api.example.com/v1", model: "m" } });

      const fromEnv = resolveConfig(raw, "test.yaml", dir, { env: { RAG_CHAT_API_KEY: "env-key" } });
      assert.equal(fromEnv.chat.apiKey, "env-key");
      assert.equal(fromEnv.chat.apiKeySource, "env");

      const fromFile = resolveConfig(raw, "test.yaml", dir, { env: {} });
      assert.equal(fromFile.chat.apiKey, "file-key");
      assert.equal(fromFile.chat.apiKeySource, "file");

      const overridden = resolveConfig(raw, "test.yaml", dir, { env: { RAG_CHAT_API_KEY: "env-key" }, chatApiKeyOverride: null });
      assert.equal(overridden.chat.apiKey, undefined);
      assert.equal(overridden.chat.apiKeySource, "none");

      assert.throws(() => parseConfig({ ...baseRawConfig, chat: { baseUrl: "https://a/v1", model: "m", apiKey: "x" } }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createChatModel", () => {
  it("calls /chat/completions without temperature or max tokens unless they are configured", async () => {
    const captured: Captured[] = [];
    await createChatModel(chatConfig(), { fetch: completionFetch(captured) }).invoke([new HumanMessage("q")]);
    await createChatModel(chatConfig({ temperature: 0.2, maxTokens: 64 }), { fetch: completionFetch(captured) })
      .invoke([new HumanMessage("q")]);

    assert.equal(captured[0].url, "http://chat.test/v1/chat/completions");
    assert.equal(captured[0].headers.authorization, "Bearer secret-key-123");
    assert.equal(captured[0].body?.model, "test-model");
    assert.equal("temperature" in (captured[0].body ?? {}), false);
    assert.equal("max_tokens" in (captured[0].body ?? {}), false);
    assert.equal("max_completion_tokens" in (captured[0].body ?? {}), false);

    assert.equal(captured[1].body?.temperature, 0.2);
    assert.ok(captured[1].body?.max_tokens === 64 || captured[1].body?.max_completion_tokens === 64);
  });

  it("stays on chat completions for model names that ChatOpenAI would route to the Responses API", async () => {
    const captured: Captured[] = [];
    await createChatModel(chatConfig({ model: "gpt-5.5-pro-codex" }), { fetch: completionFetch(captured) })
      .invoke([new HumanMessage("q")]);
    assert.equal(captured[0].url, "http://chat.test/v1/chat/completions");
  });

  it("uses a placeholder key for local servers and refuses to build without configuration", async () => {
    const captured: Captured[] = [];
    await createChatModel(chatConfig({ apiKey: undefined, apiKeySource: "none" }), { fetch: completionFetch(captured) })
      .invoke([new HumanMessage("q")]);
    assert.equal(captured[0].headers.authorization, "Bearer not-needed");

    assert.throws(() => createChatModel(chatConfig({ enabled: false })), /not configured/);
  });
});

describe("checkChatProvider", () => {
  beforeEach(() => clearChatProviderCache());

  function jsonFetch(status: number, body: unknown, calls: Captured[]): typeof fetch {
    return (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  it("makes no request when chat is not configured", async () => {
    const calls: Captured[] = [];
    const status = await checkChatProvider(chatConfig({ enabled: false, baseUrl: "", model: "" }), { fetch: jsonFetch(200, {}, calls) });
    assert.equal(status.configured, false);
    assert.equal(status.ok, false);
    assert.equal(calls.length, 0);
  });

  it("checks GET /models with the API key and reports whether the model is offered", async () => {
    const calls: Captured[] = [];
    const listed = await checkChatProvider(chatConfig({ model: "gemma3:4b" }), {
      fetch: jsonFetch(200, { data: [{ id: "gemma3:4b" }, { id: "other" }] }, calls),
    });
    assert.equal(calls[0].url, "http://chat.test/v1/models");
    assert.equal(calls[0].headers.authorization, "Bearer secret-key-123");
    assert.equal(listed.ok, true);
    assert.equal(listed.modelListed, true);

    clearChatProviderCache();
    const latest = await checkChatProvider(chatConfig({ model: "gemma3" }), { fetch: jsonFetch(200, { data: [{ id: "gemma3:latest" }] }, []) });
    assert.equal(latest.modelListed, true);

    clearChatProviderCache();
    const missing = await checkChatProvider(chatConfig({ model: "absent" }), { fetch: jsonFetch(200, { data: [{ id: "other" }] }, []) });
    assert.equal(missing.ok, false);
    assert.equal(missing.modelListed, false);
    assert.deepEqual(missing.availableModels, ["other"]);
  });

  it("separates rejected keys, missing listings and unreachable endpoints", async () => {
    const auth = await checkChatProvider(chatConfig(), { fetch: jsonFetch(401, { error: "bad key" }, []), useCache: false });
    assert.equal(auth.reachable, true);
    assert.equal(auth.authOk, false);
    assert.equal(auth.ok, false);

    const noListing = await checkChatProvider(chatConfig(), { fetch: jsonFetch(404, {}, []), useCache: false });
    assert.equal(noListing.modelListed, "unknown");
    assert.equal(noListing.ok, true);

    const down = await checkChatProvider(chatConfig(), {
      fetch: (async () => { throw new TypeError("fetch failed: secret-key-123"); }) as typeof fetch,
      useCache: false,
    });
    assert.equal(down.reachable, false);
    assert.equal(down.ok, false);
    assert.ok(!down.error?.includes("secret-key-123"));
  });

  it("caches the result for repeated readiness calls", async () => {
    const calls: Captured[] = [];
    const fetchImpl = jsonFetch(200, { data: [{ id: "test-model" }] }, calls);
    await checkChatProvider(chatConfig(), { fetch: fetchImpl });
    await checkChatProvider(chatConfig(), { fetch: fetchImpl });
    assert.equal(calls.length, 1);

    await checkChatProvider(chatConfig(), { fetch: fetchImpl, useCache: false });
    assert.equal(calls.length, 2);
  });
});

describe("chat error mapping", () => {
  it("classifies provider, connection and timeout failures", () => {
    const upstream = Object.assign(new Error("Incorrect API key provided: secret-key-123"), { status: 401 });
    const provider = classifyChatError(upstream, "secret-key-123");
    assert.equal(provider.kind, "provider");
    assert.ok(provider.kind === "provider" && provider.upstreamStatus === 401);
    assert.ok(provider.kind === "provider" && !provider.message.includes("secret-key-123"));

    const connection = Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    assert.equal(classifyChatError(connection).kind, "unreachable");
    assert.equal(classifyChatError(new Error("fetch failed")).kind, "unreachable");

    assert.equal(classifyChatError(new OperationTimeoutError("slow")).kind, "timeout");
    assert.equal(classifyChatError(Object.assign(new Error("t"), { name: "TimeoutError" })).kind, "timeout");
    assert.equal(classifyChatError(new Error("something else")).kind, "unknown");
  });

  it("redacts the key and OpenAI-style key fragments", () => {
    assert.equal(redactSecret("key secret-key-123 here", "secret-key-123"), "key [redacted] here");
    assert.equal(redactSecret("Incorrect API key provided: sk-abc123***xyz"), "Incorrect API key provided: sk-[redacted]");
  });
});

describe("generation semaphore", () => {
  it("rejects a queue timeout with a typed timeout error (mapped to 503, not 500)", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire(1000);
    await assert.rejects(semaphore.acquire(10), (error) => {
      assert.ok(error instanceof OperationTimeoutError);
      assert.ok(isTimeoutOrAbortError(error));
      return true;
    });
    semaphore.release();
  });
});
