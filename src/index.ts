import { fileURLToPath } from "node:url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config, type ResolvedConfig } from "./config.js";
import { startReindexJob, runIndexJob } from "./indexing/jobs.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import {
  analyzeIndexingSource as analyzeMixedIndexingSource,
  toDocuments as mapOzelgeRecordsToDocuments,
  type UnsupportedSourceFile,
} from "./ingestion/pipeline.js";
import {
  loadOzelgeRecords as loadOzelgeRecordsFromJson,
  type OzelgeRecord,
} from "./ingestion/loaders/ozelgeJsonLoader.js";
import { createVectorStore } from "./rag.js";
import { createConsoleLogSink, type OperationalLogSink } from "./observability/logger.js";

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
    collectionId?: string;
    log?: (message: string) => void;
    logEvent?: OperationalLogSink;
  } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  const logEvent = options.logEvent ?? createConsoleLogSink();
  const collectionId = options.collectionId;
  if (!collectionId) {
    throw new Error(
      "runIndexing now requires options.collectionId; multi-collection indexing must target an explicit logical collection.",
    );
  }

  log(`Starting reindex job for logical collection "${collectionId}"`);

  const registry = createSqliteCollectionRegistry({ dbPath: runtimeConfig.registryPath });
  const context = {
    tenantId: "default",
    userId: "local-dev",
    requestId: "cli-reindex",
  };

  try {
    const job = await startReindexJob({ registry, collectionId, context, runtimeConfig });
    log(`Started job ${job.id}`);
    
    await runIndexJob({ registry, jobId: job.id, runtimeConfig, log, logEvent });
  } finally {
    registry.close?.();
  }
}

async function main(): Promise<void> {
  const collectionId = parseCollectionIdArg(process.argv.slice(2));
  await runIndexing(config, { collectionId });
}

function parseCollectionIdArg(argv: string[]): string | undefined {
  const collectionIdFlag = "--collection-id";
  const index = argv.indexOf(collectionIdFlag);

  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
