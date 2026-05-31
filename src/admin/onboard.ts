import fs from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  defaultConfigPath,
  loadConfig,
  parseConfig,
  readConfigFile,
  resolveConfig,
  writeConfigFile,
  type RawConfig,
  type ResolvedConfig,
} from "../config.js";
import { analyzeIndexingSource, runIndexing } from "../index.js";
import {
  checkChatGenerationHealth,
  checkChromaHealth,
  checkEmbeddingHealth,
  checkOllamaHealth,
  type OllamaHealthDetails,
} from "../rag.js";

type CliOptions = {
  configPath: string;
  dryRun: boolean;
  yes: boolean;
  skipIndex: boolean;
  noWrite: boolean;
};

const DISTANCE_METRICS = ["l2", "cosine", "ip"] as const;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: defaultConfigPath,
    dryRun: false,
    yes: false,
    skipIndex: false,
    noWrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--config":
        index += 1;
        if (!argv[index]) {
          throw new Error("--config requires a path.");
        }
        options.configPath = path.resolve(argv[index]);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--skip-index":
        options.skipIndex = true;
        break;
      case "--no-write":
        options.noWrite = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function promptString(
  rl: Interface,
  label: string,
  currentValue: string,
): Promise<string> {
  const answer = await rl.question(`${label} [${currentValue}]: `);
  return answer.trim().length === 0 ? currentValue : answer.trim();
}

async function promptNumber(
  rl: Interface,
  label: string,
  currentValue: number,
  validate: (value: number) => string | null,
): Promise<number> {
  while (true) {
    const answer = await rl.question(`${label} [${currentValue}]: `);
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      return currentValue;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      console.log("Please enter a valid number.");
      continue;
    }

    const validationError = validate(value);
    if (validationError) {
      console.log(validationError);
      continue;
    }

    return value;
  }
}

async function promptEnum<T extends string>(
  rl: Interface,
  label: string,
  currentValue: T,
  values: readonly T[],
): Promise<T> {
  while (true) {
    const answer = await rl.question(`${label} (${values.join("/")}) [${currentValue}]: `);
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      return currentValue;
    }

    if (values.includes(trimmed as T)) {
      return trimmed as T;
    }

    console.log(`Please enter one of: ${values.join(", ")}`);
  }
}

async function promptConfig(rawConfig: RawConfig): Promise<RawConfig> {
  const rl = createInterface({ input, output });

  try {
    console.log("Press Enter to keep the current value.");
    console.log("data.indexSampleSize: 0 means all parsed ozelge records.\n");

    return {
      server: {
        port: await promptNumber(rl, "server.port", rawConfig.server.port, positiveInteger),
      },
      chroma: {
        url: await promptString(rl, "chroma.url", rawConfig.chroma.url),
        collection: await promptString(rl, "chroma.collection", rawConfig.chroma.collection),
        distanceMetric: await promptEnum(
          rl,
          "chroma.distanceMetric",
          rawConfig.chroma.distanceMetric,
          DISTANCE_METRICS,
        ),
      },
      ollama: {
        baseUrl: await promptString(rl, "ollama.baseUrl", rawConfig.ollama.baseUrl),
        chatModel: await promptString(rl, "ollama.chatModel", rawConfig.ollama.chatModel),
        embeddingModel: await promptString(rl, "ollama.embeddingModel", rawConfig.ollama.embeddingModel),
        numCtx: await promptNumber(rl, "ollama.numCtx", rawConfig.ollama.numCtx, positiveInteger),
        numPredict: await promptNumber(rl, "ollama.numPredict", rawConfig.ollama.numPredict, positiveInteger),
      },
      data: {
        sourcePath: await promptString(rl, "data.sourcePath", rawConfig.data.sourcePath),
        ozelgeDataPath: await promptString(rl, "data.ozelgeDataPath", rawConfig.data.ozelgeDataPath),
        indexSampleSize: await promptNumber(
          rl,
          "data.indexSampleSize",
          rawConfig.data.indexSampleSize,
          nonNegativeInteger,
        ),
      },
      rag: {
        chunkSize: await promptNumber(rl, "rag.chunkSize", rawConfig.rag.chunkSize, positiveInteger),
        chunkOverlap: await promptNumber(
          rl,
          "rag.chunkOverlap",
          rawConfig.rag.chunkOverlap,
          nonNegativeInteger,
        ),
        retrievalK: await promptNumber(rl, "rag.retrievalK", rawConfig.rag.retrievalK, positiveInteger),
        retrievalDistanceThreshold: await promptNumber(
          rl,
          "rag.retrievalDistanceThreshold",
          rawConfig.rag.retrievalDistanceThreshold,
          nonNegativeNumber,
        ),
        timeoutMs: await promptNumber(rl, "rag.timeoutMs", rawConfig.rag.timeoutMs, positiveInteger),
      },
      readiness: {
        timeoutMs: await promptNumber(
          rl,
          "readiness.timeoutMs",
          rawConfig.readiness.timeoutMs,
          positiveInteger,
        ),
        embeddingProbeText: await promptString(
          rl,
          "readiness.embeddingProbeText",
          rawConfig.readiness.embeddingProbeText,
        ),
        chatProbeText: await promptString(
          rl,
          "readiness.chatProbeText",
          rawConfig.readiness.chatProbeText,
        ),
      },
    };
  } finally {
    rl.close();
  }
}

function positiveInteger(value: number): string | null {
  return Number.isInteger(value) && value > 0 ? null : "Please enter a positive integer.";
}

function nonNegativeInteger(value: number): string | null {
  return Number.isInteger(value) && value >= 0 ? null : "Please enter a non-negative integer.";
}

function nonNegativeNumber(value: number): string | null {
  return value >= 0 ? null : "Please enter a non-negative number.";
}

async function writeConfigWithBackup(rawConfig: RawConfig, configPath: string): Promise<void> {
  await fs.copyFile(configPath, `${configPath}.bak`);
  await writeConfigFile(rawConfig, configPath);
}

function printConfigSummary(runtimeConfig: ResolvedConfig): void {
  console.log("\nConfig summary:");
  console.log(`- configPath: ${runtimeConfig.configPath}`);
  console.log(`- server.port: ${runtimeConfig.port}`);
  console.log(`- chroma: ${runtimeConfig.chromaUrl} / ${runtimeConfig.chromaCollection}`);
  console.log(`- ollama chat: ${runtimeConfig.ollamaChatModel}`);
  console.log(`- ollama embedding: ${runtimeConfig.ollamaEmbeddingModel}`);
  console.log(`- data.sourcePath: ${runtimeConfig.sourcePath}`);
  console.log(`- data.ozelgeDataPath: ${runtimeConfig.ozelgeDataPath}`);
  console.log(`- data.indexSampleSize: ${runtimeConfig.indexSampleSize}`);
  console.log(`- rag.chunkSize/chunkOverlap: ${runtimeConfig.chunkSize}/${runtimeConfig.chunkOverlap}`);
  console.log(`- rag.retrievalK: ${runtimeConfig.retrievalK}`);
  console.log(`- rag.retrievalDistanceThreshold: ${runtimeConfig.retrievalDistanceThreshold}`);
}

async function printSourceAnalysis(runtimeConfig: ResolvedConfig): Promise<number> {
  const analysis = await analyzeIndexingSource(runtimeConfig);

  console.log("\nSource analysis:");
  console.log(`- sourcePath: ${analysis.sourcePath}`);
  console.log(`- files: ${analysis.fileCount}`);
  console.log(`- parsed/indexable documents: ${analysis.loadedDocumentCount}/${analysis.documents.length}`);
  console.log(`- ozelge records: ${analysis.sampledRecordCount ?? 0}/${analysis.recordCount ?? 0}`);
  console.log(`- sampleLimited: ${analysis.sampleLimited}`);

  for (const sourceFile of analysis.sourceFiles) {
    console.log(`  - ${sourceFile.path} (${sourceFile.sourceType}): ${sourceFile.loadedDocumentCount}`);
  }

  for (const unsupportedFile of analysis.unsupportedFiles) {
    console.warn(`  ! unsupported ${unsupportedFile.path} (${unsupportedFile.extension}): ${unsupportedFile.reason}`);
  }

  return analysis.documents.length;
}

async function runDependencyChecks(runtimeConfig: ResolvedConfig): Promise<boolean> {
  console.log("\nDependency checks:");

  const chroma = await checkChromaHealth(runtimeConfig);
  console.log(`- Chroma: ${chroma.ok ? "ok" : "fail"}${chroma.error ? ` - ${chroma.error}` : ""}`);

  const ollama = await checkOllamaHealth(runtimeConfig);
  console.log(`- Ollama: ${ollama.ok ? "ok" : "fail"}${ollama.error ? ` - ${ollama.error}` : ""}`);

  const ollamaDetails = (ollama.details ?? {}) as Partial<OllamaHealthDetails>;
  const canCheckEmbedding = ollama.ok && ollamaDetails.embeddingModelAvailable === true;
  const canCheckChat = ollama.ok && ollamaDetails.chatModelAvailable === true;

  if (!ollama.ok) {
    return false;
  }

  if (!canCheckEmbedding) {
    console.log(`- Embedding model: missing (${runtimeConfig.ollamaEmbeddingModel})`);
    return false;
  }

  const embedding = await checkEmbeddingHealth(runtimeConfig);
  console.log(`- Embedding smoke: ${embedding.ok ? "ok" : "fail"}${embedding.error ? ` - ${embedding.error}` : ""}`);

  if (!canCheckChat) {
    console.log(`- Chat model: missing (${runtimeConfig.ollamaChatModel}); indexing can still run.`);
  } else {
    const chat = await checkChatGenerationHealth(runtimeConfig);
    console.log(`- Chat smoke: ${chat.ok ? "ok" : "warn"}${chat.error ? ` - ${chat.error}` : ""}`);
  }

  return chroma.ok && embedding.ok;
}

async function confirmIndex(runtimeConfig: ResolvedConfig): Promise<boolean> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      `\nThis will reset Chroma collection "${runtimeConfig.chromaCollection}" at ${runtimeConfig.chromaUrl} and rebuild the index. Continue? (y/N): `,
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rawConfig = parseConfig(readConfigFile(options.configPath), options.configPath);
  const nextRawConfig = options.yes ? rawConfig : await promptConfig(rawConfig);
  const runtimeConfig = resolveConfig(parseConfig(nextRawConfig, options.configPath), options.configPath);

  printConfigSummary(runtimeConfig);

  const shouldWrite = !options.dryRun && !options.noWrite;
  if (shouldWrite && !options.yes) {
    await writeConfigWithBackup(nextRawConfig, options.configPath);
    console.log(`\nConfig written to ${options.configPath}`);
    console.log(`Backup written to ${options.configPath}.bak`);
  } else if (shouldWrite && options.yes) {
    console.log("\nConfig unchanged; --yes uses existing config values.");
  } else {
    console.log("\nConfig not written.");
  }

  const documentCount = await printSourceAnalysis(runtimeConfig);
  if (documentCount === 0) {
    throw new Error("No indexable documents found. Indexing will not run.");
  }

  const dependenciesReadyForIndex = await runDependencyChecks(runtimeConfig);
  if (!dependenciesReadyForIndex && (options.dryRun || options.skipIndex)) {
    console.log("\nDependencies are not ready for indexing, but index is skipped in this mode.");
  } else if (!dependenciesReadyForIndex) {
    throw new Error("Dependencies are not ready for indexing.");
  }

  if (options.dryRun || options.skipIndex) {
    console.log("\nIndex skipped.");
    return;
  }

  if (!options.yes && !(await confirmIndex(runtimeConfig))) {
    console.log("\nIndex cancelled.");
    return;
  }

  const result = await runIndexing(runtimeConfig, {
    log: (message) => console.log(`[index] ${message}`),
  });

  console.log("\nOnboarding complete.");
  console.log(`- indexed source documents: ${result.sourceDocumentCount}`);
  console.log(`- chunks: ${result.chunkCount}`);
  console.log("\nNext step:");
  console.log("npm.cmd run dev");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
