import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { analyzeIndexingSource, sourceScanExcludes } from "../ingestion/pipeline.js";
import { createPhysicalChromaCollection, assertChromaCollectionReadable, deletePhysicalChromaCollection } from "../collections/chromaCollections.js";
import { createVectorStore } from "../rag.js";
import type { CreateIndexJobEventInput, RagCollection } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import type { EmbeddingTarget } from "../embeddings/index.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
import type { Document } from "@langchain/core/documents";

const JOB_PHASE_COUNT = 6;

export function addMetadataToChunks(
  chunks: Document[],
  collection: RagCollection,
  targetPhysicalCollection: string,
  targetVersion: string,
): Document[] {
  return chunks.map((chunk, chunkIndex) => {
    chunk.metadata = {
      ...chunk.metadata,
      chunkIndex,
      collectionId: collection.id,
      collectionVersion: targetVersion,
      physicalCollection: targetPhysicalCollection,
    };
    return chunk;
  });
}

export async function buildPhysicalCollection(input: {
  collection: RagCollection;
  /** The resolved embedding of the job (with its service connection); defaults to the collection's provider/model. */
  embeddingTarget?: EmbeddingTarget;
  targetPhysicalCollection: string;
  targetVersion: string;
  runtimeConfig: ResolvedConfig;
  signal?: AbortSignal;
  jobId?: string;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
  onEvent?: (event: CreateIndexJobEventInput) => Promise<void> | void;
  deps?: {
    analyzeIndexingSource?: typeof analyzeIndexingSource;
    createPhysicalChromaCollection?: typeof createPhysicalChromaCollection;
    assertChromaCollectionReadable?: typeof assertChromaCollectionReadable;
    deletePhysicalChromaCollection?: typeof deletePhysicalChromaCollection;
    createVectorStore?: typeof createVectorStore;
    splitDocuments?: (documents: Document[], options: { chunkSize: number; chunkOverlap: number }) => Promise<Document[]>;
  };
}): Promise<{
  sourceDocumentCount: number;
  parsedSourceDocumentCount: number;
  chunkCount: number;
}> {
  const { collection, targetPhysicalCollection, targetVersion, runtimeConfig, signal } = input;
  const log = input.log ?? console.log;
  const deps = input.deps ?? {};
  const startedAt = Date.now();
  const loadSource = deps.analyzeIndexingSource ?? analyzeIndexingSource;
  const createCollection = deps.createPhysicalChromaCollection ?? createPhysicalChromaCollection;
  const assertReadable = deps.assertChromaCollectionReadable ?? assertChromaCollectionReadable;
  const deleteCollection = deps.deletePhysicalChromaCollection ?? deletePhysicalChromaCollection;
  const vectorStoreFactory = deps.createVectorStore ?? createVectorStore;
  const splitDocuments = deps.splitDocuments ?? ((documents: Document[], options: { chunkSize: number; chunkOverlap: number }) => {
    const splitter = new RecursiveCharacterTextSplitter(options);
    return splitter.splitDocuments(documents);
  });
  const onEvent = input.onEvent;

  emitOperationalLog(input.logEvent, {
    tenantId: collection.tenantId,
    collectionId: collection.id,
    physicalCollection: targetPhysicalCollection,
    jobId: input.jobId,
    operation: "index_build",
    status: "started",
    details: {
      targetVersion,
    },
  });

  try {
    if (signal?.aborted) throw new Error("Build aborted");
    log(`Creating physical collection "${targetPhysicalCollection}" (version: ${targetVersion})`);
    await onEvent?.({
      status: "running",
      stage: "preparing_target",
      code: "PHYSICAL_COLLECTION_CREATING",
      message: "Creating target physical collection in Chroma.",
      details: {
        targetPhysicalCollection,
        targetVersion,
      },
      progress: {
        phase: 2,
        phaseCount: JOB_PHASE_COUNT,
      },
    });
    const chromaConfiguration = collection.chromaCollectionConfiguration ?? {
      hnsw: {
        space: collection.distanceMetric,
      },
    };

    await createCollection({
      name: targetPhysicalCollection,
      distanceMetric: collection.distanceMetric,
      chromaConfiguration,
      runtimeConfig,
    });

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Analyzing indexing source from ${collection.sourcePath}`);
    await onEvent?.({
      status: "running",
      stage: "loading_source",
      code: "SOURCE_ANALYSIS_STARTED",
      message: "Analyzing indexing source.",
      details: {
        sourcePath: collection.sourcePath,
      },
      progress: {
        phase: 3,
        phaseCount: JOB_PHASE_COUNT,
      },
    });
    const analysis = await loadSource({
      sourcePath: collection.sourcePath,
      logEvent: input.logEvent,
      ...sourceScanExcludes(runtimeConfig),
    });
    await onEvent?.({
      status: "running",
      stage: "loading_source",
      code: "SOURCE_ANALYSIS_COMPLETED",
      message: "Indexing source analysis completed.",
      details: {
        fileCount: analysis.fileCount,
        parsedSourceDocumentCount: analysis.loadedDocumentCount,
        unsupportedFileCount: analysis.unsupportedFiles.length,
      },
      progress: {
        phase: 3,
        phaseCount: JOB_PHASE_COUNT,
        itemsCompleted: analysis.loadedDocumentCount,
        unit: "documents",
      },
    });

    const documents = analysis.documents;

    if (documents.length === 0) {
      throw new Error(`No indexable documents found in ${collection.sourcePath}. To prevent empty collections, build is aborted.`);
    }

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Loaded ${documents.length} indexable documents from ${analysis.loadedDocumentCount} parsed source documents`);
    await onEvent?.({
      status: "running",
      stage: "chunking",
      code: "CHUNKING_STARTED",
      message: "Splitting parsed documents into chunks.",
      details: {
        documentCount: documents.length,
      },
      progress: {
        phase: 4,
        phaseCount: JOB_PHASE_COUNT,
        itemsCompleted: documents.length,
        itemsTotal: documents.length,
        unit: "documents",
      },
    });

    const chunks = await splitDocuments(documents, {
      chunkSize: collection.chunkSize,
      chunkOverlap: collection.chunkOverlap,
    });
    const indexedChunks = addMetadataToChunks(
      chunks,
      collection,
      targetPhysicalCollection,
      targetVersion,
    );

    if (indexedChunks.length === 0) {
      throw new Error(`No indexable chunks produced from ${documents.length} documents. To prevent empty collections, build is aborted.`);
    }

    await onEvent?.({
      status: "running",
      stage: "chunking",
      code: "CHUNKING_COMPLETED",
      message: "Chunking completed.",
      details: {
        documentCount: documents.length,
        chunkCount: indexedChunks.length,
        chunkSize: collection.chunkSize,
        chunkOverlap: collection.chunkOverlap,
      },
      progress: {
        phase: 4,
        phaseCount: JOB_PHASE_COUNT,
        itemsCompleted: indexedChunks.length,
        itemsTotal: indexedChunks.length,
        unit: "chunks",
      },
    });

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Split documents into ${indexedChunks.length} chunks. Indexing into Chroma...`);
    await onEvent?.({
      status: "running",
      stage: "indexing",
      code: "VECTOR_INDEXING_STARTED",
      message: "Writing chunks into Chroma.",
      details: {
        chunkCount: indexedChunks.length,
        targetPhysicalCollection,
      },
      progress: {
        phase: 5,
        phaseCount: JOB_PHASE_COUNT,
        itemsCompleted: 0,
        itemsTotal: indexedChunks.length,
        unit: "chunks",
      },
    });

    const vectorStore = vectorStoreFactory({
      collectionName: targetPhysicalCollection,
      runtimeConfig,
      embeddingProvider: collection.embeddingProvider,
      embeddingModel: collection.embeddingModel,
      embeddingTarget: input.embeddingTarget,
    });

    await vectorStore.addDocuments(indexedChunks, {
      ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
    });
    await onEvent?.({
      status: "running",
      stage: "indexing",
      code: "VECTOR_INDEXING_COMPLETED",
      message: "Chunk indexing completed.",
      details: {
        chunkCount: indexedChunks.length,
      },
      progress: {
        phase: 5,
        phaseCount: JOB_PHASE_COUNT,
        itemsCompleted: indexedChunks.length,
        itemsTotal: indexedChunks.length,
        unit: "chunks",
      },
    });

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Verifying readability of physical collection "${targetPhysicalCollection}"`);
    await onEvent?.({
      status: "running",
      stage: "verifying",
      code: "READABILITY_CHECK_STARTED",
      message: "Verifying target physical collection readability.",
      details: {
        targetPhysicalCollection,
      },
      progress: {
        phase: 6,
        phaseCount: JOB_PHASE_COUNT,
      },
    });
    await assertReadable({
      name: targetPhysicalCollection,
      runtimeConfig,
      abortSignal: signal,
      timeoutMs: runtimeConfig.readyTimeoutMs,
    });
    await onEvent?.({
      status: "running",
      stage: "verifying",
      code: "READABILITY_CHECK_COMPLETED",
      message: "Target physical collection verified as readable.",
      details: {
        targetPhysicalCollection,
      },
      progress: {
        phase: 6,
        phaseCount: JOB_PHASE_COUNT,
      },
    });

    const output = {
      sourceDocumentCount: documents.length,
      parsedSourceDocumentCount: analysis.loadedDocumentCount,
      chunkCount: indexedChunks.length,
    };

    emitOperationalLog(input.logEvent, {
      tenantId: collection.tenantId,
      collectionId: collection.id,
      physicalCollection: targetPhysicalCollection,
      jobId: input.jobId,
      operation: "index_build",
      status: "succeeded",
      latencyMs: Date.now() - startedAt,
      details: {
        targetVersion,
        sourceDocumentCount: output.sourceDocumentCount,
        parsedSourceDocumentCount: output.parsedSourceDocumentCount,
        chunkCount: output.chunkCount,
      },
    });

    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Build failed: ${message}. Attempting to clean up target physical collection...`);
    try {
      await deleteCollection({
        name: targetPhysicalCollection,
        runtimeConfig,
      });
    } catch (deleteError) {
      const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
      log(`Best-effort target physical cleanup failed: ${deleteMessage}`);
    }
    emitOperationalLog(input.logEvent, {
      tenantId: collection.tenantId,
      collectionId: collection.id,
      physicalCollection: targetPhysicalCollection,
      jobId: input.jobId,
      operation: "index_build",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: "INDEX_BUILD_FAILED",
      message,
      details: {
        targetVersion,
      },
    });
    throw error;
  }
}
