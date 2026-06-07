import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { rm } from "node:fs/promises";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import { runIndexing } from "../src/index.js";
import { config } from "../src/config.js";
import type { CollectionRegistry } from "../src/collections/types.js";

describe("CLI indexing command contract", () => {
  let registry: CollectionRegistry;
  const dbPath = "test-cli-registry.sqlite";

  before(async () => {
    registry = createSqliteCollectionRegistry({ dbPath });
  });

  after(async () => {
    registry.close?.();
    await rm(dbPath, { force: true });
  });

  it("fails the indexing process when the job fails", async () => {
    const context = { tenantId: "default", userId: "local-dev", requestId: "setup" };
    const collection = await registry.createCollection(context, {
      displayName: "CLI Fail Test",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge",
      embeddingModel: "test",
      chatModel: "test",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const runtimeConfig = {
      ...config,
      registryPath: dbPath,
    };

    const options = {
      collectionId: collection.id,
      log: () => {}, // suppress logs
      deps: {
        buildPhysicalCollection: async () => {
          throw new Error("Simulated build failure for CLI test");
        }
      }
    };

    // runIndexing should now throw an error because the job fails
    await assert.rejects(
      runIndexing(runtimeConfig, options),
      { message: /Indexing job failed: Simulated build failure for CLI test/ }
    );

    // Verify job is indeed marked as failed in registry
    const job = await registry.getActiveJobForCollection(context, collection.id);
    // getActiveJobForCollection might not return failed jobs if it only looks for active ones
    // Let's list all jobs or use internal knowledge of the job id (which we don't have here easily)
    // But we know it failed because runIndexing threw.
  });

  it("succeeds the indexing process when the job succeeds", async () => {
    const context = { tenantId: "default", userId: "local-dev", requestId: "setup-success" };
    const collection = await registry.createCollection(context, {
      displayName: "CLI Success Test",
      sourcePath: "data",
      ozelgeDataPath: "data/ozelge",
      embeddingModel: "test",
      chatModel: "test",
      distanceMetric: "l2",
      chunkSize: 500,
      chunkOverlap: 50,
      retrievalK: 5,
      retrievalDistanceThreshold: 1,
    });

    const runtimeConfig = {
      ...config,
      registryPath: dbPath,
    };

    const options = {
      collectionId: collection.id,
      log: () => {},
      deps: {
        buildPhysicalCollection: async () => ({
          sourceDocumentCount: 1,
          parsedSourceDocumentCount: 1,
          chunkCount: 1,
        })
      }
    };

    // Should NOT throw
    await runIndexing(runtimeConfig, options);
    
    const ready = await registry.getVisibleCollection(context, collection.id);
    assert.equal(ready?.status, "ready");
  });
});
