import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp, type AppDependencies } from "../src/app.js";
import type { CollectionRegistry } from "../src/collections/types.js";

type HealthChecks = NonNullable<AppDependencies["healthChecks"]>;

function createHealthyRegistryStub(): CollectionRegistry {
  return {
    listVisibleCollections: async () => [],
    getVisibleCollection: async () => null,
    getJob: async () => null,
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
  };
}

async function startServer(
  registry: CollectionRegistry,
  healthChecks: HealthChecks = createHealthyHealthChecks(),
): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp({ registry, healthChecks });
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
        availableModels: ["test-chat", "test-embed"],
        missingModels: [],
        chatModelAvailable: true,
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
    checkChatGenerationHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        probeText: "foundation probe",
        responseLength: 12,
      },
    }),
    checkIndexingSourceHealth: async () => ({
      ok: true,
      latencyMs: 1,
      details: {
        sourcePath: "data",
        fileCount: 1,
        loadedDocumentCount: 1,
        recordCount: 1,
        sampledRecordCount: 1,
        documentCount: 1,
        unsupportedFiles: [],
        indexSampleSize: 0,
        sampleLimited: false,
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: largeString }),
    });

    assert.equal(response.status, 413); // Payload Too Large

    // express built-in json parser might return html error for PayloadTooLarge depending on config
    // but at least verify status code
    try {
      const body = await response.json() as { error?: string };
      assert.match(body.error || "", /request entity too large|payload too large/i);
    } catch {
      const text = await response.text();
      assert.match(text, /Payload Too Large|request entity too large/i);
    }
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
    assert.deepEqual(body.dependencies, {
      registry: { ok: true },
      chroma: { ok: Boolean((body.dependencies as any)?.chroma?.ok) },
      ollama: { ok: Boolean((body.dependencies as any)?.ollama?.ok) },
    });
    assert.deepEqual(body.diagnostics, {
      full: "GET /ready?details=true",
      strictHttpStatus: "GET /ready?strict=true",
      fullStrict: "GET /ready?details=true&strict=true",
    });
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
});

