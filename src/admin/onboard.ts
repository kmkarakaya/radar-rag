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
import { analyzeIndexingSource } from "../index.js";
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

async function promptBoolean(
  rl: Interface,
  label: string,
  currentValue: boolean,
): Promise<boolean> {
  while (true) {
    const answer = await rl.question(`${label} [${currentValue ? "Y/n" : "y/N"}]: `);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed.length === 0) {
      return currentValue;
    }

    if (["y", "yes", "true", "1"].includes(trimmed)) {
      return true;
    }

    if (["n", "no", "false", "0"].includes(trimmed)) {
      return false;
    }

    console.log("Please answer yes or no.");
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
    console.log(
      "collectionDefaults.indexSampleSize is the default sample size for newly created collections; 0 means all parsed ozelge records.\n",
    );

    return {
      server: {
        port: await promptNumber(rl, "server.port", rawConfig.server.port, positiveInteger),
      },
      registry: {
        path: await promptString(rl, "registry.path", rawConfig.registry.path),
      },
      chroma: {
        url: await promptString(rl, "chroma.url", rawConfig.chroma.url),
      },
      ollama: {
        baseUrl: await promptString(rl, "ollama.baseUrl", rawConfig.ollama.baseUrl),
        chatModel: await promptString(rl, "ollama.chatModel", rawConfig.ollama.chatModel),
        embeddingModel: await promptString(rl, "ollama.embeddingModel", rawConfig.ollama.embeddingModel),
        numCtx: await promptNumber(rl, "ollama.numCtx", rawConfig.ollama.numCtx, positiveInteger),
        numPredict: await promptNumber(rl, "ollama.numPredict", rawConfig.ollama.numPredict, positiveInteger),
      },
      collectionDefaults: {
        sourcePath: await promptString(rl, "collectionDefaults.sourcePath", rawConfig.collectionDefaults.sourcePath),
        ozelgeDataPath: await promptString(
          rl,
          "collectionDefaults.ozelgeDataPath",
          rawConfig.collectionDefaults.ozelgeDataPath,
        ),
        distanceMetric: await promptEnum(
          rl,
          "collectionDefaults.distanceMetric",
          rawConfig.collectionDefaults.distanceMetric,
          DISTANCE_METRICS,
        ),
        indexSampleSize: await promptNumber(
          rl,
          "collectionDefaults.indexSampleSize",
          rawConfig.collectionDefaults.indexSampleSize,
          nonNegativeInteger,
        ),
        chunkSize: await promptNumber(
          rl,
          "collectionDefaults.chunkSize",
          rawConfig.collectionDefaults.chunkSize,
          positiveInteger,
        ),
        chunkOverlap: await promptNumber(
          rl,
          "collectionDefaults.chunkOverlap",
          rawConfig.collectionDefaults.chunkOverlap,
          nonNegativeInteger,
        ),
        retrievalK: await promptNumber(
          rl,
          "collectionDefaults.retrievalK",
          rawConfig.collectionDefaults.retrievalK,
          positiveInteger,
        ),
        retrievalDistanceThreshold: await promptNumber(
          rl,
          "collectionDefaults.retrievalDistanceThreshold",
          rawConfig.collectionDefaults.retrievalDistanceThreshold,
          nonNegativeNumber,
        ),
        timeoutMs: await promptNumber(
          rl,
          "collectionDefaults.timeoutMs",
          rawConfig.collectionDefaults.timeoutMs,
          positiveInteger,
        ),
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
      cleanup: {
        retentionMs: await promptNumber(
          rl,
          "cleanup.retentionMs",
          rawConfig.cleanup?.retentionMs ?? 3600000,
          nonNegativeInteger,
        ),
      },
      limits: {
        maxConcurrentEmbeddings: await promptNumber(
          rl,
          "limits.maxConcurrentEmbeddings",
          rawConfig.limits?.maxConcurrentEmbeddings ?? 5,
          positiveInteger,
        ),
        maxConcurrentGenerations: await promptNumber(
          rl,
          "limits.maxConcurrentGenerations",
          rawConfig.limits?.maxConcurrentGenerations ?? 2,
          positiveInteger,
        ),
      },
      rateLimit: {
        enabled: await promptBoolean(
          rl,
          "rateLimit.enabled",
          rawConfig.rateLimit?.enabled ?? true,
        ),
        windowMs: await promptNumber(
          rl,
          "rateLimit.windowMs",
          rawConfig.rateLimit?.windowMs ?? 60000,
          positiveInteger,
        ),
        maxRequestsPerWindow: await promptNumber(
          rl,
          "rateLimit.maxRequestsPerWindow",
          rawConfig.rateLimit?.maxRequestsPerWindow ?? 60,
          positiveInteger,
        ),
      },
      adminAuth: rawConfig.adminAuth,
      observability: {
        includeDebugTimings: await promptBoolean(
          rl,
          "observability.includeDebugTimings",
          rawConfig.observability?.includeDebugTimings ?? false,
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
  console.log(`- registry.path: ${runtimeConfig.registryPath}`);
  console.log(`- chroma.url: ${runtimeConfig.chromaUrl}`);
  console.log(`- ollama chat: ${runtimeConfig.ollamaChatModel}`);
  console.log(`- ollama embedding: ${runtimeConfig.ollamaEmbeddingModel}`);
  console.log(`- collectionDefaults.sourcePath: ${runtimeConfig.sourcePath}`);
  console.log(`- collectionDefaults.ozelgeDataPath: ${runtimeConfig.ozelgeDataPath}`);
  console.log(`- collectionDefaults.distanceMetric: ${runtimeConfig.chromaDistanceMetric}`);
  console.log(`- collectionDefaults.indexSampleSize: ${runtimeConfig.indexSampleSize}`);
  console.log(`- collectionDefaults.chunkSize/chunkOverlap: ${runtimeConfig.chunkSize}/${runtimeConfig.chunkOverlap}`);
  console.log(`- collectionDefaults.retrievalK: ${runtimeConfig.retrievalK}`);
  console.log(`- collectionDefaults.retrievalDistanceThreshold: ${runtimeConfig.retrievalDistanceThreshold}`);
  console.log(`- cleanup.retentionMs: ${runtimeConfig.cleanupRetentionMs}`);
  console.log(`- limits.maxConcurrentEmbeddings: ${runtimeConfig.maxConcurrentEmbeddings}`);
  console.log(`- limits.maxConcurrentGenerations: ${runtimeConfig.maxConcurrentGenerations}`);
  console.log(`- rateLimit.enabled: ${runtimeConfig.rateLimitEnabled}`);
  console.log(`- rateLimit.windowMs/maxRequestsPerWindow: ${runtimeConfig.rateLimitWindowMs}/${runtimeConfig.rateLimitMaxRequestsPerWindow}`);
  console.log(`- adminAuth.enabled: ${runtimeConfig.adminAuth.enabled}`);
  console.log(`- adminAuth.users: ${runtimeConfig.adminAuth.users.length}`);
  console.log(`- observability.includeDebugTimings: ${runtimeConfig.includeDebugTimings}`);
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

  console.log("\nIndex skipped. Multi-collection indexing must use the registry-backed collection job flow.");
  console.log("Use `npm run index -- --collection-id <id>` to reindex an existing collection.");
  console.log("\nNext step:");
  console.log("npm run dev");
  console.log("Use `npm run admin:hash-password` to generate admin password hashes.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
