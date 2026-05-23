import { fileURLToPath } from "node:url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "./config.js";
import {
  analyzeIndexingSource as analyzeMixedIndexingSource,
  toDocuments as mapOzelgeRecordsToDocuments,
  type UnsupportedSourceFile,
} from "./ingestion/pipeline.js";
import {
  loadOzelgeRecords as loadOzelgeRecordsFromJson,
  type OzelgeRecord,
} from "./ingestion/loaders/ozelgeJsonLoader.js";
import { createVectorStore, resetChromaCollection } from "./rag.js";

export type IndexingSourceHealthDetails = {
  sourcePath: string;
  fileCount?: number;
  loadedDocumentCount?: number;
  recordCount?: number;
  sampledRecordCount?: number;
  documentCount?: number;
  unsupportedFiles?: UnsupportedSourceFile[];
  indexSampleSize: number;
  sampleLimited: boolean;
};

export async function loadOzelgeRecords(): Promise<OzelgeRecord[]> {
  return loadOzelgeRecordsFromJson(config.ozelgeDataPath);
}

export function toDocuments(records: OzelgeRecord[]) {
  return mapOzelgeRecordsToDocuments(records);
}

export async function analyzeIndexingSource() {
  return analyzeMixedIndexingSource({
    sourcePath: config.sourcePath,
    ozelgeDataPath: config.ozelgeDataPath,
    indexSampleSize: config.indexSampleSize,
  });
}

export async function checkIndexingSourceHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  details: IndexingSourceHealthDetails;
}> {
  const startedAt = Date.now();

  try {
    const analysis = await analyzeIndexingSource();

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: {
        sourcePath: config.sourcePath,
        fileCount: analysis.fileCount,
        loadedDocumentCount: analysis.loadedDocumentCount,
        recordCount: analysis.recordCount,
        sampledRecordCount: analysis.sampledRecordCount,
        documentCount: analysis.documents.length,
        unsupportedFiles: analysis.unsupportedFiles,
        indexSampleSize: config.indexSampleSize,
        sampleLimited: analysis.sampleLimited,
      },
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      details: {
        sourcePath: config.sourcePath,
        indexSampleSize: config.indexSampleSize,
        sampleLimited: false,
      },
    };
  }
}

async function main(): Promise<void> {
  console.log(`Loading indexing source from ${config.sourcePath}`);
  const analysis = await analyzeIndexingSource();
  const documents = analysis.documents;

  console.log(
    `Loaded ${documents.length} indexable documents from ${analysis.loadedDocumentCount} parsed source documents`,
  );
  for (const sourceFile of analysis.sourceFiles) {
    console.log(
      `- ${sourceFile.path} (${sourceFile.sourceType}): ${sourceFile.loadedDocumentCount} documents`,
    );
  }
  for (const unsupportedFile of analysis.unsupportedFiles) {
    console.warn(
      `Skipping unsupported source ${unsupportedFile.path} (${unsupportedFile.extension}): ${unsupportedFile.reason}`,
    );
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  const chunks = await splitter.splitDocuments(documents);
  const indexedChunks = chunks.map((chunk, chunkIndex) => {
    chunk.metadata = {
      ...chunk.metadata,
      chunkIndex,
    };
    return chunk;
  });

  console.log(`Split documents into ${indexedChunks.length} chunks`);
  console.log(`Resetting Chroma collection "${config.chromaCollection}" at ${config.chromaUrl}`);
  await resetChromaCollection();

  console.log(`Indexing into Chroma collection "${config.chromaCollection}" at ${config.chromaUrl}`);
  const vectorStore = createVectorStore();
  await vectorStore.addDocuments(indexedChunks, {
    ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
  });

  console.log("Indexing complete");
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
