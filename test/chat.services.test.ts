import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import {
  checkChatProvider,
  clearChatProviderCache,
  createChatModel,
  SERVER_CHAT_SERVICE_ID,
  type ChatTarget,
} from "../src/chat.js";
import { resolveChatTarget } from "../src/chatServices.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/admin/passwordHash.js";
import { createAdminAuthService } from "../src/http/adminAuth.js";
import { getHttpOperationTarget } from "../src/observability/logger.js";
import { RagQueryError, toChatGenerationError } from "../src/rag.js";

const tenantA = { tenantId: "tenant-a", userId: "alice", requestId: "r1" };
const tenantB = { tenantId: "tenant-b", userId: "bob", requestId: "r2" };

function runtimeWithChat(chat: Partial<ResolvedConfig["chat"]> = {}): ResolvedConfig {
  return {
    ...config,
    chat: {
      enabled: true,
      baseUrl: "http://server-chat.test/v1",
      model: "server-model",
      apiKey: "server-secret",
      apiKeySource: "env",
      temperature: undefined,
      maxTokens: undefined,
      maxContextTokens: undefined,
      ...chat,
    },
  };
}

function runtimeWithoutChat(): ResolvedConfig {
  return runtimeWithChat({ enabled: false, baseUrl: "", model: "", apiKey: undefined, apiKeySource: "none" });
}

type Captured = { url: string; redirect?: RequestRedirectLike; authorization?: string; model?: unknown };
type RequestRedirectLike = RequestInit["redirect"];

function completionFetch(captured: Captured[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    captured.push({
      url: String(url),
      redirect: init?.redirect,
      authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      model: body.model,
    });
    return new Response(JSON.stringify({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("chat services: registry", () => {
  const registries: CollectionRegistry[] = [];
  afterEach(() => registries.splice(0).forEach((registry) => registry.close?.()));

  function registry() {
    const created = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    registries.push(created);
    return created;
  }

  it("stores chat services per tenant, separately from embedding services", async () => {
    const reg = registry();
    const service = await reg.createChatService(tenantA, { displayName: "Ollama", baseUrl: "http://o/v1", apiKey: "k1" });
    assert.equal(service.displayName, "Ollama");
    assert.equal(service.apiKey, "k1");
    assert.notEqual(service.id, SERVER_CHAT_SERVICE_ID);

    assert.deepEqual((await reg.listChatServices(tenantA)).map((item) => item.id), [service.id]);
    assert.deepEqual(await reg.listChatServices(tenantB), []);
    assert.equal(await reg.getChatService(tenantB, service.id), null);
    assert.deepEqual(await reg.listEmbeddingServices(tenantA), []);

    const updated = await reg.updateChatService(tenantA, service.id, { baseUrl: "http://o2/v1", apiKey: null });
    assert.equal(updated.baseUrl, "http://o2/v1");
    assert.equal(updated.apiKey, undefined);
    assert.notEqual(updated.updatedAt, "", "updatedAt is the connection version");

    await assert.rejects(reg.deleteChatService(tenantB, service.id), /not found/);
    await reg.deleteChatService(tenantA, service.id);
    assert.deepEqual(await reg.listChatServices(tenantA), []);
  });

  it("keeps one chat choice per tenant and clears it", async () => {
    const reg = registry();
    assert.equal(await reg.getChatSettings(tenantA), null);

    await reg.setChatSettings(tenantA, { serviceId: "server", model: "m1" });
    const replaced = await reg.setChatSettings(tenantA, { serviceId: "svc", model: "m2" });
    assert.equal(replaced.serviceId, "svc");
    assert.equal(replaced.model, "m2");
    assert.equal(replaced.updatedBy, "alice");
    assert.equal(await reg.getChatSettings(tenantB), null);

    await reg.clearChatSettings(tenantA);
    assert.equal(await reg.getChatSettings(tenantA), null);
  });
});

describe("chat services: resolveChatTarget", () => {
  const registries: CollectionRegistry[] = [];
  afterEach(() => registries.splice(0).forEach((registry) => registry.close?.()));

  function registry() {
    const created = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    registries.push(created);
    return created;
  }

  it("uses the tenant's choice first, then the server's chat LLM, then none", async () => {
    const reg = registry();
    const withServer = runtimeWithChat();

    const server = await resolveChatTarget({ registry: reg, runtimeConfig: withServer, context: tenantA });
    assert.equal(server.source, "server");
    assert.equal(server.serviceId, "server");
    assert.equal(server.model, "server-model");
    assert.equal(server.connection?.baseUrl, "http://server-chat.test/v1");

    const none = await resolveChatTarget({ registry: reg, runtimeConfig: runtimeWithoutChat(), context: tenantA });
    assert.equal(none.source, "none");
    assert.equal(none.connection, null);

    const service = await reg.createChatService(tenantA, { displayName: "Cloud", baseUrl: "https://cloud/v1", apiKey: "cloud-key" });
    await reg.setChatSettings(tenantA, { serviceId: service.id, model: "cloud-model" });
    const chosen = await resolveChatTarget({ registry: reg, runtimeConfig: runtimeWithoutChat(), context: tenantA });
    assert.equal(chosen.source, "tenant");
    assert.equal(chosen.serviceId, service.id);
    assert.equal(chosen.model, "cloud-model");
    assert.equal(chosen.connection?.apiKey, "cloud-key");
    assert.equal(chosen.connection?.version, service.updatedAt);

    // Another tenant is not affected by tenant A's choice.
    assert.equal((await resolveChatTarget({ registry: reg, runtimeConfig: withServer, context: tenantB })).source, "server");
  });

  it("chooses the server service with another model", async () => {
    const reg = registry();
    await reg.setChatSettings(tenantA, { serviceId: "server", model: "other-model" });
    const target = await resolveChatTarget({ registry: reg, runtimeConfig: runtimeWithChat(), context: tenantA });
    assert.equal(target.source, "tenant");
    assert.equal(target.serviceId, "server");
    assert.equal(target.model, "other-model");
    assert.equal(target.connection?.apiKey, "server-secret");
  });

  it("never falls back to another service when the chosen one is gone", async () => {
    const reg = registry();
    await reg.setChatSettings(tenantA, { serviceId: "deleted-svc", model: "m" });
    const missing = await resolveChatTarget({ registry: reg, runtimeConfig: runtimeWithChat(), context: tenantA });
    assert.equal(missing.connection, null);
    assert.match(missing.connectionError ?? "", /deleted-svc/);

    await reg.setChatSettings(tenantA, { serviceId: "server", model: "m" });
    const serverRemoved = await resolveChatTarget({ registry: reg, runtimeConfig: runtimeWithoutChat(), context: tenantA });
    assert.equal(serverRemoved.connection, null);
    assert.match(serverRemoved.connectionError ?? "", /no longer configured/);
  });
});

describe("chat services: chat model and check use the target", () => {
  afterEach(() => clearChatProviderCache());

  const target: ChatTarget = {
    source: "tenant",
    serviceId: "cloud",
    model: "cloud-model",
    connection: { serviceId: "cloud", baseUrl: "https://cloud.test/v1", apiKey: "cloud-key", version: "v1" },
  };

  it("sends the request to the target's URL, model and key, without following redirects", async () => {
    const captured: Captured[] = [];
    await createChatModel(runtimeWithChat(), { target, fetch: completionFetch(captured) }).invoke([new HumanMessage("q")]);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.url, "https://cloud.test/v1/chat/completions");
    assert.equal(captured[0]?.model, "cloud-model");
    assert.equal(captured[0]?.authorization, "Bearer cloud-key");
    assert.equal(captured[0]?.redirect, "manual");
  });

  it("refuses a target without a connection", () => {
    assert.throws(
      () => createChatModel(runtimeWithChat(), { target: { ...target, connection: null, connectionError: "gone" } }),
      /gone/,
    );
  });

  it("checks the target's service and re-checks when its version changes", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: "cloud-model" }] }), { status: 200 });
    }) as typeof fetch;

    const first = await checkChatProvider(runtimeWithChat(), { target, fetch: fetchImpl });
    assert.equal(first.ok, true);
    assert.equal(first.baseUrl, "https://cloud.test/v1");
    await checkChatProvider(runtimeWithChat(), { target, fetch: fetchImpl });
    assert.equal(urls.length, 1, "cached for the same service version");

    await checkChatProvider(runtimeWithChat(), {
      target: { ...target, connection: { ...target.connection!, version: "v2" } },
      fetch: fetchImpl,
    });
    assert.equal(urls.length, 2, "a changed service is checked again");
  });

  it("reports a missing chosen service as not configured with the reason", async () => {
    const status = await checkChatProvider(runtimeWithChat(), {
      target: { ...target, connection: null, connectionError: "the chosen chat service is gone" },
    });
    assert.equal(status.configured, false);
    assert.equal(status.error, "the chosen chat service is gone");
  });
});

describe("chat services: errors and audit", () => {
  it("redacts the called service's key from a chat error and names the service", () => {
    const upstream = Object.assign(new Error("401 bad key cloud-key-xyz"), { status: 401 });
    const error = toChatGenerationError(upstream, {
      source: "tenant",
      serviceId: "cloud",
      model: "m",
      connection: { serviceId: "cloud", baseUrl: "https://cloud.test/v1", apiKey: "cloud-key-xyz", version: "v" },
    }, { embeddingModel: "e", chatModel: "m" });
    assert.ok(error instanceof RagQueryError);
    assert.equal(error.code, "CHAT_PROVIDER_ERROR");
    assert.equal(JSON.stringify({ message: error.message, details: error.details }).includes("cloud-key-xyz"), false);
    assert.equal((error.details as Record<string, unknown>).chatServiceId, "cloud");
  });

  it("records chat service and chat settings changes in the audit log", () => {
    const op = (method: string, path: string) => getHttpOperationTarget({ method, path } as Request)?.operation;
    assert.equal(op("POST", "/v1/admin/chat-services"), "chat_service_create");
    assert.equal(op("PATCH", "/v1/admin/chat-services/x"), "chat_service_update");
    assert.equal(op("DELETE", "/v1/admin/chat-services/x"), "chat_service_delete");
    assert.equal(op("PUT", "/v1/admin/chat-settings"), "chat_settings_update");
    assert.equal(op("DELETE", "/v1/admin/chat-settings"), "chat_settings_reset");
  });
});

describe("chat services API", () => {
  const SECRET = "sk-chat-never-returned-456";
  const MODELS = ["llama3", "gemma3:4b"];
  let server: Server | undefined;
  let baseUrl = "";
  let bodies: string[] = [];

  afterEach(async () => {
    bodies = [];
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  /** A provider check without network: services whose URL contains "down" are unreachable; MODELS are listed. */
  async function fakeChatProvider(_cfg: ResolvedConfig, options: { target?: ChatTarget } = {}) {
    const target = options.target;
    if (!target?.connection || !target.model) {
      return {
        configured: false, baseUrl: null, model: null, reachable: false, authOk: false,
        modelListed: "unknown" as const, ok: false, latencyMs: 0,
        ...(target?.connectionError ? { error: target.connectionError } : {}),
      };
    }
    const down = target.connection.baseUrl.includes("down");
    const listed = !down && MODELS.includes(target.model);
    return {
      configured: true,
      baseUrl: target.connection.baseUrl,
      model: target.model,
      reachable: !down,
      authOk: !down,
      modelListed: down ? "unknown" as const : listed,
      ok: listed,
      latencyMs: 0,
      ...(down ? { error: "connect ECONNREFUSED" } : { availableModels: MODELS }),
    };
  }

  async function start(options: {
    serverChat?: { baseUrl: string; model: string };
    adminAuth?: ReturnType<typeof createAdminAuthService>;
    authConfig?: any;
    answers?: Array<Record<string, any>>;
  } = {}) {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const runtimeConfig: ResolvedConfig = {
      ...config,
      rateLimitEnabled: false,
      adminAuth: options.authConfig ?? { ...config.adminAuth, enabled: false },
      embedding: { ...config.embedding, provider: "builtin", baseUrl: "", apiKey: undefined, apiKeySource: "none" },
      chat: options.serverChat
        ? { ...runtimeWithChat().chat, ...options.serverChat, apiKey: undefined, apiKeySource: "none" }
        : runtimeWithoutChat().chat,
    };
    const app = createApp({
      runtimeConfig,
      registry,
      adminAuth: options.adminAuth,
      jobRunner: { start: () => {}, abort: () => false, drain: async () => {}, shutdown: async () => {} } as any,
      ragHandlers: {
        resolveReadableCollection: async (req: any) =>
          registry.getVisibleCollection({ tenantId: "default", userId: "u", requestId: "r" }, req.params.collectionId),
        answerQuestion: async (_question: string, opts: any) => {
          options.answers?.push(opts.chatTarget);
          return {
            answer: "stub",
            embeddingProvider: opts.embeddingProvider,
            embeddingModel: opts.embeddingModel,
            chatModel: opts.chatTarget.model,
            chatServiceId: opts.chatTarget.serviceId,
            distanceScoreThreshold: 1,
            sources: [],
          };
        },
      } as any,
      healthChecks: {
        checkChromaHealth: async () => ({ ok: true, latencyMs: 0, details: { collectionReadable: true, collectionCount: 1 } }),
        checkEmbeddingTarget: async (_cfg: ResolvedConfig, target: any) => ({
          provider: target.provider, model: target.model, configured: true, supported: true,
          reachable: true, authOk: true, modelListed: true, ok: true, latencyMs: 0,
        }),
        checkIndexingSourceHealth: async () => ({ ok: true, latencyMs: 0 }),
        listEmbeddingModels: async () => ({
          default: { provider: "builtin", model: "m" },
          providers: {
            builtin: { models: [], cacheDir: "models" },
            "openai-compatible": { configured: false, baseUrl: null, reachable: false, models: [] },
          },
          embeddingServices: [],
        }),
        checkChatProvider: fakeChatProvider,
        checkChatConnection: async (_cfg: ResolvedConfig, connection: any, name: string) => ({
          id: connection.serviceId, name, reachable: true, authOk: true, models: MODELS,
        }),
      } as any,
    });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    return registry;
  }

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    bodies.push(text);
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function indexedCollection(registry: CollectionRegistry) {
    const context = { tenantId: "default", userId: "u", requestId: "r" };
    const collection = await registry.createCollection(context, {
      displayName: "Docs",
      sourcePath: "data",
      embeddingProvider: "builtin",
      embeddingModel: "m",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 100,
      retrievalK: 5,
      retrievalDistanceThreshold: 1.2,
    });
    await registry.updateCollection(context, collection.id, {
      status: "ready",
      activePhysicalCollection: "docs-v1",
      activeVersion: "v1",
      activeEmbeddingProvider: "builtin",
      activeEmbeddingModel: "m",
    });
    return collection.id;
  }

  it("manages chat services over the API and never returns an API key", async () => {
    await start({ serverChat: { baseUrl: "http://server-chat.test/v1", model: "llama3" } });
    const initial = await call("GET", "/v1/admin/chat-services");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.services.map((s: any) => [s.id, s.source, s.readOnly, s.configured, s.inUse]), [
      ["server", "server", true, true, true],
    ]);
    assert.equal(initial.body.services[0].defaultModel, "llama3");
    assert.equal(initial.body.warnings.length, 1, "auth is off: the API warns every client");

    const created = await call("POST", "/v1/admin/chat-services", { name: "Cloud", baseUrl: "https://cloud.test/v1/", apiKey: SECRET });
    assert.equal(created.status, 201);
    const id = created.body.service.id;
    assert.equal(created.body.service.baseUrl, "https://cloud.test/v1");
    assert.equal(created.body.service.apiKeyConfigured, true);
    assert.equal(created.body.service.inUse, false);

    assert.equal((await call("POST", "/v1/admin/chat-services", { name: "cloud", baseUrl: "http://x.test" })).status, 400, "names are unique per tenant");
    assert.equal((await call("POST", "/v1/admin/chat-services", { name: "Bad", baseUrl: "ftp://x.test" })).status, 400);
    const duplicate = await call("POST", "/v1/admin/chat-services", { name: "Same URL", baseUrl: "https://cloud.test/v1" });
    assert.equal(duplicate.status, 201, "a duplicate URL only warns");
    assert.match(duplicate.body.warnings.join(" "), /also used by "Cloud"/);
    assert.equal((await call("PATCH", "/v1/admin/chat-services/server", { name: "x" })).body.code, "CHAT_SERVICE_READ_ONLY");
    assert.equal((await call("DELETE", "/v1/admin/chat-services/nope")).body.code, "CHAT_SERVICE_NOT_FOUND");

    const renamed = await call("PATCH", `/v1/admin/chat-services/${id}`, { name: "Cloud LLM", apiKey: null });
    assert.equal(renamed.body.service.name, "Cloud LLM");
    assert.equal(renamed.body.service.apiKeyConfigured, false);
    await call("PATCH", `/v1/admin/chat-services/${id}`, { apiKey: SECRET });

    const tested = await call("POST", "/v1/admin/chat-services/test", { serviceId: id });
    assert.equal(tested.status, 200);
    assert.deepEqual(tested.body.models, MODELS);
    assert.equal(tested.body.ok, true);
    assert.equal((await call("POST", "/v1/admin/chat-services/test", { serviceId: "server" })).status, 200);
    assert.equal((await call("POST", "/v1/admin/chat-services/test", { baseUrl: "http://localhost:11434/v1", apiKey: SECRET })).body.ok, true);
    assert.equal((await call("POST", "/v1/admin/chat-services/test", { serviceId: "nope" })).status, 404);

    const models = await call("GET", "/v1/admin/models");
    assert.deepEqual(models.body.chatServices.map((s: any) => s.id), ["server", id, duplicate.body.service.id]);
    assert.deepEqual(models.body.chatServices[1].models, MODELS);

    assert.equal((await call("DELETE", `/v1/admin/chat-services/${duplicate.body.service.id}`)).status, 204);
    assert.equal(bodies.some((text) => text.includes(SECRET)), false, "no response ever contains the key");
    assert.equal(bodies.some((text) => /"apiKey"\s*:/.test(text)), false, "no response has an apiKey field");
  });

  it("chooses the tenant's chat LLM, refuses missing models and protects the chosen service", async () => {
    await start();
    const none = await call("GET", "/v1/admin/chat-settings");
    assert.equal(none.status, 200);
    assert.equal(none.body.source, "none");
    assert.equal(none.body.queryEnabled, false);
    assert.equal((await call("GET", "/ready")).body.queryEnabled, false);

    const id = (await call("POST", "/v1/admin/chat-services", { name: "Ollama", baseUrl: "http://ollama.test/v1", apiKey: SECRET })).body.service.id;

    assert.equal((await call("PUT", "/v1/admin/chat-settings", { serviceId: "nope", model: "llama3" })).body.code, "CHAT_SERVICE_NOT_FOUND");
    assert.equal((await call("PUT", "/v1/admin/chat-settings", { serviceId: "server", model: "llama3" })).body.code, "CHAT_SERVICE_NOT_FOUND",
      "the server service only exists when .env / config sets it");
    assert.equal((await call("PUT", "/v1/admin/chat-settings", { serviceId: id })).status, 400);
    const missing = await call("PUT", "/v1/admin/chat-settings", { serviceId: id, model: "absent" });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, "CHAT_MODEL_MISSING");
    assert.deepEqual(missing.body.details.availableModels, MODELS);
    assert.equal((await call("GET", "/v1/admin/chat-settings")).body.source, "none", "a refused choice is not saved");

    const chosen = await call("PUT", "/v1/admin/chat-settings", { serviceId: id, model: "llama3" });
    assert.equal(chosen.status, 200);
    assert.deepEqual(
      [chosen.body.settings.source, chosen.body.settings.serviceId, chosen.body.settings.serviceName, chosen.body.settings.model],
      ["tenant", id, "Ollama", "llama3"],
    );
    assert.equal(chosen.body.settings.queryEnabled, true);
    assert.equal(chosen.body.settings.status.ok, true);
    assert.equal(chosen.body.settings.status.code, "CHAT_MODEL_AVAILABLE");

    const list = await call("GET", "/v1/admin/chat-services");
    assert.equal(list.body.services.find((s: any) => s.id === id).inUse, true);
    const inUse = await call("DELETE", `/v1/admin/chat-services/${id}`);
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.code, "CHAT_SERVICE_IN_USE");

    const ready = await call("GET", "/ready");
    assert.equal(ready.body.queryEnabled, true);
    assert.equal(ready.body.config.chatServiceId, id);
    assert.equal(ready.body.config.chatModel, "llama3");
    const otherTenant = await call("GET", "/ready", undefined, { "x-tenant-id": "other" });
    assert.equal(otherTenant.body.queryEnabled, false, "another tenant has its own choice");

    const reset = await call("DELETE", "/v1/admin/chat-settings");
    assert.equal(reset.status, 200);
    assert.equal(reset.body.settings.source, "none");
    assert.equal((await call("DELETE", `/v1/admin/chat-services/${id}`)).status, 204);
    assert.equal(bodies.some((text) => text.includes(SECRET)), false);
  });

  it("saves a choice while the service is down, with a warning", async () => {
    await start();
    const id = (await call("POST", "/v1/admin/chat-services", { name: "Down", baseUrl: "http://down.test/v1" })).body.service.id;
    const saved = await call("PUT", "/v1/admin/chat-settings", { serviceId: id, model: "any" });
    assert.equal(saved.status, 200);
    assert.match(saved.body.warnings.join(" "), /cannot be used yet/);
    assert.equal(saved.body.settings.status.ok, false);
    assert.equal(saved.body.settings.status.code, "CHAT_PROVIDER_UNREACHABLE");
  });

  it("answers /query with the tenant's chat service, uses changes at once and names the service", async () => {
    const answers: Array<Record<string, any>> = [];
    const registry = await start({ answers });
    const collectionId = await indexedCollection(registry);

    const notConfigured = await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(notConfigured.status, 503);
    assert.equal(notConfigured.body.code, "CHAT_NOT_CONFIGURED");
    assert.match(notConfigured.body.message, /PUT \/v1\/admin\/chat-settings/);

    const id = (await call("POST", "/v1/admin/chat-services", { name: "Cloud", baseUrl: "https://cloud.test/v1", apiKey: SECRET })).body.service.id;
    await call("PUT", "/v1/admin/chat-settings", { serviceId: id, model: "gemma3:4b" });

    const answered = await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(answered.status, 200);
    assert.equal(answered.body.chatServiceId, id);
    assert.equal(answered.body.chatModel, "gemma3:4b");
    assert.equal(answers[0]?.connection.baseUrl, "https://cloud.test/v1");

    await call("PATCH", `/v1/admin/chat-services/${id}`, { baseUrl: "https://cloud2.test/v1" });
    await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(answers[1]?.connection.baseUrl, "https://cloud2.test/v1", "no restart needed");

    const ready = await call("GET", `/v1/rag/collections/${collectionId}/ready`);
    assert.equal(ready.body.modelAvailability.chatServiceId, id);
    assert.equal(ready.body.modelAvailability.chatModel, "gemma3:4b");
    assert.equal(bodies.some((text) => text.includes(SECRET)), false);
  });

  it("uses the server's chat LLM until the tenant chooses, and reports a chosen service that is gone", async () => {
    const answers: Array<Record<string, any>> = [];
    const registry = await start({ serverChat: { baseUrl: "http://server-chat.test/v1", model: "llama3" }, answers });
    const collectionId = await indexedCollection(registry);

    const settings = await call("GET", "/v1/admin/chat-settings");
    assert.deepEqual([settings.body.source, settings.body.serviceId, settings.body.model], ["server", "server", "llama3"]);
    const answered = await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(answered.body.chatServiceId, "server");

    // The tenant picks the server service with another model.
    const chosen = await call("PUT", "/v1/admin/chat-settings", { serviceId: "server", model: "gemma3:4b" });
    assert.equal(chosen.body.settings.source, "tenant");
    await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(answers[1]?.model, "gemma3:4b");

    // A choice whose service is gone blocks /query with a clear reason instead of using another service.
    await registry.setChatSettings({ tenantId: "default", userId: "u", requestId: "r" }, { serviceId: "deleted", model: "llama3" });
    const gone = await call("POST", `/v1/rag/collections/${collectionId}/query`, { question: "hi" });
    assert.equal(gone.status, 503);
    assert.equal(gone.body.code, "CHAT_NOT_CONFIGURED");
    assert.match(gone.body.message, /does not exist any more/);
    const ready = await call("GET", "/ready");
    assert.equal(ready.body.queryEnabled, true);
    assert.equal(ready.body.queryReady, false);
    assert.ok(ready.body.blockerCodes.includes("CHAT_SERVICE_NOT_FOUND"));
  });

  it("lets only admins manage chat services and the chat choice when admin auth is on", async () => {
    const passwordHash = hashPassword("secret");
    const authConfig = {
      enabled: true,
      cookieName: "rag_admin_session",
      sessionTtlMs: 60_000,
      actionTokenTtlMs: 30_000,
      sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
      users: [
        { username: "viewer", passwordHash, role: "viewer" as const, tenantId: "default" },
        { username: "operator", passwordHash, role: "operator" as const, tenantId: "default" },
        { username: "admin", passwordHash, role: "admin" as const, tenantId: "default" },
      ],
    };
    const adminAuth = createAdminAuthService({ config: authConfig, env: { RAG_ADMIN_SESSION_SECRET: "s" } });
    await start({ adminAuth, authConfig, serverChat: { baseUrl: "http://server-chat.test/v1", model: "llama3" } });
    const login = async (username: string) => {
      const response = await fetch(`${baseUrl}/v1/admin/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "secret" }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const token = (cookie: string, method: string, path: string) => call("POST", "/v1/admin/auth/action-token", { method, path }, { cookie });

    const viewer = await login("viewer");
    assert.equal((await call("GET", "/v1/admin/chat-services", undefined, { cookie: viewer })).status, 200);
    assert.equal((await call("GET", "/v1/admin/chat-settings", undefined, { cookie: viewer })).status, 200);
    assert.equal((await token(viewer, "PUT", "/v1/admin/chat-settings")).status, 403);

    const operator = await login("operator");
    assert.equal((await token(operator, "POST", "/v1/admin/chat-services")).status, 403);
    assert.equal((await token(operator, "PUT", "/v1/admin/chat-settings")).status, 403);
    assert.equal((await call("POST", "/v1/admin/chat-services/test", { baseUrl: "http://x.test/v1" }, { cookie: operator })).status, 403);

    const admin = await login("admin");
    assert.deepEqual((await call("GET", "/v1/admin/chat-services", undefined, { cookie: admin })).body.warnings, []);
    const body = { serviceId: "server", model: "gemma3:4b" };
    assert.equal((await call("PUT", "/v1/admin/chat-settings", body, { cookie: admin })).status, 403, "action token required");
    const putToken = (await token(admin, "PUT", "/v1/admin/chat-settings")).body.actionToken;
    const saved = await call("PUT", "/v1/admin/chat-settings", body, { cookie: admin, "x-admin-action-token": putToken });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.model, "gemma3:4b");
    const deleteToken = (await token(admin, "DELETE", "/v1/admin/chat-settings")).body.actionToken;
    const reset = await call("DELETE", "/v1/admin/chat-settings", undefined, { cookie: admin, "x-admin-action-token": deleteToken });
    assert.equal(reset.body.settings.source, "server");
  });
});
