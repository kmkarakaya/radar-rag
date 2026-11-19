import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { z } from "zod";
import {
  BUILTIN_EMBEDDING_MODELS,
  DEFAULT_BUILTIN_EMBEDDING_MODEL,
  EMBEDDING_PROVIDERS,
  type EmbeddingProvider,
} from "./embeddings/models.js";
import { defaultChatApiKeyFilePath, defaultEmbeddingApiKeyFilePath, readSecretFile } from "./secrets.js";

export const defaultConfigPath = path.resolve(process.cwd(), process.env.RAG_CONFIG_PATH?.trim() || "config/rag.config.yaml");

const distanceMetricSchema = z.enum(["l2", "cosine", "ip"]);
const adminRoleSchema = z.enum(["viewer", "operator", "admin"]);
const adminAuthUserSchema = z.object({
  username: z.string().trim().min(1),
  passwordHash: z.string().trim().min(1),
  role: adminRoleSchema,
  tenantId: z.string().trim().min(1),
}).strict();

const defaultAdminAuthConfig = {
  enabled: false,
  cookieName: "rag_admin_session",
  sessionTtlMs: 8 * 60 * 60 * 1000,
  actionTokenTtlMs: 5 * 60 * 1000,
  sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
  users: [],
};

const adminAuthSchema = z.object({
  enabled: z.boolean().default(defaultAdminAuthConfig.enabled),
  cookieName: z.string().trim().min(1).default(defaultAdminAuthConfig.cookieName),
  sessionTtlMs: z.number().int().positive().default(defaultAdminAuthConfig.sessionTtlMs),
  actionTokenTtlMs: z.number().int().positive().default(defaultAdminAuthConfig.actionTokenTtlMs),
  sessionSecretEnvVar: z.string().trim().min(1).default(defaultAdminAuthConfig.sessionSecretEnvVar),
  users: z.array(adminAuthUserSchema).default(defaultAdminAuthConfig.users),
}).strict();

/**
 * Optional chat LLM used only by /query (answer generation), reached through any OpenAI-compatible
 * chat completions endpoint. Empty baseUrl or model means /query is disabled (retrieve-only).
 * Model parameters are not sent unless set here, so the provider/model defaults apply.
 * The API key is never stored here; see resolveChatConfig.
 */
const chatSchema = z.object({
  baseUrl: z.string().trim().default("").refine(isEmptyOrUrl, {
    message: "must be empty (retrieve-only) or a valid URL",
  }),
  model: z.string().trim().default(""),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
}).strict();

function isEmptyOrUrl(value: string): boolean {
  return value === "" || z.string().url().safeParse(value).success;
}

/**
 * Embedding provider and model used as the default for NEW collections. Each collection stores its own
 * provider and model; changing this never touches existing collections.
 * - builtin: in-process model, downloaded on first use into cacheDir.
 * - openai-compatible: any OpenAI-compatible /v1/embeddings API at baseUrl (API key from env or .local).
 */
const embeddingSchema = z.object({
  provider: z.enum(EMBEDDING_PROVIDERS).default("builtin"),
  model: z.string().trim().min(1).default(DEFAULT_BUILTIN_EMBEDDING_MODEL),
  baseUrl: z.string().trim().default("").refine(isEmptyOrUrl, {
    message: "must be empty or a valid URL (an OpenAI-compatible API such as http://localhost:11434/v1)",
  }),
  cacheDir: z.string().trim().min(1).default("models"),
}).strict().superRefine((value, ctx) => {
  if (value.provider === "openai-compatible" && value.baseUrl === "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: "is required when provider is openai-compatible",
    });
  }
  if (value.provider === "builtin" && !BUILTIN_EMBEDDING_MODELS[value.model]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["model"],
      message: `is not a built-in model; supported: ${Object.keys(BUILTIN_EMBEDDING_MODELS).join(", ")}`,
    });
  }
});

/**
 * Every setting has a default, so the config file is optional: a missing file (for example the prebuilt
 * Docker image without a mounted config) runs with these values. The shipped YAML repeats them.
 */
export const configSchema = z.object({
  server: z.object({
    port: z.number().int().positive().default(3010),
  }).strict().default({}),
  registry: z.object({
    path: z.string().trim().min(1).default("data/registry.sqlite"),
  }).strict().default({}),
  chroma: z.object({
    url: z.string().url().default("http://localhost:8000"),
  }).strict().default({}),
  embedding: embeddingSchema.default({}),
  chat: chatSchema.optional(),
  collectionDefaults: z.object({
    sourcePath: z.string().trim().min(1).default("data"),
    distanceMetric: distanceMetricSchema.default("l2"),
    chunkSize: z.number().int().positive().default(500),
    chunkOverlap: z.number().int().nonnegative().default(200),
    retrievalK: z.number().int().positive().default(5),
    retrievalDistanceThreshold: z.number().nonnegative().default(1.2),
    timeoutMs: z.number().int().positive().default(180000),
  }).strict().default({}),
  readiness: z.object({
    timeoutMs: z.number().int().positive().default(30000),
    embeddingProbeText: z.string().trim().min(1).default("Hello"),
    chatProbeText: z.string().trim().min(1).default("Reply with one short sentence."),
  }).strict().default({}),
  cleanup: z.object({
    retentionMs: z.number().int().nonnegative().default(3600000),
  }).strict().optional(),
  limits: z.object({
    maxConcurrentEmbeddings: z.number().int().positive().default(5),
    maxConcurrentGenerations: z.number().int().positive().default(2),
  }).strict().optional(),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().int().positive().default(60000),
    maxRequestsPerWindow: z.number().int().positive().default(60),
  }).strict().optional(),
  adminAuth: adminAuthSchema.default(defaultAdminAuthConfig),
  observability: z.object({
    includeDebugTimings: z.boolean().default(false),
  }).strict().optional(),
  /** On the very first start (no collection ever created), create and index a sample collection. */
  sampleCollection: z.object({
    enabled: z.boolean().default(true),
  }).strict().default({}),
  /** Documents uploaded through the files API (stored in data/collections/<collection id>). */
  uploads: z.object({
    maxFileSizeMb: z.number().positive().max(1024).default(50),
  }).strict().default({}),
}).strict().superRefine((value, ctx) => {
  if (value.collectionDefaults.chunkOverlap >= value.collectionDefaults.chunkSize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["collectionDefaults", "chunkOverlap"],
      message: "chunkOverlap must be smaller than chunkSize",
    });
  }
});

export type RawConfig = z.infer<typeof configSchema>;
export type DistanceMetric = z.infer<typeof distanceMetricSchema>;

/** Reads the YAML config. A missing file means "use the defaults" ({}); other read errors still throw. */
export function readConfigFile(configPath = defaultConfigPath): unknown {
  if (!existsSync(configPath)) return {};
  try {
    return parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file at ${configPath}: ${message}`);
  }
}

/** Keys removed with ozelge JSON support. Older config files may still contain them; drop instead of rejecting. */
const LEGACY_COLLECTION_DEFAULT_KEYS = ["ozelgeDataPath", "indexSampleSize"] as const;
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function dropLegacyConfigKeys(rawConfig: unknown): unknown {
  const root = asRecord(rawConfig);
  if (!root) return rawConfig;
  const result = { ...root };

  const defaults = asRecord(root.collectionDefaults);
  if (defaults) {
    const cleanedDefaults = { ...defaults };
    for (const key of LEGACY_COLLECTION_DEFAULT_KEYS) delete cleanedDefaults[key];
    result.collectionDefaults = cleanedDefaults;
  }

  return result;
}

export function parseConfig(rawConfig: unknown, configPath = defaultConfigPath): RawConfig {
  const parsedConfig = configSchema.safeParse(dropLegacyConfigKeys(rawConfig));

  if (!parsedConfig.success) {
    throw new Error(
      `Invalid config file at ${configPath}:\n${parsedConfig.error.issues
        .map((issue) => `- ${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  return parsedConfig.data;
}

export type ApiKeySource = "env" | "file" | "none";
/** @deprecated kept as an alias; use ApiKeySource. */
export type ChatApiKeySource = ApiKeySource;

export interface ResolveConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Where onboarding stores the chat API key; relative to cwd. */
  chatApiKeyFilePath?: string;
  /** Where onboarding stores the embedding API key; relative to cwd. */
  embeddingApiKeyFilePath?: string;
  /**
   * Onboarding only: the API key the user just entered (string) or removed (null), used before the
   * secret file is written. Overrides the env var and the file.
   */
  chatApiKeyOverride?: string | null;
  embeddingApiKeyOverride?: string | null;
}

/**
 * Resolves an API key: an onboarding override first, then the env var, then the local secret file.
 * Keys are never read from or written to the YAML config.
 */
function resolveApiKey(input: {
  override: string | null | undefined;
  env: NodeJS.ProcessEnv;
  envVar: string;
  filePath: string;
  label: string;
  cwd: string;
}): { apiKey: string | undefined; apiKeySource: ApiKeySource } {
  if (input.override !== undefined) {
    const apiKey = input.override?.trim() || undefined;
    return { apiKey, apiKeySource: apiKey ? "file" : "none" };
  }

  const envKey = input.env[input.envVar]?.trim() ?? "";
  const fileKey = envKey ? "" : readSecretFile(input.filePath, input.label, input.cwd);
  return {
    apiKey: envKey || fileKey || undefined,
    apiKeySource: envKey ? "env" : fileKey ? "file" : "none",
  };
}

/**
 * Resolves the optional chat LLM. The API key comes from RAG_CHAT_API_KEY, else from the local secret
 * file written by onboarding; it is never read from or written to the YAML config.
 */
function resolveChatConfig(rawChat: RawConfig["chat"], cwd: string, options: ResolveConfigOptions) {
  const baseUrl = (rawChat?.baseUrl ?? "").replace(/\/+$/, "");
  const model = rawChat?.model ?? "";
  const { apiKey, apiKeySource } = resolveApiKey({
    override: options.chatApiKeyOverride,
    env: options.env ?? process.env,
    envVar: "RAG_CHAT_API_KEY",
    filePath: options.chatApiKeyFilePath ?? defaultChatApiKeyFilePath,
    label: "chat API key",
    cwd,
  });

  return {
    enabled: baseUrl !== "" && model !== "",
    baseUrl,
    model,
    apiKey,
    apiKeySource,
    temperature: rawChat?.temperature,
    maxTokens: rawChat?.maxTokens,
    maxContextTokens: rawChat?.maxContextTokens,
  };
}

export type ChatConfig = ReturnType<typeof resolveChatConfig>;

/** Resolves the embedding defaults for new collections and the openai-compatible connection. */
function resolveEmbeddingConfig(rawEmbedding: RawConfig["embedding"], cwd: string, options: ResolveConfigOptions) {
  const baseUrl = rawEmbedding.baseUrl.replace(/\/+$/, "");
  const { apiKey, apiKeySource } = resolveApiKey({
    override: options.embeddingApiKeyOverride,
    env: options.env ?? process.env,
    envVar: "RAG_EMBEDDING_API_KEY",
    filePath: options.embeddingApiKeyFilePath ?? defaultEmbeddingApiKeyFilePath,
    label: "embedding API key",
    cwd,
  });

  return {
    /** Default provider for NEW collections. */
    provider: rawEmbedding.provider as EmbeddingProvider,
    /** Default model for NEW collections. */
    model: rawEmbedding.model,
    /** The openai-compatible API, shared by every collection that uses that provider. Empty = not configured. */
    baseUrl,
    apiKey,
    apiKeySource,
    /** Where built-in models are downloaded and cached. */
    cacheDir: path.resolve(cwd, rawEmbedding.cacheDir),
  };
}

export type EmbeddingConfig = ReturnType<typeof resolveEmbeddingConfig>;

export function resolveConfig(
  rawConfig: RawConfig,
  configPath = defaultConfigPath,
  cwd = process.cwd(),
  options: ResolveConfigOptions = {},
) {
  const collectionDefaults = {
    sourcePath: path.resolve(cwd, rawConfig.collectionDefaults.sourcePath),
    distanceMetric: rawConfig.collectionDefaults.distanceMetric,
    chunkSize: rawConfig.collectionDefaults.chunkSize,
    chunkOverlap: rawConfig.collectionDefaults.chunkOverlap,
    retrievalK: rawConfig.collectionDefaults.retrievalK,
    retrievalDistanceThreshold: rawConfig.collectionDefaults.retrievalDistanceThreshold,
    timeoutMs: rawConfig.collectionDefaults.timeoutMs,
  };

  return {
    configPath,
    /** Folder that relative paths resolve against and that stored paths are made relative to. */
    projectRoot: cwd,
    port: rawConfig.server.port,
    registryPath: path.resolve(cwd, rawConfig.registry.path),
    chromaUrl: rawConfig.chroma.url,
    embedding: resolveEmbeddingConfig(rawConfig.embedding, cwd, options),
    chat: resolveChatConfig(rawConfig.chat, cwd, options),
    collectionDefaults,
    sourcePath: collectionDefaults.sourcePath,
    chunkSize: collectionDefaults.chunkSize,
    chunkOverlap: collectionDefaults.chunkOverlap,
    retrievalK: collectionDefaults.retrievalK,
    retrievalDistanceThreshold: collectionDefaults.retrievalDistanceThreshold,
    chromaDistanceMetric: collectionDefaults.distanceMetric,
    readyTimeoutMs: rawConfig.readiness.timeoutMs,
    readyEmbedProbeText: rawConfig.readiness.embeddingProbeText,
    readyChatProbeText: rawConfig.readiness.chatProbeText,
    ragTimeoutMs: collectionDefaults.timeoutMs,
    cleanupRetentionMs: rawConfig.cleanup?.retentionMs ?? 3600000,
    maxConcurrentEmbeddings: rawConfig.limits?.maxConcurrentEmbeddings ?? 5,
    maxConcurrentGenerations: rawConfig.limits?.maxConcurrentGenerations ?? 2,
    rateLimitEnabled: rawConfig.rateLimit?.enabled ?? true,
    rateLimitWindowMs: rawConfig.rateLimit?.windowMs ?? 60000,
    rateLimitMaxRequestsPerWindow: rawConfig.rateLimit?.maxRequestsPerWindow ?? 60,
    adminAuth: rawConfig.adminAuth ?? defaultAdminAuthConfig,
    includeDebugTimings: rawConfig.observability?.includeDebugTimings ?? false,
    sampleCollectionEnabled: rawConfig.sampleCollection.enabled,
    /** Uploads collections live in `<uploadsDir>/<collection id>`; folder collections never scan it. */
    uploadsDir: path.resolve(cwd, UPLOADS_DIR),
    uploadMaxFileSizeBytes: Math.round(rawConfig.uploads.maxFileSizeMb * 1024 * 1024),
  };
}

export type ResolvedConfig = ReturnType<typeof resolveConfig>;

/** Root folder for uploaded documents, relative to the project root (inside the Docker data mount). */
export const UPLOADS_DIR = "data/collections";

/**
 * Environment variables that override config file values at runtime (Docker, CI, other machines).
 * They are applied only when the server/CLI loads its config, never written back by onboarding.
 */
export const CONFIG_ENV_OVERRIDES = [
  { env: "RAG_PORT", path: ["server", "port"], type: "integer" },
  { env: "RAG_REGISTRY_PATH", path: ["registry", "path"], type: "string" },
  { env: "RAG_CHROMA_URL", path: ["chroma", "url"], type: "string" },
  { env: "RAG_EMBEDDING_PROVIDER", path: ["embedding", "provider"], type: "string" },
  { env: "RAG_EMBEDDING_MODEL", path: ["embedding", "model"], type: "string" },
  { env: "RAG_EMBEDDING_BASE_URL", path: ["embedding", "baseUrl"], type: "string" },
  { env: "RAG_EMBEDDING_CACHE_DIR", path: ["embedding", "cacheDir"], type: "string" },
  { env: "RAG_CHAT_BASE_URL", path: ["chat", "baseUrl"], type: "string" },
  { env: "RAG_CHAT_MODEL", path: ["chat", "model"], type: "string" },
  { env: "RAG_SOURCE_PATH", path: ["collectionDefaults", "sourcePath"], type: "string" },
  { env: "RAG_SAMPLE_COLLECTION", path: ["sampleCollection", "enabled"], type: "boolean" },
] as const;

export function applyConfigEnvOverrides(rawConfig: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) return rawConfig;
  const result = structuredClone(rawConfig) as Record<string, unknown>;

  for (const override of CONFIG_ENV_OVERRIDES) {
    const rawValue = env[override.env]?.trim();
    if (!rawValue) continue;

    let value: unknown = rawValue;
    if (override.type === "integer") {
      value = Number(rawValue);
      if (!Number.isInteger(value)) {
        throw new Error(`Invalid ${override.env}: expected an integer, got "${rawValue}".`);
      }
    } else if (override.type === "boolean") {
      const normalized = rawValue.toLowerCase();
      if (normalized !== "true" && normalized !== "false") {
        throw new Error(`Invalid ${override.env}: expected true or false, got "${rawValue}".`);
      }
      value = normalized === "true";
    }

    const [section, key] = override.path;
    const current = result[section];
    const sectionValue = current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
    sectionValue[key] = value;
    result[section] = sectionValue;
  }

  return result;
}

export function loadConfig(configPath = defaultConfigPath, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const rawConfig = readConfigFile(configPath);
  return resolveConfig(
    parseConfig(applyConfigEnvOverrides(rawConfig, env), configPath),
    path.resolve(configPath),
    process.cwd(),
    { env },
  );
}

export async function writeConfigFile(
  rawConfig: RawConfig,
  configPath = defaultConfigPath,
): Promise<void> {
  await writeFile(configPath, stringify(rawConfig), "utf8");
}

export const config = loadConfig();
