import { fileURLToPath } from "node:url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config, type ResolvedConfig } from "./config.js";
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

export type IndexingRunResult = {
  sourceDocumentCount: number;
  parsedSourceDocumentCount: number;
  chunkCount: number;
};

export async function loadOzelgeRecords(): Promise<OzelgeRecord[]> {
  return loadOzelgeRecordsFromJson(config.ozelgeDataPath);
}

export function toDocuments(records: OzelgeRecord[]) {
  return mapOzelgeRecordsToDocuments(records);
}

export async function analyzeIndexingSource(runtimeConfig = config) {
  return analyzeMixedIndexingSource({
    sourcePath: runtimeConfig.sourcePath,
    ozelgeDataPath: runtimeConfig.ozelgeDataPath,
    indexSampleSize: runtimeConfig.indexSampleSize,
  });
}

export async function checkIndexingSourceHealth(runtimeConfig = config): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  details: IndexingSourceHealthDetails;
}> {
  const startedAt = Date.now();

  try {
    const analysis = await analyzeIndexingSource(runtimeConfig);

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: {
        sourcePath: runtimeConfig.sourcePath,
        fileCount: analysis.fileCount,
        loadedDocumentCount: analysis.loadedDocumentCount,
        recordCount: analysis.recordCount,
        sampledRecordCount: analysis.sampledRecordCount,
        documentCount: analysis.documents.length,
        unsupportedFiles: analysis.unsupportedFiles,
        indexSampleSize: runtimeConfig.indexSampleSize,
        sampleLimited: analysis.sampleLimited,
      },
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      details: {
        sourcePath: runtimeConfig.sourcePath,
        indexSampleSize: runtimeConfig.indexSampleSize,
        sampleLimited: false,
      },
    };
  }
}

export async function runIndexing(
  runtimeConfig: ResolvedConfig = config,
  options: {
    log?: (message: string) => void;
  } = {},
): Promise<IndexingRunResult> {
  const log = options.log ?? console.log;

  log(`Loading indexing source from ${runtimeConfig.sourcePath}`);
  const analysis = await analyzeIndexingSource(runtimeConfig);
  const documents = analysis.documents;

  log(
    `Loaded ${documents.length} indexable documents from ${analysis.loadedDocumentCount} parsed source documents`,
  );
  for (const sourceFile of analysis.sourceFiles) {
    log(
      `- ${sourceFile.path} (${sourceFile.sourceType}): ${sourceFile.loadedDocumentCount} documents`,
    );
  }
  for (const unsupportedFile of analysis.unsupportedFiles) {
    console.warn(
      `Skipping unsupported source ${unsupportedFile.path} (${unsupportedFile.extension}): ${unsupportedFile.reason}`,
    );
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: runtimeConfig.chunkSize,
    chunkOverlap: runtimeConfig.chunkOverlap,
  });
  const chunks = await splitter.splitDocuments(documents);
  const indexedChunks = chunks.map((chunk, chunkIndex) => {
    chunk.metadata = {
      ...chunk.metadata,
      chunkIndex,
    };
    return chunk;
  });

  log(`Split documents into ${indexedChunks.length} chunks`);
  log(`Resetting Chroma collection "${runtimeConfig.chromaCollection}" at ${runtimeConfig.chromaUrl}`);
  await resetChromaCollection(runtimeConfig);

  log(`Indexing into Chroma collection "${runtimeConfig.chromaCollection}" at ${runtimeConfig.chromaUrl}`);
  const vectorStore = createVectorStore(runtimeConfig);
  await vectorStore.addDocuments(indexedChunks, {
    ids: indexedChunks.map((chunk) => `${chunk.metadata.documentId}:${chunk.metadata.chunkIndex}`),
  });

  log("Indexing complete");

  return {
    sourceDocumentCount: documents.length,
    parsedSourceDocumentCount: analysis.loadedDocumentCount,
    chunkCount: indexedChunks.length,
  };
}

async function main(): Promise<void> {
  await runIndexing(config);
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
