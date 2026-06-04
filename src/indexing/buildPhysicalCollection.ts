import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { analyzeIndexingSource } from "../ingestion/pipeline.js";
import { createPhysicalChromaCollection, assertChromaCollectionReadable, deletePhysicalChromaCollection } from "../collections/chromaCollections.js";
import { createVectorStore } from "../rag.js";
import type { RagCollection } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
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
  log?: (message: string) => void;
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
  const { collection, targetPhysicalCollection, targetVersion, runtimeConfig } = input;
  const log = input.log ?? console.log;
  const deps = input.deps ?? {};
  const loadSource = deps.analyzeIndexingSource ?? analyzeIndexingSource;
  const createCollection = deps.createPhysicalChromaCollection ?? createPhysicalChromaCollection;
  const assertReadable = deps.assertChromaCollectionReadable ?? assertChromaCollectionReadable;
  const deleteCollection = deps.deletePhysicalChromaCollection ?? deletePhysicalChromaCollection;
  const vectorStoreFactory = deps.createVectorStore ?? createVectorStore;
  const splitDocuments = deps.splitDocuments ?? ((documents: Document[], options: { chunkSize: number; chunkOverlap: number }) => {
    const splitter = new RecursiveCharacterTextSplitter(options);
    return splitter.splitDocuments(documents);
  });

  try {
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

    log(`Analyzing indexing source from ${collection.sourcePath}`);
    const analysis = await loadSource({
      sourcePath: collection.sourcePath,
      ozelgeDataPath: collection.ozelgeDataPath,
      indexSampleSize: runtimeConfig.indexSampleSize,
    });

    const documents = analysis.documents;

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

    log(`Split documents into ${indexedChunks.length} chunks. Indexing into Chroma...`);

    const vectorStore = vectorStoreFactory({
      collectionName: targetPhysicalCollection,
      runtimeConfig,
      embeddingModel: collection.embeddingModel,
    });

    await vectorStore.addDocuments(indexedChunks, {
      ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
    });

    log(`Verifying readability of physical collection "${targetPhysicalCollection}"`);
    await assertReadable({
      name: targetPhysicalCollection,
      runtimeConfig,
    });

    return {
      sourceDocumentCount: documents.length,
      parsedSourceDocumentCount: analysis.loadedDocumentCount,
      chunkCount: indexedChunks.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Build failed: ${message}. Attempting to clean up target physical collection...`);
    await deleteCollection({
      name: targetPhysicalCollection,
      runtimeConfig,
    });
    throw error;
  }
}
