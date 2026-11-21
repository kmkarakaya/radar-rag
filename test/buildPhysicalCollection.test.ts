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
        sourceKind: "folder" as const,
        sourcePath: "data",
        documentsChanged: false,
        embeddingProvider: "builtin" as const,
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

  it("counts indexed files apart from loaded document parts (a PDF gives one per page)", async () => {
    const events: Array<{ code: string; details?: Record<string, unknown> }> = [];
    const page = (sourcePath: string, n: number) => new Document({
      pageContent: `page ${n}`,
      metadata: { documentId: `${sourcePath}#${n}`, sourcePath, sourceType: "pdf" },
    });

    const result = await buildPhysicalCollection({
      collection: {
        id: "collection-files",
        tenantId: "default",
        displayName: "Files",
        status: "indexing",
        sourceKind: "uploads" as const,
        sourcePath: "data",
        documentsChanged: false,
        embeddingProvider: "builtin" as const,
        embeddingModel: "m",
        distanceMetric: "l2",
        chromaCollectionConfiguration: {},
        chunkSize: 100,
        chunkOverlap: 0,
        retrievalK: 5,
        retrievalDistanceThreshold: 0.5,
        createdBy: "system",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      targetPhysicalCollection: "rag_default_collection-files_v1",
      targetVersion: "v1",
      runtimeConfig: config,
      log: () => {},
      onEvent: (event) => {
        events.push({ code: event.code, details: event.details });
      },
      deps: {
        // cv.pdf has two pages, bio.docx one part; notes.xyz is not supported and not counted.
        analyzeIndexingSource: async () => ({
          sourcePath: "data",
          sourceFiles: [
            { path: "data/cv.pdf", extension: ".pdf", sourceType: "pdf", loadedDocumentCount: 2 },
            { path: "data/bio.docx", extension: ".docx", sourceType: "docx", loadedDocumentCount: 1 },
          ],
          fileCount: 3,
          loadedDocumentCount: 3,
          unsupportedFiles: [{ path: "data/notes.xyz", extension: ".xyz", reason: "Unsupported file extension." }],
          documents: [page("data/cv.pdf", 1), page("data/cv.pdf", 2), page("data/bio.docx", 1)],
        }),
        splitDocuments: async (documents) => documents,
        createPhysicalChromaCollection: async () => {},
        createVectorStore: () => ({ addDocuments: async () => {} }) as any,
        assertChromaCollectionReadable: async () => ({ count: 3 }),
        deletePhysicalChromaCollection: async () => {},
      },
    });

    assert.equal(result.indexedFileCount, 2);
    assert.equal(result.parsedSourceDocumentCount, 3);
    assert.equal(result.chunkCount, 3);
    for (const code of ["SOURCE_ANALYSIS_COMPLETED", "CHUNKING_STARTED", "CHUNKING_COMPLETED"]) {
      assert.equal(events.find((event) => event.code === code)?.details?.indexedFileCount, 2, code);
    }
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
        sourceKind: "folder" as const,
        sourcePath: "data",
        documentsChanged: false,
        embeddingProvider: "builtin" as const,
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
          sourceKind: "folder" as const,
          sourcePath: "data",
          documentsChanged: false,
          embeddingProvider: "builtin" as const,
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
      sourceKind: "folder" as const,
      sourcePath: "empty/path",
      documentsChanged: false,
      embeddingProvider: "builtin" as const,
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
      sourceKind: "folder" as const,
      sourcePath: "path",
      documentsChanged: false,
      embeddingProvider: "builtin" as const,
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
  describe("step 5 writes chunks in slices", () => {
    function sliceInput(options: {
      chunkCount: number;
      calls: Array<{ ids: string[] }>;
      events: Array<{ code: string; progress?: { itemsCompleted?: number; itemsTotal?: number } }>;
      signal?: AbortSignal;
      onWrite?: (callIndex: number) => void;
    }) {
      const documents = Array.from({ length: options.chunkCount }, (_, n) => new Document({
        pageContent: `chunk ${n}`,
        metadata: { documentId: `doc-${n}`, sourcePath: `data/file-${n % 3}.txt`, sourceType: "txt" },
      }));
      return {
        collection: {
          id: "collection-slices",
          tenantId: "default",
          displayName: "Slices",
          status: "indexing" as const,
          sourceKind: "uploads" as const,
          sourcePath: "data",
          documentsChanged: false,
          embeddingProvider: "builtin" as const,
          embeddingModel: "m",
          distanceMetric: "l2" as const,
          chromaCollectionConfiguration: {},
          chunkSize: 100,
          chunkOverlap: 0,
          retrievalK: 5,
          retrievalDistanceThreshold: 0.5,
          createdBy: "system",
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
        targetPhysicalCollection: "rag_default_collection-slices_v1",
        targetVersion: "v1",
        runtimeConfig: config,
        signal: options.signal,
        log: () => {},
        onEvent: (event: { code: string; progress?: { itemsCompleted?: number; itemsTotal?: number } }) => {
          options.events.push({ code: event.code, progress: event.progress });
        },
        deps: {
          analyzeIndexingSource: async () => ({
            sourcePath: "data",
            sourceFiles: [0, 1, 2].map((n) => ({ path: `data/file-${n}.txt`, extension: ".txt", sourceType: "txt", loadedDocumentCount: 1 })),
            fileCount: 3,
            loadedDocumentCount: documents.length,
            unsupportedFiles: [],
            documents,
          }),
          splitDocuments: async (docs: Document[]) => docs,
          createPhysicalChromaCollection: async () => {},
          createVectorStore: () => ({
            addDocuments: async (chunks: Document[], addOptions: { ids: string[] }) => {
              assert.equal(chunks.length, addOptions.ids.length);
              options.calls.push({ ids: addOptions.ids });
              options.onWrite?.(options.calls.length);
            },
          }) as any,
          assertChromaCollectionReadable: async () => ({ count: documents.length }),
          deletePhysicalChromaCollection: async () => {},
        },
      };
    }

    it("writes the same chunks, ids and order as one call, and reports progress between slices", async () => {
      const calls: Array<{ ids: string[] }> = [];
      const events: Array<{ code: string; progress?: { itemsCompleted?: number; itemsTotal?: number } }> = [];
      const result = await buildPhysicalCollection(sliceInput({ chunkCount: 150, calls, events }) as any);

      assert.equal(result.chunkCount, 150);
      assert.deepEqual(calls.map((call) => call.ids.length), [64, 64, 22]);
      const ids = calls.flatMap((call) => call.ids);
      assert.deepEqual(ids, Array.from({ length: 150 }, (_, n) => `doc-${n}:${n}`));

      const written = events.filter((event) => event.code === "CHUNKS_WRITTEN");
      assert.deepEqual(written.map((event) => event.progress?.itemsCompleted), [64, 128]);
      assert.ok(written.every((event) => event.progress?.itemsTotal === 150));
      // Between the step's start and end events.
      const codes = events.map((event) => event.code);
      assert.ok(codes.indexOf("VECTOR_INDEXING_STARTED") < codes.indexOf("CHUNKS_WRITTEN"));
      assert.ok(codes.lastIndexOf("CHUNKS_WRITTEN") < codes.indexOf("VECTOR_INDEXING_COMPLETED"));
    });

    it("reports about every 5% when there are many slices", async () => {
      const calls: Array<{ ids: string[] }> = [];
      const events: Array<{ code: string; progress?: { itemsCompleted?: number; itemsTotal?: number } }> = [];
      await buildPhysicalCollection(sliceInput({ chunkCount: 6400, calls, events }) as any);
      assert.equal(calls.length, 100);
      const written = events.filter((event) => event.code === "CHUNKS_WRITTEN");
      // 100 slices, but one event per 5% (320 chunks): 19 before the step completes.
      assert.equal(written.length, 19);
    });

    it("stops between slices when the job is cancelled", async () => {
      const calls: Array<{ ids: string[] }> = [];
      const events: Array<{ code: string; progress?: { itemsCompleted?: number; itemsTotal?: number } }> = [];
      const controller = new AbortController();
      await assert.rejects(
        buildPhysicalCollection(sliceInput({
          chunkCount: 200,
          calls,
          events,
          signal: controller.signal,
          onWrite: (callIndex) => { if (callIndex === 1) controller.abort(); },
        }) as any),
        /Build aborted/,
      );
      assert.equal(calls.length, 1);
      assert.equal(events.some((event) => event.code === "VECTOR_INDEXING_COMPLETED"), false);
    });
  });
});
