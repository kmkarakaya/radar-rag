import { ChromaClient } from "chromadb";
import type { ResolvedConfig } from "../config.js";
import { RagQueryError } from "../rag.js";
import { assertValidChromaCollectionName } from "./ids.js";
import { isTimeoutOrAbortError, withTimeoutAndAbort } from "../observability/timeout.js";

function chromaClientParams(runtimeConfig: ResolvedConfig) {
  const url = new URL(runtimeConfig.chromaUrl);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10),
    ssl: url.protocol === "https:",
  };
}

export function buildCreateCollectionRequest(input: {
  name: string;
  chromaConfiguration: Record<string, unknown>;
}) {
  assertValidChromaCollectionName(input.name);

  return {
    name: input.name,
    embeddingFunction: null as any,
    configuration: input.chromaConfiguration,
  };
}

export function normalizeChromaCollectionConfiguration(input: {
  distanceMetric: "l2" | "cosine" | "ip";
  chromaConfiguration?: Record<string, unknown>;
}): Record<string, unknown> {
  const normalized = isRecord(input.chromaConfiguration) ? { ...input.chromaConfiguration } : {};
  const existingHnsw = isRecord(normalized.hnsw) ? normalized.hnsw : {};

  return {
    ...normalized,
    hnsw: {
      ...existingHnsw,
      space: input.distanceMetric,
    },
  };
}

export async function createPhysicalChromaCollection(input: {
  name: string;
  distanceMetric: "l2" | "cosine" | "ip";
  chromaConfiguration?: Record<string, unknown>;
  runtimeConfig: ResolvedConfig;
}): Promise<void> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));

  const chromaConfiguration = normalizeChromaCollectionConfiguration({
    distanceMetric: input.distanceMetric,
    chromaConfiguration: input.chromaConfiguration,
  });

  const req = buildCreateCollectionRequest({ name: input.name, chromaConfiguration });

  await client.createCollection(req);
}

export async function assertChromaCollectionReadable(input: {
  name: string;
  runtimeConfig: ResolvedConfig;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}): Promise<{ count: number }> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));
  const timeoutMs = input.timeoutMs ?? input.runtimeConfig.readyTimeoutMs;

  try {
    const collection = await withTimeoutAndAbort({
      promise: client.getCollection({ name: input.name }),
      timeoutMs,
      label: `Chroma getCollection ${input.name}`,
      abortSignal: input.abortSignal,
    });
    const count = await withTimeoutAndAbort({
      promise: collection.count(),
      timeoutMs,
      label: `Chroma count ${input.name}`,
      abortSignal: input.abortSignal,
    });
    return { count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404|could not be found/i.test(message)) {
      throw new RagQueryError("COLLECTION_NOT_FOUND", `Chroma collection not found: ${input.name}`, 404);
    }
    if (isTimeoutOrAbortError(error)) {
      throw new RagQueryError(
        "COLLECTION_STORAGE_INCONSISTENT",
        `Chroma collection readability check timed out or was aborted for ${input.name}.`,
        503,
        { physicalCollection: input.name },
      );
    }
    throw error;
  }
}

export async function deletePhysicalChromaCollection(input: {
  name: string;
  runtimeConfig: ResolvedConfig;
}): Promise<void> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));

  try {
    await client.deleteCollection({ name: input.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|does not exist|404|could not be found/i.test(message)) {
      throw error;
    }
  }
}

/**
 * Removes every chunk of one source file from a physical collection (chunks carry the file's absolute
 * path in metadata.sourcePath). Returns how many chunks and loaded documents were removed.
 */
export async function deleteSourceChunks(input: {
  name: string;
  sourcePath: string;
  runtimeConfig: ResolvedConfig;
}): Promise<{ chunkCount: number; documentCount: number }> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));
  const timeoutMs = input.runtimeConfig.readyTimeoutMs;
  const collection = await withTimeoutAndAbort({
    promise: client.getCollection({ name: input.name }),
    timeoutMs,
    label: `Chroma getCollection ${input.name}`,
  });
  const existing = await withTimeoutAndAbort({
    promise: collection.get({ where: { sourcePath: input.sourcePath }, include: ["metadatas" as any] }),
    timeoutMs,
    label: `Chroma get chunks of ${input.sourcePath}`,
  });
  if (existing.ids.length === 0) return { chunkCount: 0, documentCount: 0 };

  const documentIds = new Set(
    (existing.metadatas ?? [])
      .map((metadata) => (metadata as Record<string, unknown> | null)?.documentId)
      .filter((documentId): documentId is string => typeof documentId === "string"),
  );
  await withTimeoutAndAbort({
    promise: collection.delete({ ids: existing.ids }),
    timeoutMs,
    label: `Chroma delete chunks of ${input.sourcePath}`,
  });
  return { chunkCount: existing.ids.length, documentCount: documentIds.size };
}

export async function listPhysicalChromaCollections(runtimeConfig: ResolvedConfig): Promise<{ name: string }[]> {
  const client = new ChromaClient(chromaClientParams(runtimeConfig));
  const collections = await client.listCollections();

  // Depending on chroma client version, listCollections might return an array of strings or objects
  if (collections.length > 0 && typeof collections[0] === "string") {
    return (collections as unknown as string[]).map((name) => ({ name }));
  }

  return (collections as unknown as Array<{ name: string }>).map((c) => ({ name: c.name }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
