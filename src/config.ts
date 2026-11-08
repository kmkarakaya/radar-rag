import path from "node:path";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { defaultChatApiKeyFilePath, readSecretFile } from "./secrets.js";

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
  baseUrl: z.string().trim().default("").refine(
    (value) => value === "" || z.string().url().safeParse(value).success,
    { message: "must be empty (retrieve-only) or a valid URL" },
  ),
  model: z.string().trim().default(""),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
}).strict();

export const configSchema = z.object({
  server: z.object({
    port: z.number().int().positive(),
  }).strict(),
  registry: z.object({
    path: z.string().trim().min(1),
  }).strict(),
  chroma: z.object({
    url: z.string().url(),
  }).strict(),
  ollama: z.object({
    baseUrl: z.string().url(),
    embeddingModel: z.string().trim().min(1),
  }).strict(),
  chat: chatSchema.optional(),
  collectionDefaults: z.object({
    sourcePath: z.string().trim().min(1),
    distanceMetric: distanceMetricSchema,
    chunkSize: z.number().int().positive(),
    chunkOverlap: z.number().int().nonnegative(),
    retrievalK: z.number().int().positive(),
    retrievalDistanceThreshold: z.number().nonnegative(),
    timeoutMs: z.number().int().positive(),
  }).strict(),
  readiness: z.object({
    timeoutMs: z.number().int().positive(),
    embeddingProbeText: z.string().trim().min(1),
    chatProbeText: z.string().trim().min(1).default("Reply with one short sentence."),
  }).strict(),
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

export function readConfigFile(configPath = defaultConfigPath): unknown {
  try {
    return parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file at ${configPath}: ${message}`);
  }
}

/** Keys removed with ozelge JSON support. Older config files may still contain them; drop instead of rejecting. */
const LEGACY_COLLECTION_DEFAULT_KEYS = ["ozelgeDataPath", "indexSampleSize"] as const;
/**
 * Ollama chat keys replaced by the optional `chat` section. They are dropped, not migrated:
 * answer generation stays off until the user configures `chat` (onboarding or RAG_CHAT_*).
 */
const LEGACY_OLLAMA_KEYS = ["chatModel", "numCtx", "numPredict"] as const;

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

  const ollama = asRecord(root.ollama);
  if (ollama) {
    const cleanedOllama = { ...ollama };
    for (const key of LEGACY_OLLAMA_KEYS) delete cleanedOllama[key];
    result.ollama = cleanedOllama;
  }

  return result;
}

/** Human-readable notes about ignored legacy settings, printed once at startup. */
export function legacyConfigWarnings(rawConfig: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  const ollama = asRecord(asRecord(rawConfig)?.ollama);

  if (ollama && LEGACY_OLLAMA_KEYS.some((key) => key in ollama)) {
    warnings.push(
      "ollama.chatModel, ollama.numCtx and ollama.numPredict are no longer used; answer generation moved to the optional `chat` section. "
        + "To enable /query, run `npm run onboard` or set RAG_CHAT_BASE_URL and RAG_CHAT_MODEL.",
    );
  }
  if (env.RAG_OLLAMA_CHAT_MODEL?.trim()) {
    warnings.push("RAG_OLLAMA_CHAT_MODEL is no longer used; set RAG_CHAT_BASE_URL and RAG_CHAT_MODEL instead.");
  }

  return warnings;
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

export type ChatApiKeySource = "env" | "file" | "none";

export interface ResolveConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Where onboarding stores the chat API key; relative to cwd. */
  chatApiKeyFilePath?: string;
  /** Notes about ignored legacy settings (see legacyConfigWarnings). */
  warnings?: string[];
  /**
   * Onboarding only: the API key the user just entered (string) or removed (null), used before the
   * secret file is written. Overrides the env var and the file.
   */
  chatApiKeyOverride?: string | null;
}

/**
 * Resolves the optional chat LLM. The API key comes from RAG_CHAT_API_KEY, else from the local secret
 * file written by onboarding; it is never read from or written to the YAML config.
 */
function resolveChatConfig(rawChat: RawConfig["chat"], cwd: string, options: ResolveConfigOptions) {
  const baseUrl = (rawChat?.baseUrl ?? "").replace(/\/+$/, "");
  const model = rawChat?.model ?? "";
  if (options.chatApiKeyOverride !== undefined) {
    const apiKey = options.chatApiKeyOverride?.trim() || undefined;
    return {
      enabled: baseUrl !== "" && model !== "",
      baseUrl,
      model,
      apiKey,
      apiKeySource: (apiKey ? "file" : "none") as ChatApiKeySource,
      temperature: rawChat?.temperature,
      maxTokens: rawChat?.maxTokens,
      maxContextTokens: rawChat?.maxContextTokens,
    };
  }

  const env = options.env ?? process.env;
  const envKey = env.RAG_CHAT_API_KEY?.trim() ?? "";
  const fileKey = envKey ? "" : readSecretFile(options.chatApiKeyFilePath ?? defaultChatApiKeyFilePath, "chat API key", cwd);
  const apiKey = envKey || fileKey || undefined;
  const apiKeySource: ChatApiKeySource = envKey ? "env" : fileKey ? "file" : "none";

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
    ollamaBaseUrl: rawConfig.ollama.baseUrl,
    ollamaEmbeddingModel: rawConfig.ollama.embeddingModel,
    chat: resolveChatConfig(rawConfig.chat, cwd, options),
    configWarnings: options.warnings ?? [],
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
  };
}

export type ResolvedConfig = ReturnType<typeof resolveConfig>;

/**
 * Environment variables that override config file values at runtime (Docker, CI, other machines).
 * They are applied only when the server/CLI loads its config, never written back by onboarding.
 */
export const CONFIG_ENV_OVERRIDES = [
  { env: "RAG_PORT", path: ["server", "port"], type: "integer" },
  { env: "RAG_REGISTRY_PATH", path: ["registry", "path"], type: "string" },
  { env: "RAG_CHROMA_URL", path: ["chroma", "url"], type: "string" },
  { env: "RAG_OLLAMA_BASE_URL", path: ["ollama", "baseUrl"], type: "string" },
  { env: "RAG_OLLAMA_EMBEDDING_MODEL", path: ["ollama", "embeddingModel"], type: "string" },
  { env: "RAG_CHAT_BASE_URL", path: ["chat", "baseUrl"], type: "string" },
  { env: "RAG_CHAT_MODEL", path: ["chat", "model"], type: "string" },
  { env: "RAG_SOURCE_PATH", path: ["collectionDefaults", "sourcePath"], type: "string" },
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
    { env, warnings: legacyConfigWarnings(rawConfig, env) },
  );
}

export async function writeConfigFile(
  rawConfig: RawConfig,
  configPath = defaultConfigPath,
): Promise<void> {
  await writeFile(configPath, stringify(rawConfig), "utf8");
}

export const config = loadConfig();
