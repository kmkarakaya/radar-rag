import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  defaultChatApiKeyFilePath,
  defaultEmbeddingApiKeyFilePath,
  readSecretFile,
  removeSecretFile,
  writeSecretFile,
} from "../secrets.js";
import { checkChromaHealth, checkEmbeddingHealth } from "../rag.js";
import {
  builtinEmbeddingModelIds,
  checkEmbeddingTarget,
  DEFAULT_BUILTIN_EMBEDDING_MODEL,
  EMBEDDING_PROVIDERS,
  getBuiltinEmbeddingModelSpec,
  isBuiltinModelCached,
} from "../embeddings/index.js";

type CliOptions = {
  configPath: string;
  dryRun: boolean;
  yes: boolean;
  /** @deprecated Onboarding no longer runs indexing; the flag only prints a notice. */
  skipIndex: boolean;
  noWrite: boolean;
  /** Ask every setting (ports, Chroma URL, chunking, limits...). Without it only the main choices are asked. */
  advanced: boolean;
};

/** What to do with an API key file under .local/ (chat or embedding); keys never go into the YAML. */
type ApiKeyAction = { kind: "keep" } | { kind: "set"; value: string } | { kind: "remove" };
type ChatApiKeyAction = ApiKeyAction;

type PromptedConfig = {
  rawConfig: RawConfig;
  adminSessionSecretValue?: string;
  chatApiKeyAction: ApiKeyAction;
  embeddingApiKeyAction: ApiKeyAction;
};

function apiKeyOverride(action: ApiKeyAction): string | null | undefined {
  return action.kind === "set" ? action.value : action.kind === "remove" ? null : undefined;
}

const DISTANCE_METRICS = ["l2", "cosine", "ip"] as const;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: defaultConfigPath,
    dryRun: false,
    yes: false,
    skipIndex: false,
    noWrite: false,
    advanced: false,
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
      case "--advanced":
        options.advanced = true;
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

/** Suggested when no chat base URL is configured yet: a local Ollama's OpenAI-compatible API. */
const SUGGESTED_CHAT_BASE_URL = "http://localhost:11434/v1";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function describeStoredEmbeddingApiKey(env: NodeJS.ProcessEnv): string {
  if (env.RAG_EMBEDDING_API_KEY?.trim()) return "set via RAG_EMBEDDING_API_KEY, which overrides the file";
  return readSecretFile(defaultEmbeddingApiKeyFilePath, "embedding API key") ? `stored in ${defaultEmbeddingApiKeyFilePath}` : "none";
}

async function promptApiKey(rl: Interface, label: string, stored: string, hint: string): Promise<ApiKeyAction> {
  const answer = (await rl.question(`${label} [${stored}] (Enter = keep, - = remove; ${hint}): `)).trim();
  if (answer === "-") return { kind: "remove" };
  return answer.length > 0 ? { kind: "set", value: answer } : { kind: "keep" };
}

/**
 * Embedding (required): the provider and model used as the default for NEW collections, and the
 * openai-compatible service if one is used. The default answer is always the current value, so Enter
 * never changes anything. Built-in models are not downloaded here: they download on first indexing.
 */
async function promptEmbedding(
  rl: Interface,
  current: RawConfig["embedding"],
  onApiKey: (action: ApiKeyAction) => void,
): Promise<RawConfig["embedding"]> {
  console.log("\nEmbedding (required). Used for indexing and retrieval.");
  console.log(`Current default for new collections: ${current.provider} / ${current.model}`);
  console.log("  builtin:           runs inside the backend on the CPU; nothing else to install.");
  console.log("  openai-compatible: any OpenAI-compatible /v1/embeddings API (Ollama, OpenAI, LM Studio, vLLM...).");

  const provider = await promptEnum(rl, "Embedding provider for new collections", current.provider, EMBEDDING_PROVIDERS);

  let result: RawConfig["embedding"];
  if (provider === "builtin") {
    const models = builtinEmbeddingModelIds();
    const currentModel = current.provider === "builtin" && models.includes(current.model) ? current.model : DEFAULT_BUILTIN_EMBEDDING_MODEL;
    const model = models.length > 1
      ? await promptEnum(rl, "Built-in embedding model", currentModel, models)
      : currentModel;
    const spec = getBuiltinEmbeddingModelSpec(model);
    const cacheDir = path.resolve(process.cwd(), current.cacheDir);
    console.log(isBuiltinModelCached(model, cacheDir)
      ? `Built-in model ${model} is already downloaded (${current.cacheDir}).`
      : `Built-in model ${model} (~${spec?.approxDownloadMb ?? "?"} MB) is downloaded on the first indexing into ${current.cacheDir}/.`);
    result = { ...current, provider, model };
  } else {
    console.log("Press Enter to accept the value in [brackets]. Example for a local Ollama: http://localhost:11434/v1");
    let baseUrl = "";
    while (true) {
      baseUrl = await promptString(rl, "embedding.baseUrl", current.baseUrl || SUGGESTED_CHAT_BASE_URL);
      if (isHttpUrl(baseUrl)) break;
      console.log("Please enter an http(s) URL, for example http://localhost:11434/v1.");
    }
    const model = current.provider === "openai-compatible" && current.model
      ? await promptString(rl, "embedding.model", current.model)
      : await promptRequiredString(rl, "embedding.model (e.g. embeddinggemma-2:270m for Ollama)");
    onApiKey(await promptApiKey(rl, "embedding API key", describeStoredEmbeddingApiKey(process.env), "not needed for a local Ollama"));
    result = { ...current, provider, model, baseUrl };
  }

  if (result.provider !== current.provider || result.model !== current.model || result.baseUrl !== current.baseUrl) {
    console.log("Note: this only changes the default for NEW collections. Existing collections keep their embedding model;");
    console.log("if you changed the external service address, reindex the collections that use it.");
  }
  return result;
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

  const currentlyEnabled = Boolean(current?.baseUrl && current?.model);

  // An explicit yes/no first, so Enter never turns answer generation on (or off) by accident:
  // the default answer is always the current state.
  console.log("\nAnswer generation (/query) is optional. Without a chat LLM the backend is retrieve-only:");
  console.log("/retrieve and indexing work, and /query returns CHAT_NOT_CONFIGURED.");
  console.log(currentlyEnabled
    ? `Current: enabled (${current?.model} @ ${current?.baseUrl})`
    : "Current: disabled (retrieve-only)");

  const enable = await promptBoolean(rl, "Enable answer generation with a chat LLM?", currentlyEnabled);
  if (!enable) {
    console.log("Chat LLM disabled: retrieve-only. Run onboarding again to enable it later.");
    return { ...advanced, baseUrl: "", model: "" };
  }

  console.log("Any OpenAI-compatible API works. Press Enter to accept the value in [brackets]. Examples:");
  console.log(`  local Ollama: ${SUGGESTED_CHAT_BASE_URL}`);
  console.log("  OpenAI:       https://api.openai.com/v1");
  console.log("  OpenRouter:   https://openrouter.ai/api/v1");

  let baseUrl = "";
  while (true) {
    baseUrl = await promptString(rl, "chat.baseUrl", current?.baseUrl || SUGGESTED_CHAT_BASE_URL);
    if (isHttpUrl(baseUrl)) break;
    console.log("Please enter an http(s) URL, for example http://localhost:11434/v1.");
  }

  const model = current?.model
    ? await promptString(rl, "chat.model", current.model)
    : await promptRequiredString(rl, "chat.model (e.g. gemma3:4b for a local Ollama)");

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

/**
 * Default mode: only the choices a new user makes (embedding, chat LLM, admin auth); every other setting
 * is kept as it is. --advanced asks everything.
 */
async function promptConfig(rawConfig: RawConfig, advanced: boolean): Promise<PromptedConfig> {
  return advanced ? promptAdvancedConfig(rawConfig) : promptMainChoices(rawConfig);
}

async function promptMainChoices(rawConfig: RawConfig): Promise<PromptedConfig> {
  const rl = createInterface({ input, output });

  try {
    console.log("Press Enter to keep the current value.\n");
    let chatApiKeyAction: ApiKeyAction = { kind: "keep" };
    let embeddingApiKeyAction: ApiKeyAction = { kind: "keep" };
    const embedding = await promptEmbedding(rl, rawConfig.embedding, (action) => {
      embeddingApiKeyAction = action;
    });
    const chat = await promptChat(rl, rawConfig.chat, (action) => {
      chatApiKeyAction = action;
    });
    console.log("");
    const adminAuthResult = await promptAdminAuth(rl, rawConfig.adminAuth);
    console.log("\nOther settings (port, Chroma URL, source folder, chunking, limits, rate limiting...) were kept.");
    console.log("Run npm run onboard -- --advanced to change them.");

    return {
      rawConfig: { ...rawConfig, embedding, chat, adminAuth: adminAuthResult.adminAuth },
      adminSessionSecretValue: adminAuthResult.adminSessionSecretValue,
      chatApiKeyAction,
      embeddingApiKeyAction,
    };
  } finally {
    rl.close();
  }
}

async function promptAdvancedConfig(rawConfig: RawConfig): Promise<PromptedConfig> {
  const rl = createInterface({ input, output });

  try {
    console.log("Press Enter to keep the current value.\n");

    const adminAuthResult = await promptAdminAuth(rl, rawConfig.adminAuth);
    let chatApiKeyAction: ApiKeyAction = { kind: "keep" };
    let embeddingApiKeyAction: ApiKeyAction = { kind: "keep" };

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
        embedding: await promptEmbedding(rl, rawConfig.embedding, (action) => {
          embeddingApiKeyAction = action;
        }),
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
        sampleCollection: rawConfig.sampleCollection,
        uploads: rawConfig.uploads,
      },
      adminSessionSecretValue: adminAuthResult.adminSessionSecretValue,
      chatApiKeyAction,
      embeddingApiKeyAction,
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
  // The config file is optional (defaults apply); back it up only when there is one.
  const exists = await fs.access(configPath).then(() => true).catch(() => false);
  if (exists) {
    await fs.copyFile(configPath, `${configPath}.bak`);
  } else {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  }
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
  const embedding = runtimeConfig.embedding;
  console.log(embedding.provider === "builtin"
    ? `- embedding (new collections): builtin / ${embedding.model}`
    : `- embedding (new collections): openai-compatible / ${embedding.model} @ ${embedding.baseUrl}, api key: ${embedding.apiKeySource === "none" ? "not set" : embedding.apiKeySource}`);
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

  issues.push(...await runEmbeddingChecks(runtimeConfig));
  issues.push(...await runChatChecks(runtimeConfig));
  return issues;
}

/**
 * Checks the default embedding for new collections without downloading anything for builtin. For an
 * openai-compatible service: the free model listing, then one real embedding of a short text.
 */
async function runEmbeddingChecks(runtimeConfig: ResolvedConfig): Promise<SetupIssue[]> {
  const embedding = runtimeConfig.embedding;
  const target = { provider: embedding.provider, model: embedding.model };
  const status = await checkEmbeddingTarget(runtimeConfig, target, { useCache: false });

  if (embedding.provider === "builtin") {
    if (!status.supported) {
      console.log(`- Embedding: fail - ${status.error ?? "unsupported built-in model"}`);
      return [{ problem: `${embedding.model} is not a supported built-in model.`, fix: "Rerun onboarding and pick a built-in model from the list." }];
    }
    console.log(status.downloaded
      ? `- Embedding: builtin / ${embedding.model} (downloaded)`
      : `- Embedding: builtin / ${embedding.model} (downloads on first indexing, ~${status.approxDownloadMb ?? "?"} MB)`);
    return [];
  }

  if (!status.reachable) {
    console.log(`- Embedding service: fail - ${status.error ?? "not reachable"}`);
    return [{
      problem: `The embedding service at ${embedding.baseUrl} is not reachable.`,
      fix: "Start it, or rerun onboarding with the right embedding.baseUrl (an OpenAI-compatible URL such as http://localhost:11434/v1).",
    }];
  }
  if (!status.authOk) {
    console.log("- Embedding service: fail - the API key was rejected");
    return [{ problem: `The embedding service at ${embedding.baseUrl} rejected the API key.`, fix: "Rerun onboarding with the right key, or set RAG_EMBEDDING_API_KEY." }];
  }
  if (status.modelListed === false) {
    const suggestions = (status.availableModels ?? []).slice(0, 10).join(", ");
    console.log(`- Embedding model: missing (${embedding.model})`);
    return [{
      problem: `Embedding model ${embedding.model} is not offered by ${embedding.baseUrl}.`,
      fix: suggestions ? `Rerun onboarding and pick one of: ${suggestions}` : `For a local Ollama run: ollama pull ${embedding.model}`,
    }];
  }

  const smoke = await checkEmbeddingHealth(runtimeConfig, target);
  console.log(`- Embedding smoke: ${smoke.ok ? "ok" : "fail"}${smoke.error ? ` - ${smoke.error}` : ""}`);
  return smoke.ok
    ? []
    : [{ problem: `Embedding model ${embedding.model} did not return a usable vector.`, fix: "Check the embedding service logs, or rerun onboarding with another model." }];
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
    ? { rawConfig, adminSessionSecretValue: undefined, chatApiKeyAction: { kind: "keep" }, embeddingApiKeyAction: { kind: "keep" } }
    : await promptConfig(rawConfig, options.advanced);
  const keyAction = nextConfig.chatApiKeyAction;
  const embeddingKeyAction = nextConfig.embeddingApiKeyAction;
  const runtimeConfig = resolveConfig(parseConfig(nextConfig.rawConfig, options.configPath), options.configPath, process.cwd(), {
    // Checks below use the keys just entered, even before (or without) writing the secret files.
    chatApiKeyOverride: apiKeyOverride(keyAction),
    embeddingApiKeyOverride: apiKeyOverride(embeddingKeyAction),
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
    if (embeddingKeyAction.kind === "set") {
      await writeSecretFile(defaultEmbeddingApiKeyFilePath, embeddingKeyAction.value);
      console.log(`Embedding API key written to ${defaultEmbeddingApiKeyFilePath} (gitignored; never stored in the YAML).`);
    } else if (embeddingKeyAction.kind === "remove") {
      await removeSecretFile(defaultEmbeddingApiKeyFilePath);
      console.log(`Embedding API key removed from ${defaultEmbeddingApiKeyFilePath}.`);
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

// Run only as a script (npm run onboard), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
