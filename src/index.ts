import { fileURLToPath } from "node:url";
import { type Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "./config.js";
import {
  analyzeOzelgeIndexingSource,
  loadSourceDocuments,
  toDocuments as mapOzelgeRecordsToDocuments,
} from "./ingestion/pipeline.js";
import {
  loadOzelgeRecords as loadOzelgeRecordsFromJson,
  type OzelgeRecord,
} from "./ingestion/loaders/ozelgeJsonLoader.js";
import { createVectorStore, resetChromaCollection } from "./rag.js";

export type IndexingSourceHealthDetails = {
  dataPath: string;
  recordCount?: number;
  sampledRecordCount?: number;
  documentCount?: number;
  indexSampleSize: number;
  sampleLimited: boolean;
};

export async function loadOzelgeRecords(): Promise<OzelgeRecord[]> {
  return loadOzelgeRecordsFromJson(config.ozelgeDataPath);
}

export function toDocuments(records: OzelgeRecord[]) {
  return mapOzelgeRecordsToDocuments(records);
}

export async function analyzeIndexingSource(): Promise<{
  records: OzelgeRecord[];
  sampledRecords: OzelgeRecord[];
  documents: Document[];
  sampleLimited: boolean;
}> {
  return analyzeOzelgeIndexingSource(config.ozelgeDataPath, config.indexSampleSize);
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
        dataPath: config.ozelgeDataPath,
        recordCount: analysis.records.length,
        sampledRecordCount: analysis.sampledRecords.length,
        documentCount: analysis.documents.length,
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
        dataPath: config.ozelgeDataPath,
        indexSampleSize: config.indexSampleSize,
        sampleLimited: false,
      },
    };
  }
}

async function main(): Promise<void> {
  console.log(`Loading ozelge data from ${config.ozelgeDataPath}`);
  const { records, sampledRecords } = await analyzeIndexingSource();
  const documents = await loadSourceDocuments(config.ozelgeDataPath, config.indexSampleSize);

  console.log(`Loaded ${documents.length} documents from first ${sampledRecords.length} records`);

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
    ids: indexedChunks.map((chunk) => `${chunk.metadata.ozelgeId}-${chunk.metadata.chunkIndex}`),
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
