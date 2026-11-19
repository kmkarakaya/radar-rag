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

  function recordingFetch(requests: Array<{ url: string; auth: string | null }>) {
    return (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
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

  it("embeds and checks through the service's own URL and key", async () => {
    const requests: Array<{ url: string; auth: string | null }> = [];
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
