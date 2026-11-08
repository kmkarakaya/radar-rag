import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp, type AppDependencies } from "../src/app.js";
import type { CollectionRegistry, RequestContext } from "../src/collections/types.js";
import type { ChatProviderStatus } from "../src/chat.js";
import { config, type ResolvedConfig } from "../src/config.js";

type HealthChecks = NonNullable<AppDependencies["healthChecks"]>;

function createHealthyRegistryStub(): CollectionRegistry {
  return {
    listVisibleCollections: async () => [],
    getVisibleCollection: async () => null,
    listPhysicalCollectionsForCollection: async () => [],
    listJobs: async () => ({ jobs: [], nextCursor: null }),
    getSystemOperationsSummary: async (nowIso) => ({
      observedAt: nowIso,
      collections: {
        total: 0,
        creating: 0,
        indexing: 0,
        ready: 0,
        failed: 0,
        archived: 0,
      },
      jobs: {
        total: 0,
        active: 0,
        queued: 0,
        running: 0,
        terminal: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        oldestActiveUpdatedAt: null,
        oldestActiveAgeSec: null,
        newestFailureAt: null,
      },
      physicalCollections: {
        total: 0,
        building: 0,
        active: 0,
        failedBuild: 0,
        deletePending: 0,
        cleanupFailed: 0,
        deleted: 0,
        cleanupBacklog: 0,
        oldestDueDeleteAt: null,
      },
    }),
    getJob: async () => null,
    listJobEvents: async () => [],
    appendJobEvent: async () => {
      throw new Error("Not implemented in foundation test");
    },
    deleteJob: async () => {},
    deleteJobs: async () => {},
    getActiveJobForCollection: async () => null,
    createCollection: async () => {
      throw new Error("Not implemented in foundation test");
    },
    updateCollection: async () => {
      throw new Error("Not implemented in foundation test");
    },
    beginIndexJob: async () => {
      throw new Error("Not implemented in foundation test");
    },
    markIndexJobRunning: async () => {
      throw new Error("Not implemented in foundation test");
    },
    completeIndexJob: async () => {
      throw new Error("Not implemented in foundation test");
    },
    failIndexJob: async () => {
      throw new Error("Not implemented in foundation test");
    },
    failStaleJobs: async () => 0,
    getPhysicalCollection: async () => null,
    createPhysicalCollectionRecord: async () => {
      throw new Error("Not implemented in foundation test");
    },
    markPhysicalCollectionDeleted: async () => {},
    markPhysicalCollectionCleanupFailed: async () => {},
    listDuePhysicalCollectionsForCleanup: async () => [],
    collectionExists: async () => false,
    cancelIndexJob: async (_jobId: string) => ({} as any),
    deleteCollection: async (_context: RequestContext, _collectionId: string) => [],
  };
}

async function startServer(
  registry: CollectionRegistry,
  healthChecks: HealthChecks = createHealthyHealthChecks(),
  runtimeConfig = config,
): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp({ registry, healthChecks, runtimeConfig });
  let startedServer!: Server;

  await new Promise<void>((resolve) => {
    startedServer = app.listen(0, () => resolve());
  });

  const address = startedServer.address();
  assert.ok(address && typeof address !== "string");

  return {
    server: startedServer,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
}

function chatProviderStatus(
  runtimeConfig: ResolvedConfig,
  ok: boolean,
  overrides: Partial<ChatProviderStatus> = {},
): ChatProviderStatus {
  const configured = runtimeConfig.chat.enabled;
  return {
    configured,
    baseUrl: runtimeConfig.chat.baseUrl || null,
    model: runtimeConfig.chat.model || null,
    reachable: configured && ok,
    authOk: configured && ok,
    modelListed: configured && ok ? true : "unknown",
    ok: configured && ok,
    latencyMs: 1,
    ...overrides,
  };
}

function withChat(runtimeConfig: ResolvedConfig): ResolvedConfig {
  return {
    ...runtimeConfig,
    chat: {
      ...runtimeConfig.chat,
      enabled: true,
      baseUrl: "http://chat.test/v1",
      model: "test-chat",
    },
  };
}

function createHealthyHealthChecks(): HealthChecks {
  return {
    checkChromaHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        reachable: true,
      },
    }),
    checkOllamaHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        reachable: true,
        availableModels: ["test-embed"],
        missingModels: [],
        embeddingModelAvailable: true,
      },
    }),
    checkEmbeddingHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        probeText: "foundation probe",
        vectorLength: 3,
        finiteValues: true,
      },
    }),
    // Mirrors the real free check: nothing to probe when no chat LLM is configured.
    checkChatProvider: async (runtimeConfig: ResolvedConfig) => chatProviderStatus(runtimeConfig, true),
    checkIndexingSourceHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        sourcePath: "data",
        fileCount: 1,
        loadedDocumentCount: 1,
        documentCount: 1,
        unsupportedFiles: [],
      },
    }),
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

let server: Server;
let baseUrl: string;

before(async () => {
  const started = await startServer(createHealthyRegistryStub());
  server = started.server;
  baseUrl = started.baseUrl;
});

after(async () => {
  await stopServer(server);
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

describe("app foundation", () => {
  it("serves liveness health", async () => {
    const response = await request("/health");
    const body = await response.json() as { status?: string; alive?: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.alive, true);
  });

  it("points root callers to the versioned multi-collection API", async () => {
    const response = await request("/");
    const body = await response.json() as {
      endpoints?: Record<string, string>;
      message?: string;
    };

    assert.equal(response.status, 200);
    assert.match(body.message ?? "", /\/v1\/rag\/collections/);
    assert.equal(body.endpoints?.collections, "/v1/rag/collections");
    assert.equal(body.endpoints?.query, "/v1/rag/collections/:collectionId/query");
    assert.equal(body.endpoints?.retrieve, "/v1/rag/collections/:collectionId/retrieve");
  });

  it("returns a structured invalid JSON response with request context", async () => {
    const response = await request("/v1/rag/collections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "foundation-test-request",
      },
      body: "{",
    });
    const body = await response.json() as {
      code?: string;
      requestId?: string;
    };

    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST_BODY");
    assert.equal(body.requestId, "foundation-test-request");
  });

  it("oversized JSON body kontrollÃ¼ hata dÃ¶ner", async () => {
    // Generate a payload slightly larger than 1MB
    const largeString = "a".repeat(1024 * 1024 + 10);
    const response = await request("/v1/rag/collections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "oversized-json-test",
      },
      body: JSON.stringify({ data: largeString }),
    });
    const body = await response.json() as {
      code?: string;
      error?: string;
      message?: string;
      requestId?: string;
    };

    assert.equal(response.status, 413); // Payload Too Large
    assert.equal(body.code, "INVALID_REQUEST_BODY");
    assert.equal(body.error, "Payload Too Large");
    assert.equal(body.message, "Request entity too large.");
    assert.equal(body.requestId, "oversized-json-test");
  });

  it("does not expose legacy RAG endpoints", async () => {
    const legacyRequests: Array<[string, string, RequestInit | undefined]> = [
      ["GET", "/rag/query", undefined],
      ["POST", "/rag/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "test" }),
      }],
      ["GET", "/rag/retrieve", undefined],
      ["POST", "/rag/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "test", k: 1 }),
      }],
    ];

    for (const [method, path, init] of legacyRequests) {
      const response = await request(path, init);

      assert.equal(
        response.status,
        404,
        `${method} ${path} should be route-not-found, not a compatibility endpoint`,
      );
      assert.notEqual(response.status, 405);
    }
  });
  it("GET /ready returns the default summary contract", async () => {
    const response = await request("/ready");
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body), false);
    assert.equal(body.status === "ok" || body.status === "degraded", true);
    assert.equal(typeof body.ready, "boolean");
    assert.equal(typeof body.systemReadyFor, "string");
    assert.equal(typeof body.queryReady, "boolean");
    assert.equal(typeof body.indexReady, "boolean");
    assert.ok(Array.isArray(body.blockerCodes));
    assert.ok(Array.isArray(body.warningCodes));
    assert.equal(typeof body.retrieveReady, "boolean");
    assert.equal(typeof body.queryEnabled, "boolean");
    assert.deepEqual(body.dependencies, {
      registry: { ok: true },
      chroma: { ok: Boolean((body.dependencies as any)?.chroma?.ok) },
      ollama: { ok: Boolean((body.dependencies as any)?.ollama?.ok) },
      chat: {
        ok: Boolean((body.dependencies as any)?.chat?.ok),
        configured: Boolean((body.dependencies as any)?.chat?.configured),
      },
    });
    assert.deepEqual(body.diagnostics, {
      full: "GET /ready?details=true",
      strictHttpStatus: "GET /ready?strict=true",
      fullStrict: "GET /ready?details=true&strict=true",
    });
    assert.equal(typeof (body.operations as any)?.observedAt, "string");
    assert.equal(typeof (body.operations as any)?.collections?.total, "number");
    assert.equal(typeof (body.operations as any)?.jobs?.active, "number");
    assert.equal(typeof (body.operations as any)?.physicalCollections?.cleanupBacklog, "number");
    assert.ok(Array.isArray(body.operationalAlerts));
    assert.equal("checks" in body, false);
  });

  it("GET /ready?details=true returns the full readiness payload", async () => {
    const response = await request("/ready?details=true");
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.checks));
    assert.ok(Array.isArray(body.blockers));
    assert.ok(Array.isArray(body.warnings));
    assert.equal((body.dependencies as any)?.registry?.ok, true);
    assert.equal(typeof (body.operations as any)?.runtime?.rateLimit?.enabled, "boolean");
    assert.equal(typeof (body.operations as any)?.runtime?.concurrency?.maxConcurrentEmbeddings, "number");
    assert.equal(typeof (body.operations as any)?.runtime?.timeouts?.readinessMs, "number");
    assert.ok(Array.isArray(body.operationalAlerts));
  });

  it("GET /ready?strict=true returns 503 and REGISTRY_UNREACHABLE when registry health fails", async () => {
    const failingRegistry = {
      ...createHealthyRegistryStub(),
      listVisibleCollections: async () => {
        throw new Error("registry offline");
      },
    } satisfies CollectionRegistry;
    const started = await startServer(failingRegistry);

    try {
      const response = await fetch(`${started.baseUrl}/ready?strict=true&details=true`);
      const body = await response.json() as { blockerCodes?: string[]; dependencies?: { registry?: { ok?: boolean } } };

      assert.equal(response.status, 503);
      assert.equal(body.dependencies?.registry?.ok, false);
      assert.ok(body.blockerCodes?.includes("REGISTRY_UNREACHABLE"));
    } finally {
      await stopServer(started.server);
    }
  });

  it("passes the active runtime config to the embedding smoke and the free chat check, never generating", async () => {
    const calls: Array<{ kind: "embed" | "chat"; value: string }> = [];
    const runtimeConfig = withChat({
      ...config,
      readyEmbedProbeText: "embed-probe-from-runtime-config",
    });
    const started = await startServer(createHealthyRegistryStub(), {
      ...createHealthyHealthChecks(),
      checkEmbeddingHealth: async (receivedConfig = config) => {
        calls.push({ kind: "embed", value: receivedConfig.readyEmbedProbeText });
        return {
          ok: true,
          latencyMs: 1,
          details: {
            probeText: receivedConfig.readyEmbedProbeText,
            vectorLength: 3,
            finiteValues: true,
          },
        };
      },
      checkChatProvider: async (receivedConfig: ResolvedConfig) => {
        calls.push({ kind: "chat", value: receivedConfig.chat.model });
        return chatProviderStatus(receivedConfig, true);
      },
    }, runtimeConfig);

    try {
      const response = await fetch(`${started.baseUrl}/ready?details=true`);
      const body = await response.json() as any;
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [
        { kind: "embed", value: "embed-probe-from-runtime-config" },
        { kind: "chat", value: "test-chat" },
      ]);
      assert.equal(body.ready, true);
      assert.equal(body.systemReadyFor, "query-and-index");
      assert.ok(body.checks.some((check: any) => check.code === "CHAT_MODEL_AVAILABLE"));
      assert.equal(body.chatModel, "test-chat");
    } finally {
      await stopServer(started.server);
    }
  });

  it("is ready without a chat LLM (retrieve-only) and reports /query as disabled", async () => {
    const runtimeConfig = { ...config, chat: { ...config.chat, enabled: false, baseUrl: "", model: "" } };
    const started = await startServer(createHealthyRegistryStub(), createHealthyHealthChecks(), runtimeConfig);

    try {
      const body = await (await fetch(`${started.baseUrl}/ready?details=true`)).json() as any;
      assert.equal(body.ready, true);
      assert.equal(body.status, "ok");
      assert.equal(body.systemReadyFor, "retrieve-and-index");
      assert.equal(body.retrieveReady, true);
      assert.equal(body.queryEnabled, false);
      assert.equal(body.queryReady, false);
      assert.equal(body.chatModel, null);
      assert.equal(body.capabilities.query.enabled, false);
      assert.equal(body.capabilities.retrieve.ready, true);
      assert.ok(!body.blockerCodes.includes("CHAT_NOT_CONFIGURED"));
      assert.ok(body.checks.some((check: any) => check.code === "CHAT_NOT_CONFIGURED" && check.status === "skip"));
    } finally {
      await stopServer(started.server);
    }
  });

  it("blocks only /query when the configured chat LLM is unreachable or unverifiable", async () => {
    const runtimeConfig = withChat(config);
    const unreachable = await startServer(createHealthyRegistryStub(), {
      ...createHealthyHealthChecks(),
      checkChatProvider: async (receivedConfig: ResolvedConfig) => chatProviderStatus(receivedConfig, false, { error: "connect ECONNREFUSED" }),
    }, runtimeConfig);

    try {
      const body = await (await fetch(`${unreachable.baseUrl}/ready?details=true`)).json() as any;
      assert.equal(body.ready, false);
      assert.equal(body.retrieveReady, true);
      assert.equal(body.queryReady, false);
      assert.equal(body.systemReadyFor, "retrieve-and-index");
      assert.ok(body.blockerCodes.includes("CHAT_PROVIDER_UNREACHABLE"));
      assert.ok(!JSON.stringify(body).includes("secret"));
    } finally {
      await stopServer(unreachable.server);
    }

    const unverified = await startServer(createHealthyRegistryStub(), {
      ...createHealthyHealthChecks(),
      checkChatProvider: async (receivedConfig: ResolvedConfig) => chatProviderStatus(receivedConfig, true, { modelListed: "unknown" }),
    }, runtimeConfig);

    try {
      const body = await (await fetch(`${unverified.baseUrl}/ready?details=true`)).json() as any;
      assert.equal(body.ready, true);
      assert.ok(body.warningCodes.includes("CHAT_MODEL_UNVERIFIED"));
    } finally {
      await stopServer(unverified.server);
    }
  });
});
