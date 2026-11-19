import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCollectionIndexState, normalizeEmbeddingServiceId, parseCollectionIndexSnapshot } from "../src/collections/indexState.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry, CreateCollectionInput } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import {
  checkEmbeddingTarget,
  clearEmbeddingInstances,
  connectionForTarget,
  EmbeddingProviderNotConfiguredError,
  getEmbeddings,
} from "../src/embeddings/index.js";
import { resolveEmbeddingTarget } from "../src/embeddings/services.js";
import { runIndexJob } from "../src/indexing/jobs.js";
import { clearProviderStatusCache } from "../src/providers/openaiCompatible.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createAdminAuthService } from "../src/http/adminAuth.js";
import { hashPassword } from "../src/admin/passwordHash.js";

const tenantA = { tenantId: "tenant-a", userId: "admin", requestId: "r1" };
const tenantB = { tenantId: "tenant-b", userId: "admin", requestId: "r2" };

const openaiInput = (extra: Partial<CreateCollectionInput> = {}): CreateCollectionInput => ({
  displayName: "External",
  sourcePath: "data",
  embeddingProvider: "openai-compatible",
  embeddingModel: "bge-m3",
  distanceMetric: "l2",
  chunkSize: 500,
  chunkOverlap: 100,
  retrievalK: 5,
  retrievalDistanceThreshold: 1.2,
  ...extra,
});

async function completeJob(registry: CollectionRegistry, context: typeof tenantA, collectionId: string) {
  const queued = await registry.beginIndexJob(context, collectionId);
  const running = await registry.markIndexJobRunning(queued.id);
  await registry.createPhysicalCollectionRecord({
    name: running.targetPhysicalCollection,
    tenantId: context.tenantId,
    collectionId,
    version: running.targetVersion,
    chromaConfiguration: running.targetChromaConfiguration,
  });
  await registry.completeIndexJob(running.id, {
    activePhysicalCollection: running.targetPhysicalCollection,
    activeVersion: running.targetVersion,
    documentCount: 1,
    chunkCount: 1,
    retentionMs: 1000,
  });
  return running;
}

describe("embedding services in the registry", () => {
  it("creates, lists, updates and deletes a tenant's services; other tenants never see them", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const created = await registry.createEmbeddingService(tenantA, {
      displayName: "Ollama",
      baseUrl: "http://host.docker.internal:11434/v1",
    });
    assert.match(created.id, /^ollama-[a-f0-9]{10}$/);
    assert.equal(created.apiKey, undefined);

    assert.deepEqual((await registry.listEmbeddingServices(tenantA)).map((service) => service.id), [created.id]);
    assert.deepEqual(await registry.listEmbeddingServices(tenantB), []);
    assert.equal(await registry.getEmbeddingService(tenantB, created.id), null);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await registry.updateEmbeddingService(tenantA, created.id, { apiKey: "sk-test", displayName: "Ollama local" });
    assert.equal(updated.apiKey, "sk-test");
    assert.equal(updated.displayName, "Ollama local");
    assert.notEqual(updated.updatedAt, created.updatedAt, "a changed key must change updatedAt (cache key)");

    const cleared = await registry.updateEmbeddingService(tenantA, created.id, { apiKey: null });
    assert.equal(cleared.apiKey, undefined);

    await assert.rejects(() => registry.deleteEmbeddingService(tenantB, created.id));
    await registry.deleteEmbeddingService(tenantA, created.id);
    assert.deepEqual(await registry.listEmbeddingServices(tenantA), []);
  });

  it("finds the collections that use a service, counting older openai-compatible collections as 'server'", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const service = await registry.createEmbeddingService(tenantA, { displayName: "OpenAI", baseUrl: "https://api.openai.com/v1" });
    const withService = await registry.createCollection(tenantA, openaiInput({ displayName: "Uses service", embeddingServiceId: service.id }));
    const legacy = await registry.createCollection(tenantA, openaiInput({ displayName: "Legacy" }));
    await registry.createCollection(tenantA, openaiInput({ displayName: "Builtin", embeddingProvider: "builtin", embeddingModel: "m" }));

    assert.equal(withService.embeddingServiceId, service.id);
    assert.equal(legacy.embeddingServiceId, undefined);
    assert.deepEqual((await registry.listCollectionsUsingEmbeddingService(tenantA, service.id)).map((c) => c.id), [withService.id]);
    assert.deepEqual((await registry.listCollectionsUsingEmbeddingService(tenantA, "server")).map((c) => c.id), [legacy.id]);
    assert.deepEqual(await registry.listCollectionsUsingEmbeddingService(tenantB, service.id), []);

    // The active embedding also counts: switching a collection away keeps the old service in use until re-index.
    await completeJob(registry, tenantA, withService.id);
    await registry.updateCollection(tenantA, withService.id, { embeddingServiceId: null });
    assert.deepEqual((await registry.listCollectionsUsingEmbeddingService(tenantA, service.id)).map((c) => c.id), [withService.id]);
  });

  it("copies the service to the index job and makes it the active service when the job succeeds", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const service = await registry.createEmbeddingService(tenantA, { displayName: "Ollama", baseUrl: "http://ollama:11434/v1" });
    const collection = await registry.createCollection(tenantA, openaiInput({ embeddingServiceId: service.id }));

    const job = await completeJob(registry, tenantA, collection.id);
    assert.equal(job.targetEmbeddingServiceId, service.id);
    const indexed = await registry.getVisibleCollection(tenantA, collection.id);
    assert.equal(indexed?.activeEmbeddingServiceId, service.id);
    assert.equal(indexed?.indexState?.status, "synced");

    // Switching the service needs a re-index, like switching the model.
    await registry.updateCollection(tenantA, collection.id, { embeddingServiceId: "server" });
    const switched = await registry.getVisibleCollection(tenantA, collection.id);
    assert.equal(switched?.indexState?.status, "reindex_required");
    assert.deepEqual(switched?.indexState?.changedFields, ["embeddingServiceId"]);
  });

  it("keeps collections indexed before embedding services in sync (no false re-index)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "radar-rag-es-legacy-"));
    const dbPath = path.join(dir, "registry.sqlite");
    try {
      const registry = createSqliteCollectionRegistry({ dbPath });
      const legacy = await registry.createCollection(tenantA, openaiInput({ displayName: "Indexed before" }));
      await completeJob(registry, tenantA, legacy.id);
      (registry as unknown as { close(): void }).close();

      // Rewrite the stored snapshot and job target as an older version wrote them: no service id at all.
      const db = new Database(dbPath);
      const row = db.prepare("SELECT indexed_snapshot_json FROM collections WHERE id = ?").get(legacy.id) as { indexed_snapshot_json: string };
      const oldSnapshot = JSON.parse(row.indexed_snapshot_json);
      delete oldSnapshot.embeddingServiceId;
      db.prepare("UPDATE collections SET indexed_snapshot_json = ?, active_embedding_service_id = NULL WHERE id = ?")
        .run(JSON.stringify(oldSnapshot), legacy.id);
      db.close();

      const reopened = createSqliteCollectionRegistry({ dbPath });
      const collection = await reopened.getVisibleCollection(tenantA, legacy.id);
      assert.equal(collection?.indexState?.status, "synced");
      assert.equal(collection?.indexState?.activeSnapshot?.embeddingServiceId, "server");
      (reopened as unknown as { close(): void }).close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes service ids so older records compare equal to new ones", () => {
    assert.equal(normalizeEmbeddingServiceId("builtin", "anything"), null);
    assert.equal(normalizeEmbeddingServiceId("openai-compatible", undefined), "server");
    assert.equal(normalizeEmbeddingServiceId("openai-compatible", "ollama-1"), "ollama-1");
    const parsed = parseCollectionIndexSnapshot({
      sourcePath: "data",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 100,
      embeddingProvider: "builtin",
      embeddingModel: "m",
    });
    assert.equal(parsed?.embeddingServiceId, null);
    const state = buildCollectionIndexState(
      { sourcePath: "data", distanceMetric: "l2", chunkSize: 500, chunkOverlap: 100, embeddingProvider: "builtin", embeddingModel: "m", activePhysicalCollection: "x" },
      parsed,
    );
    assert.equal(state.status, "synced");
  });
});


describe("embedding service connections", () => {
  const runtimeConfig: ResolvedConfig = {
    ...config,
    embedding: { ...config.embedding, provider: "builtin", baseUrl: "http://server.test/v1", apiKey: "server-key", apiKeySource: "env" },
  };

  afterEach(() => {
    clearEmbeddingInstances();
    clearProviderStatusCache();
  });

  function recordingFetch(requests: Array<{ url: string; auth: string | null; redirect?: RequestInit["redirect"] }>) {
    return (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "bge-m3" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.5, 0.5] }],
        model: "bge-m3",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  it("resolves 'server', a stored service, and a missing service (never falling back to 'server')", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const service = await registry.createEmbeddingService(tenantA, { displayName: "OpenAI", baseUrl: "https://api.openai.test/v1", apiKey: "sk-service" });

    const server = await resolveEmbeddingTarget({ registry, runtimeConfig, context: tenantA, target: { provider: "openai-compatible", model: "m" } });
    assert.equal(server.serviceId, "server");
    assert.equal(server.connection?.baseUrl, "http://server.test/v1");

    const stored = await resolveEmbeddingTarget({ registry, runtimeConfig, context: tenantA, target: { provider: "openai-compatible", model: "m", serviceId: service.id } });
    assert.equal(stored.connection?.baseUrl, "https://api.openai.test/v1");
    assert.equal(stored.connection?.apiKey, "sk-service");

    // Another tenant's service, or a deleted one, is not usable.
    const otherTenant = await resolveEmbeddingTarget({ registry, runtimeConfig, context: tenantB, target: { provider: "openai-compatible", model: "m", serviceId: service.id } });
    assert.equal(otherTenant.connection, null);
    assert.throws(() => getEmbeddings(runtimeConfig, otherTenant), EmbeddingProviderNotConfiguredError);
    const status = await checkEmbeddingTarget(runtimeConfig, otherTenant);
    assert.equal(status.configured, false);
    assert.match(status.error ?? "", /does not exist/);

    // An unresolved named service is never sent to "server" either.
    assert.equal(connectionForTarget(runtimeConfig, { provider: "openai-compatible", model: "m", serviceId: service.id }), null);

    const builtin = await resolveEmbeddingTarget({ registry, runtimeConfig, context: tenantA, target: { provider: "builtin", model: "x", serviceId: service.id } });
    assert.equal(builtin.connection, undefined);
  });

  it("embeds and checks through the service's own URL and key, without following redirects", async () => {
    const requests: Array<{ url: string; auth: string | null; redirect?: RequestInit["redirect"] }> = [];
    const target = {
      provider: "openai-compatible" as const,
      model: "bge-m3",
      serviceId: "openai-1",
      connection: { serviceId: "openai-1", baseUrl: "https://api.openai.test/v1", apiKey: "sk-service", version: "v1" },
    };
    const embeddings = getEmbeddings(runtimeConfig, target, { fetch: recordingFetch(requests) });
    assert.deepEqual(await embeddings.embedQuery("hello"), [0.5, 0.5]);
    const status = await checkEmbeddingTarget(runtimeConfig, target, { fetch: recordingFetch(requests) });
    assert.equal(status.ok, true);
    assert.deepEqual(requests.map((request) => [request.url, request.auth]), [
      ["https://api.openai.test/v1/embeddings", "Bearer sk-service"],
      ["https://api.openai.test/v1/models", "Bearer sk-service"],
    ]);
    // Document text and the key only go to the URL the admin entered.
    assert.deepEqual(requests.map((request) => request.redirect), ["manual", "manual"]);
  });

  it("uses a new client when a service's URL or key changes (no restart)", () => {
    const base = { provider: "openai-compatible" as const, model: "bge-m3", serviceId: "svc" };
    const first = getEmbeddings(runtimeConfig, { ...base, connection: { serviceId: "svc", baseUrl: "http://a/v1", apiKey: "k1", version: "1" } });
    const same = getEmbeddings(runtimeConfig, { ...base, connection: { serviceId: "svc", baseUrl: "http://a/v1", apiKey: "k1", version: "1" } });
    const changed = getEmbeddings(runtimeConfig, { ...base, connection: { serviceId: "svc", baseUrl: "http://a/v1", apiKey: "k2", version: "2" } });
    assert.equal(first, same);
    assert.notEqual(first, changed);
  });

  it("never stores a service's API key in an index job error", async () => {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const service = await registry.createEmbeddingService(tenantA, { displayName: "Cloud", baseUrl: "https://cloud.test/v1", apiKey: "sk-very-secret-key" });
    const collection = await registry.createCollection(tenantA, openaiInput({ embeddingServiceId: service.id }));
    const job = await registry.beginIndexJob(tenantA, collection.id);

    const failed = await runIndexJob({
      registry,
      jobId: job.id,
      runtimeConfig,
      log: () => {},
      deps: {
        buildPhysicalCollection: async (input) => {
          assert.equal(input.embeddingTarget?.connection?.baseUrl, "https://cloud.test/v1");
          throw new Error("401 Unauthorized: invalid key sk-very-secret-key");
        },
      },
    });
    assert.equal(failed.status, "failed");
    assert.doesNotMatch(failed.error ?? "", /sk-very-secret-key/);
    assert.match(failed.error ?? "", /401 Unauthorized/);
  });
});


describe("embedding services API", () => {
  const SECRET = "sk-never-returned-123";
  let server: Server | undefined;
  let baseUrl = "";
  const bodies: string[] = [];

  afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  async function start(options: {
    serverBaseUrl?: string;
    adminAuth?: ReturnType<typeof createAdminAuthService>;
    authConfig?: any;
    ragHandlers?: any;
  } = {}) {
    const registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const runtimeConfig: ResolvedConfig = {
      ...config,
      rateLimitEnabled: false,
      adminAuth: options.authConfig ?? { ...config.adminAuth, enabled: false },
      embedding: { ...config.embedding, provider: "builtin", baseUrl: options.serverBaseUrl ?? "", apiKey: undefined, apiKeySource: "none" },
    };
    const app = createApp({
      runtimeConfig,
      registry,
      adminAuth: options.adminAuth,
      ragHandlers: options.ragHandlers,
      jobRunner: { start: () => {}, abort: () => false, drain: async () => {}, shutdown: async () => {} } as any,
      healthChecks: {
        // Configured when the resolved target has a connection; every model is listed. No network.
        checkEmbeddingTarget: async (cfg: ResolvedConfig, target: any) => {
          const configured = target.provider === "builtin" || Boolean(connectionForTarget(cfg, target));
          return {
            provider: target.provider,
            model: target.model,
            configured,
            supported: true,
            reachable: configured,
            authOk: configured,
            modelListed: configured,
            ok: configured,
            latencyMs: 0,
            ...(configured ? {} : { error: "No embedding service is configured" }),
          };
        },
        listEmbeddingModels: async (_cfg: ResolvedConfig, opts: any = {}) => ({
          default: { provider: "builtin", model: "m" },
          providers: {
            builtin: { models: [], cacheDir: "models" },
            "openai-compatible": { configured: false, baseUrl: null, reachable: false, models: [] },
          },
          embeddingServices: (opts.services ?? []).map((service: any) => ({
            id: service.connection.serviceId,
            name: service.name,
            reachable: true,
            authOk: true,
            models: ["bge-m3"],
          })),
        }),
        checkEmbeddingConnection: async (_cfg: ResolvedConfig, connection: any, name: string) => ({
          id: connection.serviceId,
          name,
          reachable: true,
          authOk: true,
          models: ["bge-m3", "nomic-embed-text"],
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

  it("manages services over the API and never returns an API key", async () => {
    await start({ serverBaseUrl: "http://server.test/v1" });
    const initial = await call("GET", "/v1/admin/embedding-services");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.services.map((s: any) => [s.id, s.source, s.readOnly, s.configured]), [
      ["builtin", "builtin", true, true],
      ["server", "server", true, true],
    ]);
    assert.equal(initial.body.warnings.length, 1, "auth is off: the API warns every client");

    const created = await call("POST", "/v1/admin/embedding-services", { name: "OpenAI", baseUrl: "https://api.openai.test/v1/", apiKey: SECRET });
    assert.equal(created.status, 201);
    const id = created.body.service.id;
    assert.equal(created.body.service.baseUrl, "https://api.openai.test/v1");
    assert.equal(created.body.service.apiKeyConfigured, true);

    assert.equal((await call("POST", "/v1/admin/embedding-services", { name: "openai", baseUrl: "http://x.test" })).status, 400, "names are unique per tenant");
    assert.equal((await call("POST", "/v1/admin/embedding-services", { name: "Bad", baseUrl: "ftp://x.test" })).status, 400);
    assert.equal((await call("PATCH", "/v1/admin/embedding-services/server", { name: "x" })).body.code, "EMBEDDING_SERVICE_READ_ONLY");
    assert.equal((await call("DELETE", "/v1/admin/embedding-services/nope")).body.code, "EMBEDDING_SERVICE_NOT_FOUND");

    const cleared = await call("PATCH", `/v1/admin/embedding-services/${id}`, { name: "OpenAI cloud", apiKey: null });
    assert.equal(cleared.body.service.name, "OpenAI cloud");
    assert.equal(cleared.body.service.apiKeyConfigured, false);
    await call("PATCH", `/v1/admin/embedding-services/${id}`, { apiKey: SECRET });

    const tested = await call("POST", "/v1/admin/embedding-services/test", { serviceId: id });
    assert.equal(tested.status, 200);
    assert.deepEqual(tested.body.models, ["bge-m3", "nomic-embed-text"]);
    const adHoc = await call("POST", "/v1/admin/embedding-services/test", { baseUrl: "http://localhost:11434/v1", apiKey: SECRET });
    assert.equal(adHoc.body.ok, true);
    assert.equal((await call("POST", "/v1/admin/embedding-services/test", { serviceId: "nope" })).status, 404);

    const models = await call("GET", "/v1/admin/models");
    assert.deepEqual(models.body.embeddingServices.map((s: any) => s.id), [id]);

    assert.equal(bodies.some((text) => text.includes(SECRET)), false, "no response ever contains the key");
    assert.equal(bodies.some((text) => /"apiKey"\s*:/.test(text)), false, "no response has an apiKey field");
  });

  it("lets collections use a service, chooses a default on the server, and protects services in use", async () => {
    const registry = await start();
    const one = (await call("POST", "/v1/admin/embedding-services", { name: "Ollama", baseUrl: "http://ollama.test/v1" })).body.service.id;

    // No server service configured and exactly one stored service: the server picks it.
    const auto = await call("POST", "/v1/admin/collections", { displayName: "Auto", embeddingProvider: "openai-compatible", embeddingModel: "bge-m3" });
    assert.equal(auto.status, 201);
    assert.equal(auto.body.collection.embeddingServiceId, one);
    const detail = await call("GET", `/v1/admin/collections/${auto.body.collection.id}`);
    assert.equal(detail.body.collection.embeddingServiceId, one);

    const two = (await call("POST", "/v1/admin/embedding-services", { name: "Second", baseUrl: "http://second.test/v1" })).body.service.id;
    const ambiguous = await call("POST", "/v1/admin/collections", { displayName: "Which", embeddingProvider: "openai-compatible", embeddingModel: "bge-m3" });
    assert.equal(ambiguous.status, 400);
    assert.match(ambiguous.body.message, /embeddingServiceId/);

    assert.equal(
      (await call("POST", "/v1/admin/collections", { displayName: "Unknown", embeddingProvider: "openai-compatible", embeddingModel: "m", embeddingServiceId: "nope" })).body.code,
      "EMBEDDING_SERVICE_NOT_FOUND",
    );
    assert.equal((await call("POST", "/v1/admin/collections", { displayName: "Builtin", embeddingProvider: "builtin", embeddingServiceId: one })).status, 400);
    assert.equal(
      (await call(
        "POST",
        "/v1/admin/collections",
        { displayName: "Other tenant", embeddingProvider: "openai-compatible", embeddingModel: "m", embeddingServiceId: one },
        { "x-tenant-id": "other" },
      )).body.code,
      "EMBEDDING_SERVICE_NOT_FOUND",
    );

    // Switching service: validate reports it as a re-index field; PATCH checks the id.
    const validation = await call("POST", `/v1/admin/collections/${auto.body.collection.id}/validate`, { embeddingServiceId: two });
    assert.ok(validation.body.impact.reindexFields.includes("embeddingServiceId"));
    assert.equal((await call("PATCH", `/v1/admin/collections/${auto.body.collection.id}`, { embeddingServiceId: "nope" })).status, 404);
    assert.equal((await call("PATCH", `/v1/admin/collections/${auto.body.collection.id}`, { embeddingServiceId: two })).status, 200);
    const switched = await registry.getVisibleCollection({ tenantId: "default", userId: "u", requestId: "r" }, auto.body.collection.id);
    assert.equal(switched?.embeddingServiceId, two);

    const inUse = await call("DELETE", `/v1/admin/embedding-services/${two}`);
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.code, "EMBEDDING_SERVICE_IN_USE");
    assert.deepEqual(inUse.body.details.collections.map((c: any) => c.id), [auto.body.collection.id]);
    assert.equal((await call("DELETE", `/v1/admin/embedding-services/${one}`)).status, 204);
  });

  it("lists the built-in model read-only, with its models and the collections that use it", async () => {
    const registry = await start();
    const context = { tenantId: "default", userId: "u", requestId: "r" };
    await registry.createCollection(context, openaiInput({ displayName: "Inside", embeddingProvider: "builtin", embeddingModel: "m" }));
    await registry.createCollection(context, openaiInput({ displayName: "Outside" }));

    const list = await call("GET", "/v1/admin/embedding-services");
    const builtin = list.body.services.find((service: any) => service.id === "builtin");
    assert.deepEqual(
      { source: builtin.source, readOnly: builtin.readOnly, baseUrl: builtin.baseUrl, apiKeyConfigured: builtin.apiKeyConfigured, collectionCount: builtin.collectionCount },
      { source: "builtin", readOnly: true, baseUrl: null, apiKeyConfigured: false, collectionCount: 1 },
    );
    assert.ok(builtin.models.includes("onnx-community/embeddinggemma-2-ONNX"));

    assert.equal((await call("PATCH", "/v1/admin/embedding-services/builtin", { name: "x" })).body.code, "EMBEDDING_SERVICE_READ_ONLY");
    assert.equal((await call("DELETE", "/v1/admin/embedding-services/builtin")).body.code, "EMBEDDING_SERVICE_READ_ONLY");
    assert.equal((await call("POST", "/v1/admin/embedding-services/test", { serviceId: "builtin" })).status, 400);
    assert.equal((await call("POST", "/v1/admin/embedding-services", { name: "Built-in (inside the backend)", baseUrl: "http://x.test" })).status, 400);
    // A collection picks the built-in model with its provider, never as a service.
    const misuse = await call("POST", "/v1/admin/collections", { displayName: "Misuse", embeddingProvider: "openai-compatible", embeddingModel: "m", embeddingServiceId: "builtin" });
    assert.equal(misuse.status, 400);
    assert.match(misuse.body.message, /embeddingProvider/);
    // Not offered in the editor's service list (that list is for openai-compatible).
    assert.equal((await call("GET", "/v1/admin/models")).body.embeddingServices.some((service: any) => service.id === "builtin"), false);
  });

  it("picks the default service when PATCH switches a collection to openai-compatible", async () => {
    await start();
    const service = (await call("POST", "/v1/admin/embedding-services", { name: "Ollama", baseUrl: "http://ollama.test/v1" })).body.service.id;
    const created = await call("POST", "/v1/admin/collections", { displayName: "Starts builtin", embeddingProvider: "builtin" });
    assert.equal(created.status, 201);

    const validation = await call("POST", `/v1/admin/collections/${created.body.collection.id}/validate`, {
      embeddingProvider: "openai-compatible",
      embeddingModel: "bge-m3",
    });
    assert.equal(validation.status, 200);
    assert.equal(validation.body.blockers.some((issue: any) => issue.code.startsWith("EMBEDDING")), false);

    const patched = await call("PATCH", `/v1/admin/collections/${created.body.collection.id}`, {
      embeddingProvider: "openai-compatible",
      embeddingModel: "bge-m3",
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.collection.embeddingServiceId, service);
  });

  it("refuses an openai-compatible collection while no embedding service exists, and says how to add one", async () => {
    await start();
    const refused = await call("POST", "/v1/admin/collections", { displayName: "No service", embeddingProvider: "openai-compatible", embeddingModel: "bge-m3" });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.code, "EMBEDDING_PROVIDER_NOT_CONFIGURED");
    assert.match(refused.body.details.recommendedActions.join(" "), /embedding-services/);
  });

  it("retrieves through the collection's active service and names it in the response", async () => {
    const seen: any[] = [];
    const registry = await start({
      ragHandlers: {
        resolveReadableCollection: async (req: any) =>
          registry.getVisibleCollection({ tenantId: "default", userId: "u", requestId: "r" }, req.params.collectionId),
        retrieveSources: async (_question: string, options: any) => {
          seen.push(options.embeddingTarget);
          return { sources: [], context: "" };
        },
      },
    });
    const context = { tenantId: "default", userId: "u", requestId: "r" };
    const service = (await call("POST", "/v1/admin/embedding-services", { name: "Cloud", baseUrl: "https://cloud.test/v1", apiKey: SECRET })).body.service.id;
    const collection = await registry.createCollection(context, openaiInput({ embeddingServiceId: service }));
    await completeJob(registry, context, collection.id);

    const retrieved = await call("POST", `/v1/rag/collections/${collection.id}/retrieve`, { question: "hello" });
    assert.equal(retrieved.status, 200);
    assert.equal(retrieved.body.embeddingServiceId, service);
    assert.equal(seen[0].connection.baseUrl, "https://cloud.test/v1");
    assert.equal(JSON.stringify(retrieved.body).includes(SECRET), false);
  });

  it("lets only admins manage services when admin auth is on", async () => {
    const passwordHash = hashPassword("secret");
    const authConfig = {
      enabled: true,
      cookieName: "rag_admin_session",
      sessionTtlMs: 60_000,
      actionTokenTtlMs: 30_000,
      sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
      users: [
        { username: "operator", passwordHash, role: "operator" as const, tenantId: "default" },
        { username: "admin", passwordHash, role: "admin" as const, tenantId: "default" },
      ],
    };
    const adminAuth = createAdminAuthService({ config: authConfig, env: { RAG_ADMIN_SESSION_SECRET: "s" } });
    await start({ adminAuth, authConfig });
    const login = async (username: string) => {
      const response = await fetch(`${baseUrl}/v1/admin/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "secret" }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const token = (cookie: string, method: string, path: string) => call("POST", "/v1/admin/auth/action-token", { method, path }, { cookie });

    const operator = await login("operator");
    assert.equal((await call("GET", "/v1/admin/embedding-services", undefined, { cookie: operator })).status, 200);
    assert.equal((await token(operator, "POST", "/v1/admin/embedding-services")).status, 403);
    assert.equal((await call("POST", "/v1/admin/embedding-services/test", { baseUrl: "http://x.test/v1" }, { cookie: operator })).status, 403);

    const admin = await login("admin");
    const list = await call("GET", "/v1/admin/embedding-services", undefined, { cookie: admin });
    assert.deepEqual(list.body.warnings, [], "no warning once admin auth is on");
    assert.equal((await call("POST", "/v1/admin/embedding-services", { name: "A", baseUrl: "http://a.test/v1" }, { cookie: admin })).status, 403, "action token required");
    const createToken = (await token(admin, "POST", "/v1/admin/embedding-services")).body.actionToken;
    const created = await call("POST", "/v1/admin/embedding-services", { name: "A", baseUrl: "http://a.test/v1" }, { cookie: admin, "x-admin-action-token": createToken });
    assert.equal(created.status, 201);
    assert.equal((await call("POST", "/v1/admin/embedding-services/test", { serviceId: created.body.service.id }, { cookie: admin })).status, 200);
  });
});
