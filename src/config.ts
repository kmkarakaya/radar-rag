import path from "node:path";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const defaultConfigPath = path.resolve(process.cwd(), "config/rag.config.yaml");

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
    chatModel: z.string().trim().min(1),
    embeddingModel: z.string().trim().min(1),
    numCtx: z.number().int().positive(),
    numPredict: z.number().int().positive(),
  }).strict(),
  collectionDefaults: z.object({
    sourcePath: z.string().trim().min(1),
    ozelgeDataPath: z.string().trim().min(1),
    distanceMetric: distanceMetricSchema,
    indexSampleSize: z.number().int().nonnegative(),
    chunkSize: z.number().int().positive(),
    chunkOverlap: z.number().int().nonnegative(),
    retrievalK: z.number().int().positive(),
    retrievalDistanceThreshold: z.number().nonnegative(),
    timeoutMs: z.number().int().positive(),
  }).strict(),
  readiness: z.object({
    timeoutMs: z.number().int().positive(),
    embeddingProbeText: z.string().trim().min(1),
    chatProbeText: z.string().trim().min(1),
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

export function parseConfig(rawConfig: unknown, configPath = defaultConfigPath): RawConfig {
  const parsedConfig = configSchema.safeParse(rawConfig);

  if (!parsedConfig.success) {
    throw new Error(
      `Invalid config file at ${configPath}:\n${parsedConfig.error.issues
        .map((issue) => `- ${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  return parsedConfig.data;
}

export function resolveConfig(
  rawConfig: RawConfig,
  configPath = defaultConfigPath,
  cwd = process.cwd(),
) {
  const collectionDefaults = {
    sourcePath: path.resolve(cwd, rawConfig.collectionDefaults.sourcePath),
    ozelgeDataPath: path.resolve(cwd, rawConfig.collectionDefaults.ozelgeDataPath),
    distanceMetric: rawConfig.collectionDefaults.distanceMetric,
    indexSampleSize: rawConfig.collectionDefaults.indexSampleSize,
    chunkSize: rawConfig.collectionDefaults.chunkSize,
    chunkOverlap: rawConfig.collectionDefaults.chunkOverlap,
    retrievalK: rawConfig.collectionDefaults.retrievalK,
    retrievalDistanceThreshold: rawConfig.collectionDefaults.retrievalDistanceThreshold,
    timeoutMs: rawConfig.collectionDefaults.timeoutMs,
  };

  return {
    configPath,
    port: rawConfig.server.port,
    registryPath: path.resolve(cwd, rawConfig.registry.path),
    chromaUrl: rawConfig.chroma.url,
    ollamaBaseUrl: rawConfig.ollama.baseUrl,
    ollamaChatModel: rawConfig.ollama.chatModel,
    ollamaEmbeddingModel: rawConfig.ollama.embeddingModel,
    ollamaNumCtx: rawConfig.ollama.numCtx,
    ollamaNumPredict: rawConfig.ollama.numPredict,
    collectionDefaults,
    sourcePath: collectionDefaults.sourcePath,
    ozelgeDataPath: collectionDefaults.ozelgeDataPath,
    indexSampleSize: collectionDefaults.indexSampleSize,
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

export function loadConfig(configPath = defaultConfigPath): ResolvedConfig {
  return resolveConfig(parseConfig(readConfigFile(configPath), configPath), path.resolve(configPath));
}

export async function writeConfigFile(
  rawConfig: RawConfig,
  configPath = defaultConfigPath,
): Promise<void> {
  await writeFile(configPath, stringify(rawConfig), "utf8");
}

export const config = loadConfig();
