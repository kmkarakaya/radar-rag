import path from "node:path";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const defaultConfigPath = path.resolve(process.cwd(), "config/rag.config.yaml");

export const configSchema = z.object({
  server: z.object({
    port: z.number().int().positive(),
  }),
  chroma: z.object({
    url: z.string().url(),
    collection: z.string().trim().min(1),
    distanceMetric: z.enum(["l2", "cosine", "ip"]),
  }),
  ollama: z.object({
    baseUrl: z.string().url(),
    chatModel: z.string().trim().min(1),
    embeddingModel: z.string().trim().min(1),
    numCtx: z.number().int().positive(),
    numPredict: z.number().int().positive(),
  }),
  data: z.object({
    sourcePath: z.string().trim().min(1),
    ozelgeDataPath: z.string().trim().min(1),
    indexSampleSize: z.number().int().nonnegative(),
  }),
  rag: z.object({
    chunkSize: z.number().int().positive(),
    chunkOverlap: z.number().int().nonnegative(),
    retrievalK: z.number().int().positive(),
    retrievalDistanceThreshold: z.number().nonnegative(),
    timeoutMs: z.number().int().positive(),
  }),
  readiness: z.object({
    timeoutMs: z.number().int().positive(),
    embeddingProbeText: z.string().trim().min(1),
    chatProbeText: z.string().trim().min(1),
  }),
}).superRefine((value, ctx) => {
  if (value.rag.chunkOverlap >= value.rag.chunkSize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rag", "chunkOverlap"],
      message: "chunkOverlap must be smaller than chunkSize",
    });
  }
});

export type RawConfig = z.infer<typeof configSchema>;

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
  return {
  configPath,
  port: rawConfig.server.port,
  chromaUrl: rawConfig.chroma.url,
  chromaCollection: rawConfig.chroma.collection,
  chromaDistanceMetric: rawConfig.chroma.distanceMetric,
  ollamaBaseUrl: rawConfig.ollama.baseUrl,
  ollamaChatModel: rawConfig.ollama.chatModel,
  ollamaEmbeddingModel: rawConfig.ollama.embeddingModel,
  ozelgeDataPath: path.resolve(
    cwd,
    rawConfig.data.ozelgeDataPath,
  ),
  sourcePath: path.resolve(
    cwd,
    rawConfig.data.sourcePath,
  ),
  indexSampleSize: rawConfig.data.indexSampleSize,
  chunkSize: rawConfig.rag.chunkSize,
  chunkOverlap: rawConfig.rag.chunkOverlap,
  retrievalK: rawConfig.rag.retrievalK,
  retrievalDistanceThreshold: rawConfig.rag.retrievalDistanceThreshold,
  ollamaNumCtx: rawConfig.ollama.numCtx,
  ollamaNumPredict: rawConfig.ollama.numPredict,
  readyTimeoutMs: rawConfig.readiness.timeoutMs,
  readyEmbedProbeText: rawConfig.readiness.embeddingProbeText,
  readyChatProbeText: rawConfig.readiness.chatProbeText,
  ragTimeoutMs: rawConfig.rag.timeoutMs,
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
