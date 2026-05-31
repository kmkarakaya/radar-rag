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
}): Promise<{
  sourceDocumentCount: number;
  parsedSourceDocumentCount: number;
  chunkCount: number;
}> {
  const { collection, targetPhysicalCollection, targetVersion, runtimeConfig } = input;
  const log = input.log ?? console.log;

  try {
    log(`Creating physical collection "${targetPhysicalCollection}" (version: ${targetVersion})`);
    await createPhysicalChromaCollection({
      name: targetPhysicalCollection,
      distanceMetric: collection.distanceMetric,
      runtimeConfig,
    });

    log(`Analyzing indexing source from ${collection.sourcePath}`);
    const analysis = await analyzeIndexingSource({
      sourcePath: collection.sourcePath,
      ozelgeDataPath: collection.ozelgeDataPath,
      indexSampleSize: runtimeConfig.indexSampleSize,
    });

    const documents = analysis.documents;

    log(`Loaded ${documents.length} indexable documents from ${analysis.loadedDocumentCount} parsed source documents`);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: collection.chunkSize,
      chunkOverlap: collection.chunkOverlap,
    });

    const chunks = await splitter.splitDocuments(documents);
    const indexedChunks = addMetadataToChunks(
      chunks,
      collection,
      targetPhysicalCollection,
      targetVersion,
    );

    log(`Split documents into ${indexedChunks.length} chunks. Indexing into Chroma...`);

    const vectorStore = createVectorStore({
      collectionName: targetPhysicalCollection,
      runtimeConfig,
    });

    await vectorStore.addDocuments(indexedChunks, {
      ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
    });

    log(`Verifying readability of physical collection "${targetPhysicalCollection}"`);
    await assertChromaCollectionReadable({
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
    await deletePhysicalChromaCollection({
      name: targetPhysicalCollection,
      runtimeConfig,
    });
    throw error;
  }
}
