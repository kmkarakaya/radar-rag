import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Document } from "@langchain/core/documents";
import { buildPhysicalCollection } from "../src/indexing/buildPhysicalCollection.js";
import { config } from "../src/config.js";
import type { OperationalLogEvent } from "../src/observability/logger.js";

describe("buildPhysicalCollection", () => {
  it("uses the collection embedding model and distance metric when building a physical collection", async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    const vectorStoreCalls: Array<Record<string, unknown>> = [];
    const logEvents: OperationalLogEvent[] = [];

    const result = await buildPhysicalCollection({
      collection: {
        id: "collection-1",
        tenantId: "default",
        displayName: "Test",
        status: "indexing",
        sourcePath: "data",
        embeddingModel: "embed-build-specific",
        distanceMetric: "cosine",
        chromaCollectionConfiguration: {
          hnsw: {
            space: "l2",
            ef_construction: 128,
          },
        },
        chunkSize: 100,
        chunkOverlap: 0,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.5,
        createdBy: "system",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      targetPhysicalCollection: "rag_default_collection-1_20260604t120000_001z",
      targetVersion: "20260604t120000_001z",
      runtimeConfig: config,
      jobId: "job-build-1",
      log: () => {},
      logEvent: (event) => {
        logEvents.push(event);
      },
      deps: {
        analyzeIndexingSource: async () => ({
          sourcePath: "data",
          sourceFiles: [],
          fileCount: 1,
          loadedDocumentCount: 1,
          unsupportedFiles: [],
          documents: [
            new Document({
              pageContent: "content",
              metadata: { documentId: "doc-1", sourcePath: "data/file.txt", sourceType: "text" },
            }),
          ],
        }),
        splitDocuments: async (documents) => documents,
        createPhysicalChromaCollection: async (input) => {
          createCalls.push(input as unknown as Record<string, unknown>);
        },
        createVectorStore: (input) => {
          vectorStoreCalls.push(input as unknown as Record<string, unknown>);
          return {
            addDocuments: async () => {},
          } as any;
        },
        assertChromaCollectionReadable: async () => ({ count: 1 }),
        deletePhysicalChromaCollection: async () => {},
      },
    });

    assert.equal(result.chunkCount, 1);
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0]?.distanceMetric, "cosine");
    assert.deepEqual(createCalls[0]?.chromaConfiguration, {
      hnsw: {
        space: "l2",
        ef_construction: 128,
      },
    });
    assert.equal(vectorStoreCalls.length, 1);
    assert.equal(vectorStoreCalls[0]?.embeddingModel, "embed-build-specific");
    assert.ok(logEvents.some((event) => (
      event.operation === "index_build"
      && event.status === "started"
      && event.collectionId === "collection-1"
      && event.physicalCollection === "rag_default_collection-1_20260604t120000_001z"
      && event.jobId === "job-build-1"
    )));
    const succeededEvent = logEvents.find((event) => event.operation === "index_build" && event.status === "succeeded");
    assert.ok(succeededEvent);
    assert.equal(succeededEvent.collectionId, "collection-1");
    assert.equal(succeededEvent.details?.chunkCount, 1);
    assert.equal(typeof succeededEvent.latencyMs, "number");
  });

  it("propagates abort signal and timeout to assertChromaCollectionReadable", async () => {
    let assertReadableCall: any = null;
    const controller = new AbortController();

    await buildPhysicalCollection({
      collection: {
        id: "col-1",
        tenantId: "t1",
        displayName: "Test",
        status: "indexing",
        sourcePath: "data",
        embeddingModel: "m1",
        distanceMetric: "l2",
        chromaCollectionConfiguration: {},
        chunkSize: 100,
        chunkOverlap: 0,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.5,
        createdBy: "u1",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      targetPhysicalCollection: "rag_t1_col-1_v1",
      targetVersion: "v1",
      runtimeConfig: { ...config, readyTimeoutMs: 12345 },
      signal: controller.signal,
      log: () => {},
      deps: {
        analyzeIndexingSource: async () => ({
          sourcePath: "data",
          sourceFiles: [],
          fileCount: 1,
          loadedDocumentCount: 1,
          unsupportedFiles: [],
          documents: [
            new Document({
              pageContent: "content",
              metadata: { documentId: "doc-1" },
            }),
          ],
        }),
        splitDocuments: async (documents) => documents,
        createPhysicalChromaCollection: async () => {},
        createVectorStore: () => ({
          addDocuments: async () => {},
        } as any),
        assertChromaCollectionReadable: async (input) => {
          assertReadableCall = input;
          return { count: 0 };
        },
      },
    });

    assert.ok(assertReadableCall);
    assert.equal(assertReadableCall.timeoutMs, 12345);
    assert.equal(assertReadableCall.abortSignal, controller.signal);
  });

  it("does not mask the original build failure when best-effort target cleanup also fails", async () => {
    const messages: string[] = [];

    await assert.rejects(
      () => buildPhysicalCollection({
        collection: {
          id: "collection-1",
          tenantId: "default",
          displayName: "Test",
          status: "indexing",
          sourcePath: "data",
          embeddingModel: "embed-build-specific",
          distanceMetric: "l2",
          chromaCollectionConfiguration: {
            hnsw: {
              space: "l2",
            },
          },
          chunkSize: 100,
          chunkOverlap: 0,
          retrievalK: 5,
          retrievalDistanceThreshold: 0.5,
          createdBy: "system",
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
        targetPhysicalCollection: "rag_default_collection-1_20260604t120000_002z",
        targetVersion: "20260604t120000_002z",
        runtimeConfig: config,
        log: (message) => {
          messages.push(message);
        },
        deps: {
          createPhysicalChromaCollection: async () => {},
          analyzeIndexingSource: async () => {
            throw new Error("source load failed");
          },
          deletePhysicalChromaCollection: async () => {
            throw new Error("delete cleanup failed");
          },
        },
      }),
      /source load failed/,
    );

    assert.ok(messages.some((message) => message.includes("Best-effort target physical cleanup failed")));
  });

  it("fails if no documents are found and cleans up the collection", async () => {
    let deleteCalledWith: string | null = null;
    const collection = {
      id: "col-empty-docs",
      tenantId: "t1",
      displayName: "Empty Docs",
      status: "indexing" as const,
      sourcePath: "empty/path",
      embeddingModel: "m1",
      distanceMetric: "l2" as const,
      chromaCollectionConfiguration: {},
      chunkSize: 100,
      chunkOverlap: 0,
      retrievalK: 5,
      retrievalDistanceThreshold: 0.5,
      createdBy: "u1",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    };

    await assert.rejects(
      () => buildPhysicalCollection({
        collection,
        targetPhysicalCollection: "rag_t1_col-empty-docs_v1",
        targetVersion: "v1",
        runtimeConfig: config,
        deps: {
          createPhysicalChromaCollection: async () => {},
          analyzeIndexingSource: async () => ({
            documents: [],
            loadedDocumentCount: 0,
          } as any),
          deletePhysicalChromaCollection: async ({ name }) => {
            deleteCalledWith = name;
          },
        },
      }),
      /No indexable documents found/
    );

    assert.equal(deleteCalledWith, "rag_t1_col-empty-docs_v1");
  });

  it("fails if no chunks are produced and cleans up the collection", async () => {
    let deleteCalledWith: string | null = null;
    const collection = {
      id: "col-empty-chunks",
      tenantId: "t1",
      displayName: "Empty Chunks",
      status: "indexing" as const,
      sourcePath: "path",
      embeddingModel: "m1",
      distanceMetric: "l2" as const,
      chromaCollectionConfiguration: {},
      chunkSize: 100,
      chunkOverlap: 0,
      retrievalK: 5,
      retrievalDistanceThreshold: 0.5,
      createdBy: "u1",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    };

    await assert.rejects(
      () => buildPhysicalCollection({
        collection,
        targetPhysicalCollection: "rag_t1_col-empty-chunks_v1",
        targetVersion: "v1",
        runtimeConfig: config,
        deps: {
          createPhysicalChromaCollection: async () => {},
          analyzeIndexingSource: async () => ({
            documents: [new Document({ pageContent: "content", metadata: { documentId: "doc-1" } })],
            loadedDocumentCount: 1,
          } as any),
          splitDocuments: async () => [], // Simulating zero chunks
          deletePhysicalChromaCollection: async ({ name }) => {
            deleteCalledWith = name;
          },
        },
      }),
      /No indexable chunks produced/
    );

    assert.equal(deleteCalledWith, "rag_t1_col-empty-chunks_v1");
  });
});
