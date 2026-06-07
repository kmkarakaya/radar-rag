import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { analyzeIndexingSource } from "../ingestion/pipeline.js";
import { createPhysicalChromaCollection, assertChromaCollectionReadable, deletePhysicalChromaCollection } from "../collections/chromaCollections.js";
import { createVectorStore } from "../rag.js";
import type { RagCollection } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
import type { Document } from "@langchain/core/documents";

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
  targetPhysicalCollection: string;
  targetVersion: string;
  runtimeConfig: ResolvedConfig;
  signal?: AbortSignal;
  jobId?: string;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
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
    const analysis = await loadSource({
      sourcePath: collection.sourcePath,
      ozelgeDataPath: collection.ozelgeDataPath,
      indexSampleSize: runtimeConfig.indexSampleSize,
    });

    const documents = analysis.documents;

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Loaded ${documents.length} indexable documents from ${analysis.loadedDocumentCount} parsed source documents`);

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

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Split documents into ${indexedChunks.length} chunks. Indexing into Chroma...`);

    const vectorStore = vectorStoreFactory({
      collectionName: targetPhysicalCollection,
      runtimeConfig,
      embeddingModel: collection.embeddingModel,
    });

    await vectorStore.addDocuments(indexedChunks, {
      ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
    });

    if (signal?.aborted) throw new Error("Build aborted");
    log(`Verifying readability of physical collection "${targetPhysicalCollection}"`);
    await assertReadable({
      name: targetPhysicalCollection,
      runtimeConfig,
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
