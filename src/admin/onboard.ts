import fs from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashPassword } from "./passwordHash.js";
import { toPortablePath } from "../paths.js";
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
import { defaultAdminSessionSecretFilePath, validateAdminAuthConfig } from "../http/adminAuth.js";
import { analyzeIndexingSource } from "../index.js";
import { checkChatGeneration, checkChatProvider } from "../chat.js";
import { defaultChatApiKeyFilePath, readSecretFile, removeSecretFile, writeSecretFile } from "../secrets.js";
import {
  checkChromaHealth,
  checkEmbeddingHealth,
  checkOllamaHealth,
  type OllamaHealthDetails,
} from "../rag.js";

type CliOptions = {
  configPath: string;
  dryRun: boolean;
  yes: boolean;
  /** @deprecated Onboarding no longer runs indexing; the flag only prints a notice. */
  skipIndex: boolean;
  noWrite: boolean;
};

/** What to do with the chat API key file (.local/rag_chat_api_key.secret); the key never goes into the YAML. */
type ChatApiKeyAction = { kind: "keep" } | { kind: "set"; value: string } | { kind: "remove" };

type PromptedConfig = {
  rawConfig: RawConfig;
  adminSessionSecretValue?: string;
  chatApiKeyAction: ChatApiKeyAction;
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
        // Deprecated: onboarding no longer runs indexing. Accepted so existing scripts keep working.
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

/** Like promptString, but "-" clears the value. */
async function promptClearableString(rl: Interface, label: string, currentValue: string): Promise<string> {
  const answer = (await rl.question(`${label} [${currentValue}]: `)).trim();
  if (answer === "-") return "";
  return answer.length === 0 ? currentValue : answer;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function describeStoredChatApiKey(env: NodeJS.ProcessEnv): string {
  if (env.RAG_CHAT_API_KEY?.trim()) return "set via RAG_CHAT_API_KEY, which overrides the file";
  return readSecretFile(defaultChatApiKeyFilePath, "chat API key") ? `stored in ${defaultChatApiKeyFilePath}` : "none";
}

/**
 * Optional chat LLM for /query: only base URL, model and API key are asked. Model parameters are left
 * to the provider defaults; advanced keys added by hand to the YAML (temperature, maxTokens,
 * maxContextTokens) are kept.
 */
async function promptChat(
  rl: Interface,
  current: RawConfig["chat"],
  onApiKey: (action: ChatApiKeyAction) => void,
): Promise<NonNullable<RawConfig["chat"]>> {
  const advanced = {
    ...(current?.temperature !== undefined ? { temperature: current.temperature } : {}),
    ...(current?.maxTokens !== undefined ? { maxTokens: current.maxTokens } : {}),
    ...(current?.maxContextTokens !== undefined ? { maxContextTokens: current.maxContextTokens } : {}),
  };

  console.log("\nChat LLM for /query (optional). Leave the base URL empty for retrieve-only; type - to clear it.");
  console.log("Any OpenAI-compatible API works, for example:");
  console.log("  local Ollama: http://localhost:11434/v1");
  console.log("  OpenAI:       https://api.openai.com/v1");
  console.log("  OpenRouter:   https://openrouter.ai/api/v1");

  let baseUrl = "";
  while (true) {
    baseUrl = await promptClearableString(rl, "chat.baseUrl", current?.baseUrl ?? "");
    if (baseUrl === "" || isHttpUrl(baseUrl)) break;
    console.log("Please enter an http(s) URL, or leave it empty for retrieve-only.");
  }

  if (baseUrl === "") {
    console.log("Chat LLM disabled: /query will return CHAT_NOT_CONFIGURED; retrieval and indexing still work.");
    return { ...advanced, baseUrl: "", model: "" };
  }

  const model = current?.model
    ? await promptString(rl, "chat.model", current.model)
    : await promptRequiredString(rl, "chat.model");

  const keyAnswer = (await rl.question(
    `chat API key [${describeStoredChatApiKey(process.env)}] (Enter = keep, - = remove; not needed for a local Ollama): `,
  )).trim();
  if (keyAnswer === "-") {
    onApiKey({ kind: "remove" });
  } else if (keyAnswer.length > 0) {
    onApiKey({ kind: "set", value: keyAnswer });
  }

  return { ...advanced, baseUrl, model };
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

async function promptRequiredString(rl: Interface, label: string): Promise<string> {
  while (true) {
    const answer = await rl.question(`${label}: `);
    const trimmed = answer.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    console.log("Please enter a value.");
  }
}

async function promptSecretConfirmation(rl: Interface, label: string): Promise<string> {
  while (true) {
    const secret = await promptRequiredString(rl, `${label}`);
    const confirmation = await promptRequiredString(rl, `${label} (confirm)`);

    if (secret === confirmation) {
      return secret;
    }

    console.log("Values do not match. Please try again.");
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

async function promptAdminAuth(
  rl: Interface,
  rawAdminAuth: RawConfig["adminAuth"],
): Promise<{
  adminAuth: RawConfig["adminAuth"];
  adminSessionSecretValue?: string;
}> {
  console.log(
    "Admin auth is optional. If you enable it, onboarding stores the session secret locally and hashes the first admin password for you.\n",
  );

  const enabled = await promptBoolean(rl, "adminAuth.enabled", rawAdminAuth.enabled ?? false);
  if (!enabled) {
    return {
      adminAuth: {
        ...rawAdminAuth,
        enabled: false,
        users: [],
      },
    };
  }

  const adminSessionSecretValue = await promptSecretConfirmation(rl, "adminAuth.sessionSecretValue");
  const username = await promptString(rl, "adminAuth.users[0].username", rawAdminAuth.users[0]?.username ?? "admin");
  const tenantId = await promptString(rl, "adminAuth.users[0].tenantId", rawAdminAuth.users[0]?.tenantId ?? "default");
  const password = await promptSecretConfirmation(rl, "adminAuth.users[0].password");

  return {
    adminAuth: {
      ...rawAdminAuth,
      enabled: true,
      users: [
        {
          username,
          passwordHash: hashPassword(password),
          role: "admin",
          tenantId,
        },
      ],
    },
    adminSessionSecretValue,
  };
}

async function promptConfig(rawConfig: RawConfig): Promise<PromptedConfig> {
  const rl = createInterface({ input, output });

  try {
    console.log("Press Enter to keep the current value.\n");

    const adminAuthResult = await promptAdminAuth(rl, rawConfig.adminAuth);
    let chatApiKeyAction: ChatApiKeyAction = { kind: "keep" };

    return {
      rawConfig: {
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
          embeddingModel: await promptString(rl, "ollama.embeddingModel", rawConfig.ollama.embeddingModel),
        },
        chat: await promptChat(rl, rawConfig.chat, (action) => {
          chatApiKeyAction = action;
        }),
        collectionDefaults: {
          sourcePath: await promptString(rl, "collectionDefaults.sourcePath", rawConfig.collectionDefaults.sourcePath),
          distanceMetric: await promptEnum(
            rl,
            "collectionDefaults.distanceMetric",
            rawConfig.collectionDefaults.distanceMetric,
            DISTANCE_METRICS,
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
          // Used only by onboarding's chat smoke test; not asked, edit the YAML to change it.
          chatProbeText: rawConfig.readiness.chatProbeText,
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
        adminAuth: adminAuthResult.adminAuth,
        observability: {
          includeDebugTimings: await promptBoolean(
            rl,
            "observability.includeDebugTimings",
            rawConfig.observability?.includeDebugTimings ?? false,
          ),
        },
      },
      adminSessionSecretValue: adminAuthResult.adminSessionSecretValue,
      chatApiKeyAction,
    };
  } finally {
    rl.close();
  }
}

async function writeAdminSessionSecretFile(secretValue: string): Promise<void> {
  await writeSecretFile(defaultAdminSessionSecretFilePath, secretValue);
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

/** Paths inside the project are written relative (e.g. `data`), so the config works on other machines. */
function withPortablePaths(rawConfig: RawConfig): RawConfig {
  return {
    ...rawConfig,
    registry: { ...rawConfig.registry, path: toPortablePath(rawConfig.registry.path) },
    collectionDefaults: {
      ...rawConfig.collectionDefaults,
      sourcePath: toPortablePath(rawConfig.collectionDefaults.sourcePath),
    },
  };
}

async function writeConfigWithBackup(rawConfig: RawConfig, configPath: string): Promise<void> {
  await fs.copyFile(configPath, `${configPath}.bak`);
  await writeConfigFile(withPortablePaths(rawConfig), configPath);
}

async function printConfigSummary(runtimeConfig: ResolvedConfig, env: NodeJS.ProcessEnv): Promise<void> {
  const sessionSecretConfigured = ((env[runtimeConfig.adminAuth.sessionSecretEnvVar] ?? "").trim().length > 0)
    || await fs.access(path.resolve(process.cwd(), defaultAdminSessionSecretFilePath)).then(() => true).catch(() => false);

  console.log("\nConfig summary:");
  console.log(`- configPath: ${runtimeConfig.configPath}`);
  console.log(`- server.port: ${runtimeConfig.port}`);
  console.log(`- registry.path: ${runtimeConfig.registryPath}`);
  console.log(`- chroma.url: ${runtimeConfig.chromaUrl}`);
  console.log(`- ollama embedding: ${runtimeConfig.ollamaEmbeddingModel}`);
  console.log(runtimeConfig.chat.enabled
    ? `- chat: ${runtimeConfig.chat.model} @ ${runtimeConfig.chat.baseUrl}, api key: ${runtimeConfig.chat.apiKeySource === "none" ? "not set" : runtimeConfig.chat.apiKeySource}`
    : "- chat: disabled (/query off, retrieve-only)");
  console.log(`- collectionDefaults.sourcePath: ${runtimeConfig.sourcePath}`);
  console.log(`- collectionDefaults.distanceMetric: ${runtimeConfig.chromaDistanceMetric}`);
  console.log(`- collectionDefaults.chunkSize/chunkOverlap: ${runtimeConfig.chunkSize}/${runtimeConfig.chunkOverlap}`);
  console.log(`- collectionDefaults.retrievalK: ${runtimeConfig.retrievalK}`);
  console.log(`- collectionDefaults.retrievalDistanceThreshold: ${runtimeConfig.retrievalDistanceThreshold}`);
  console.log(`- cleanup.retentionMs: ${runtimeConfig.cleanupRetentionMs}`);
  console.log(`- limits.maxConcurrentEmbeddings: ${runtimeConfig.maxConcurrentEmbeddings}`);
  console.log(`- limits.maxConcurrentGenerations: ${runtimeConfig.maxConcurrentGenerations}`);
  console.log(`- rateLimit.enabled: ${runtimeConfig.rateLimitEnabled}`);
  console.log(`- rateLimit.windowMs/maxRequestsPerWindow: ${runtimeConfig.rateLimitWindowMs}/${runtimeConfig.rateLimitMaxRequestsPerWindow}`);
  console.log(`- adminAuth.enabled: ${runtimeConfig.adminAuth.enabled}`);
  console.log(`- adminAuth.sessionSecretEnvVar: ${runtimeConfig.adminAuth.sessionSecretEnvVar}`);
  console.log(`- adminAuth.sessionSecretConfigured: ${sessionSecretConfigured}`);
  console.log(`- adminAuth.users: ${runtimeConfig.adminAuth.users.length}`);
  console.log(`- observability.includeDebugTimings: ${runtimeConfig.includeDebugTimings}`);
}

async function printSourceAnalysis(runtimeConfig: ResolvedConfig): Promise<number> {
  const analysis = await analyzeIndexingSource(runtimeConfig);

  console.log("\nSource analysis:");
  console.log(`- sourcePath: ${analysis.sourcePath}`);
  console.log(`- files: ${analysis.fileCount}`);
  console.log(`- parsed/indexable documents: ${analysis.loadedDocumentCount}/${analysis.documents.length}`);

  for (const sourceFile of analysis.sourceFiles) {
    console.log(`  - ${sourceFile.path} (${sourceFile.sourceType}): ${sourceFile.loadedDocumentCount}`);
  }

  for (const unsupportedFile of analysis.unsupportedFiles) {
    console.warn(`  ! unsupported ${unsupportedFile.path} (${unsupportedFile.extension}): ${unsupportedFile.reason}`);
  }

  return analysis.documents.length;
}

type SetupIssue = {
  problem: string;
  fix: string;
};

/** Runs dependency checks and returns what must be fixed before indexing. Never throws for an unhealthy dependency. */
async function runDependencyChecks(runtimeConfig: ResolvedConfig): Promise<SetupIssue[]> {
  console.log("\nDependency checks:");
  const issues: SetupIssue[] = [];

  const chroma = await checkChromaHealth(runtimeConfig);
  console.log(`- Chroma: ${chroma.ok ? "ok" : "fail"}${chroma.error ? ` - ${chroma.error}` : ""}`);
  if (!chroma.ok) {
    issues.push({
      problem: `Chroma is not reachable at ${runtimeConfig.chromaUrl}.`,
      fix: "Start Docker Desktop, wait for \"Engine running\", then run: docker compose up -d chroma",
    });
  }

  issues.push(...await runOllamaChecks(runtimeConfig));
  issues.push(...await runChatChecks(runtimeConfig));
  return issues;
}

async function runOllamaChecks(runtimeConfig: ResolvedConfig): Promise<SetupIssue[]> {
  const issues: SetupIssue[] = [];
  const ollama = await checkOllamaHealth(runtimeConfig);
  console.log(`- Ollama: ${ollama.ok ? "ok" : "fail"}${ollama.error ? ` - ${ollama.error}` : ""}`);
  if (!ollama.ok) {
    issues.push({
      problem: `Ollama is not reachable at ${runtimeConfig.ollamaBaseUrl}.`,
      fix: "Start Ollama (desktop app or: ollama serve), or fix ollama.baseUrl in the config.",
    });
    return issues;
  }

  const ollamaDetails = (ollama.details ?? {}) as Partial<OllamaHealthDetails>;

  if (ollamaDetails.embeddingModelAvailable !== true) {
    console.log(`- Embedding model: missing (${runtimeConfig.ollamaEmbeddingModel})`);
    console.log(`  Run: ollama pull ${runtimeConfig.ollamaEmbeddingModel}`);
    issues.push({
      problem: `Embedding model ${runtimeConfig.ollamaEmbeddingModel} is not pulled in Ollama.`,
      fix: `ollama pull ${runtimeConfig.ollamaEmbeddingModel}`,
    });
  } else {
    const embedding = await checkEmbeddingHealth(runtimeConfig);
    console.log(`- Embedding smoke: ${embedding.ok ? "ok" : "fail"}${embedding.error ? ` - ${embedding.error}` : ""}`);
    if (!embedding.ok) {
      issues.push({
        problem: `Embedding model ${runtimeConfig.ollamaEmbeddingModel} did not return a usable vector.`,
        fix: `Check the Ollama logs, re-pull with: ollama pull ${runtimeConfig.ollamaEmbeddingModel}, or choose another embedding model.`,
      });
    }
  }

  return issues;
}

/** Checks the optional chat LLM: the free model listing first, then one real generation (onboarding only). */
async function runChatChecks(runtimeConfig: ResolvedConfig): Promise<SetupIssue[]> {
  const chat = runtimeConfig.chat;
  if (!chat.enabled) {
    console.log("- Chat LLM: not configured (/query disabled, retrieve-only)");
    return [];
  }

  const provider = await checkChatProvider(runtimeConfig, { useCache: false });
  if (!provider.reachable) {
    console.log(`- Chat LLM: fail - ${provider.error ?? "not reachable"}`);
    return [{
      problem: `The chat LLM at ${chat.baseUrl} is not reachable (needed for /query only).`,
      fix: "Start it, or rerun onboarding with the right chat.baseUrl (an OpenAI-compatible URL such as http://localhost:11434/v1).",
    }];
  }
  if (!provider.authOk) {
    console.log("- Chat LLM: fail - the API key was rejected");
    return [{
      problem: `The chat LLM at ${chat.baseUrl} rejected the API key.`,
      fix: "Rerun onboarding with the right key, or set RAG_CHAT_API_KEY.",
    }];
  }
  if (provider.modelListed === false) {
    const suggestions = (provider.availableModels ?? []).slice(0, 10).join(", ");
    console.log(`- Chat model: missing (${chat.model})`);
    return [{
      problem: `Chat model ${chat.model} is not offered by ${chat.baseUrl}.`,
      fix: suggestions
        ? `Rerun onboarding and pick one of: ${suggestions}`
        : `Rerun onboarding with another model, or for a local Ollama run: ollama pull ${chat.model}`,
    }];
  }

  const generation = await checkChatGeneration(runtimeConfig);
  console.log(`- Chat smoke: ${generation.ok ? "ok" : "fail"}${generation.error ? ` - ${generation.error}` : ""}`);
  return generation.ok
    ? []
    : [{
      problem: `Chat model ${chat.model} did not answer the smoke prompt (needed for /query only).`,
      fix: "Check the provider logs or rerun onboarding with another chat model.",
    }];
}

function printSetupIssues(issues: SetupIssue[], configWritten: boolean): void {
  if (issues.length === 0) {
    console.log("\nAll dependency checks passed.");
    return;
  }

  console.log(configWritten
    ? "\nConfig saved; fix these before indexing:"
    : "\nFix these before indexing:");
  for (const issue of issues) {
    console.log(`- ${issue.problem}`);
    console.log(`  Fix: ${issue.fix}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rawConfig = parseConfig(readConfigFile(options.configPath), options.configPath);
  const nextConfig: PromptedConfig = options.yes
    ? { rawConfig, adminSessionSecretValue: undefined, chatApiKeyAction: { kind: "keep" } }
    : await promptConfig(rawConfig);
  const keyAction = nextConfig.chatApiKeyAction;
  const runtimeConfig = resolveConfig(parseConfig(nextConfig.rawConfig, options.configPath), options.configPath, process.cwd(), {
    // Checks below use the key just entered, even before (or without) writing the secret file.
    chatApiKeyOverride: keyAction.kind === "set" ? keyAction.value : keyAction.kind === "remove" ? null : undefined,
  });

  await printConfigSummary(runtimeConfig, process.env);

  if (options.skipIndex) {
    console.log("\nNote: --skip-index is deprecated and has no effect; onboarding no longer runs indexing.");
  }

  const shouldWrite = !options.dryRun && !options.noWrite;
  const configWritten = shouldWrite && !options.yes;
  if (shouldWrite && !options.yes) {
    await writeConfigWithBackup(nextConfig.rawConfig, options.configPath);
    if (nextConfig.adminSessionSecretValue) {
      await writeAdminSessionSecretFile(nextConfig.adminSessionSecretValue);
      console.log(`Secret written to ${defaultAdminSessionSecretFilePath}`);
    }
    if (keyAction.kind === "set") {
      await writeSecretFile(defaultChatApiKeyFilePath, keyAction.value);
      console.log(`Chat API key written to ${defaultChatApiKeyFilePath} (gitignored; never stored in the YAML).`);
    } else if (keyAction.kind === "remove") {
      await removeSecretFile(defaultChatApiKeyFilePath);
      console.log(`Chat API key removed from ${defaultChatApiKeyFilePath}.`);
    }
    console.log(`\nConfig written to ${options.configPath}`);
    console.log(`Backup written to ${options.configPath}.bak`);
  } else if (shouldWrite && options.yes) {
    console.log("\nConfig unchanged; --yes uses existing config values.");
  } else {
    console.log("\nConfig not written.");
  }

  validateAdminAuthConfig({
    config: runtimeConfig.adminAuth,
    env: process.env,
  });

  // Onboarding's job is the config; source and dependency problems are reported with a fix, not fatal.
  const issues: SetupIssue[] = [];
  try {
    const documentCount = await printSourceAnalysis(runtimeConfig);
    if (documentCount === 0) {
      issues.push({
        problem: `No indexable documents found under ${runtimeConfig.sourcePath}.`,
        fix: "Add .txt, .md, .pdf, .doc or .docx files there, or set collectionDefaults.sourcePath to a folder that has them.",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\nSource analysis: fail - ${message}`);
    issues.push({
      problem: `Default source path ${runtimeConfig.sourcePath} cannot be read.`,
      fix: "Create the folder or set collectionDefaults.sourcePath to an existing folder.",
    });
  }

  issues.push(...await runDependencyChecks(runtimeConfig));
  printSetupIssues(issues, configWritten);

  const adminUrl = runtimeConfig.adminAuth.enabled
    ? `http://localhost:${runtimeConfig.port}/admin/login`
    : `http://localhost:${runtimeConfig.port}/admin`;

  console.log("\nCollection creation and indexing are not performed by onboarding.");
  console.log("Use the admin panel or the admin API/job flow for multi-collection creation and reindexing.");
  console.log("Automation note: use `npm run index -- --collection-id <id>` only to reindex an existing collection.");
  console.log("\nNext steps:");
  console.log("- npm run dev");
  console.log(`- http://localhost:${runtimeConfig.port}/ready`);
  console.log(`- ${adminUrl}`);
  console.log(`- http://localhost:${runtimeConfig.port}/test-frontend/`);
  if (!runtimeConfig.chat.enabled) {
    console.log("- Optional: rerun onboarding with a chat.baseUrl and chat.model to enable answer generation (/query).");
  }
  if (runtimeConfig.adminAuth.enabled) {
    console.log("- npm run admin:hash-password");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
