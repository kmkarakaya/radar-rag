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
