import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import { createPhysicalCollectionName } from "../src/collections/ids.js";
import { cleanupRetiredPhysicalCollections } from "../src/indexing/cleanup.js";
import { config, type ResolvedConfig } from "../src/config.js";
import type {
  CollectionRegistry,
  CreateCollectionInput,
  PhysicalCollectionStatus,
  RequestContext,
} from "../src/collections/types.js";
import { startServer, runStartupMaintenance } from "../src/server.js";
import type { IndexJobRunner } from "../src/indexing/jobRunner.js";
import type { OperationalLogEvent } from "../src/observability/logger.js";

let tempDir: string;
let dbPath: string;
let registry: CollectionRegistry;
let rawDb: Database.Database;

const context: RequestContext = {
  requestId: "cleanup-test",
  tenantId: "default",
  userId: "local-dev",
};

const collectionInput: CreateCollectionInput = {
  displayName: "Cleanup Test Collection",
  description: "Cleanup test collection",
  sourcePath: "data",
  embeddingModel: "bge-m3",
  distanceMetric: "l2",
  chunkSize: 500,
  chunkOverlap: 200,
  retrievalK: 5,
  retrievalDistanceThreshold: 1,
};

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "radar-rag-cleanup-"));
  dbPath = path.join(tempDir, "registry.sqlite");
  registry = createSqliteCollectionRegistry({ dbPath });
  rawDb = new Database(dbPath);
  rawDb.pragma("foreign_keys = ON");
});

afterEach(async () => {
  rawDb.close();
  registry.close?.();
  await rm(tempDir, { recursive: true, force: true });
});

function createRuntimeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...config,
    registryPath: dbPath,
    ...overrides,
  };
}

function createLogger() {
  const messages: string[] = [];
  const errors: string[] = [];

  return {
    messages,
    errors,
    logger: {
      log: (...args: unknown[]) => {
        messages.push(args.map((arg) => String(arg)).join(" "));
      },
      error: (...args: unknown[]) => {
        errors.push(args.map((arg) => String(arg)).join(" "));
      },
    },
  };
}

async function seedPhysicalRecord(options: {
  version: string;
  status: PhysicalCollectionStatus;
  deleteAfter?: string | null;
  cleanupError?: string | null;
}) {
  const collection = await registry.createCollection(context, {
    ...collectionInput,
    displayName: `Cleanup ${options.version}`,
  });
  const name = createPhysicalCollectionName({
    tenantId: context.tenantId,
    collectionId: collection.id,
    version: options.version,
  });

  await registry.createPhysicalCollectionRecord({
    name,
    tenantId: context.tenantId,
    collectionId: collection.id,
    version: options.version,
    chromaConfiguration: { hnsw: { space: "l2" } },
  });

  rawDb.prepare(`
    UPDATE physical_collections
    SET status = @status, delete_after = @deleteAfter, cleanup_error = @cleanupError
    WHERE name = @name
  `).run({
    name,
    status: options.status,
    deleteAfter: options.deleteAfter ?? null,
    cleanupError: options.cleanupError ?? null,
  });

  return name;
}

describe("retention cleanup", () => {
  it("does not call delete when there are no due collections", async () => {
    const deletedNames: string[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      deletePhysicalCollection: async ({ name }) => {
        deletedNames.push(name);
      },
    });

    assert.equal(count, 0);
    assert.deepEqual(deletedNames, []);
  });

  it("skips records whose delete_after is in the future", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t120000_000z",
      status: "delete_pending",
      deleteAfter: "2099-01-01T00:00:00.000Z",
    });
    const deletedNames: string[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async ({ name: recordName }) => {
        deletedNames.push(recordName);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 0);
    assert.deepEqual(deletedNames, []);
    assert.equal(record?.status, "delete_pending");
  });

  it("deletes due physical collections and marks them deleted", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t110000_000z",
      status: "delete_pending",
      deleteAfter: "2026-06-04T11:00:00.000Z",
      cleanupError: "old cleanup error",
    });
    const deletedNames: string[] = [];
    const logEvents: OperationalLogEvent[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async ({ name: recordName }) => {
        deletedNames.push(recordName);
      },
      logEvent: (event) => {
        logEvents.push(event);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 1);
    assert.deepEqual(deletedNames, [name]);
    assert.equal(record?.status, "deleted");
    assert.ok(record?.deletedAt);
    assert.equal(record?.cleanupError, undefined);
    const event = logEvents.find((item) => item.operation === "cleanup" && item.status === "succeeded");
    assert.ok(event);
    assert.equal(event.collectionId, record?.collectionId);
    assert.equal(event.physicalCollection, name);
    assert.equal(event.details?.idempotentStorageMissing, false);
    assert.equal(typeof event.latencyMs, "number");
  });

  it("marks cleanup failures as cleanup_failed and stores the error", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t111000_000z",
      status: "delete_pending",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });

    const logEvents: OperationalLogEvent[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async () => {
        throw new Error("delete boom");
      },
      logEvent: (event) => {
        logEvents.push(event);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 0);
    assert.equal(record?.status, "cleanup_failed");
    assert.equal(record?.cleanupError, "delete boom");
    const event = logEvents.find((item) => item.operation === "cleanup" && item.status === "failed");
    assert.ok(event);
    assert.equal(event.errorCode, "PHYSICAL_CLEANUP_FAILED");
    assert.equal(event.physicalCollection, name);
    assert.equal(event.message, "delete boom");
  });

  it("retries due cleanup_failed records", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t112000_000z",
      status: "cleanup_failed",
      deleteAfter: "2026-06-04T11:00:00.000Z",
      cleanupError: "first failure",
    });
    const deletedNames: string[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async ({ name: recordName }) => {
        deletedNames.push(recordName);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 1);
    assert.deepEqual(deletedNames, [name]);
    assert.equal(record?.status, "deleted");
    assert.equal(record?.cleanupError, undefined);
  });

  it("treats storage-level not found deletes as idempotent success", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t113000_000z",
      status: "delete_pending",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async () => {
        throw new Error("collection not found");
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 1);
    assert.equal(record?.status, "deleted");
    assert.ok(record?.deletedAt);
  });

  it("does not attempt to clean up failed_build records", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t114000_000z",
      status: "failed_build",
      deleteAfter: "2026-06-04T11:00:00.000Z",
      cleanupError: "build failed",
    });
    const deletedNames: string[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async ({ name: recordName }) => {
        deletedNames.push(recordName);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 0);
    assert.deepEqual(deletedNames, []);
    assert.equal(record?.status, "failed_build");
  });

  it("does not attempt to clean up active physical records even if delete_after is due", async () => {
    const name = await seedPhysicalRecord({
      version: "20260604t115000_000z",
      status: "active",
      deleteAfter: "2026-06-04T11:00:00.000Z",
    });
    const deletedNames: string[] = [];

    const count = await cleanupRetiredPhysicalCollections({
      registry,
      runtimeConfig: createRuntimeConfig(),
      now: new Date("2026-06-04T12:00:00.000Z"),
      deletePhysicalCollection: async ({ name: recordName }) => {
        deletedNames.push(recordName);
      },
    });

    const record = await registry.getPhysicalCollection(name);
    assert.equal(count, 0);
    assert.deepEqual(deletedNames, []);
    assert.equal(record?.status, "active");
  });
});

describe("startup maintenance", () => {
  it("logs cleanup failures without rejecting startup maintenance", async () => {
    const { errors, logger } = createLogger();

    await runStartupMaintenance({
      registry,
      runtimeConfig: createRuntimeConfig(),
      log: logger,
      cleanupRetiredPhysicalCollectionsFn: async () => {
        throw new Error("cleanup startup boom");
      },
    });

    assert.ok(errors.some((message) => message.includes("Failed to run startup cleanup:")));
  });

  it("logs startup maintenance failure without blocking server startup", async () => {
    const serverRegistry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const jobRunner: IndexJobRunner = {
      start: () => {},
      drain: async () => {},
      shutdown: async () => {},
      abort: async () => {},
    };
    const { errors, logger } = createLogger();
    const runtimeConfig = createRuntimeConfig({ port: 0 });

    let server: Server | undefined;
    try {
      const started = await startServer({
        registry: serverRegistry,
        jobRunner,
        runtimeConfig,
        log: logger,
        startupMaintenance: async () => {
          throw new Error("startup maintenance boom");
        },
        startupSampleCollection: async () => undefined,
      });
      server = started.server;

      await started.startupMaintenancePromise;

      const address = server.address();
      assert.ok(address && typeof address !== "string");
      assert.ok(((address as AddressInfo).port) > 0);
      assert.ok(errors.some((message) => message.includes("Startup maintenance crashed unexpectedly:")));
    } finally {
      await jobRunner.shutdown();
      serverRegistry.close?.();
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
  });
});
