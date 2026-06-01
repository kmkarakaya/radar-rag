import { ChromaClient } from "chromadb";
import type { ResolvedConfig } from "../config.js";
import { RagQueryError } from "../rag.js";
import { assertValidChromaCollectionName } from "./ids.js";

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

export async function createPhysicalChromaCollection(input: {
  name: string;
  distanceMetric: "l2" | "cosine" | "ip";
  chromaConfiguration?: Record<string, unknown>;
  runtimeConfig: ResolvedConfig;
}): Promise<void> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));

  const chromaConfiguration = input.chromaConfiguration ?? {
    hnsw: {
      space: input.distanceMetric,
    },
  };

  const req = buildCreateCollectionRequest({ name: input.name, chromaConfiguration });

  await client.createCollection(req);
}

export async function assertChromaCollectionReadable(input: {
  name: string;
  runtimeConfig: ResolvedConfig;
}): Promise<{ count: number }> {
  const client = new ChromaClient(chromaClientParams(input.runtimeConfig));

  try {
    const collection = await client.getCollection({ name: input.name });
    const count = await collection.count();
    return { count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404|could not be found/i.test(message)) {
      throw new RagQueryError("COLLECTION_NOT_FOUND", `Chroma collection not found: ${input.name}`, 404);
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

export async function listPhysicalChromaCollections(runtimeConfig: ResolvedConfig): Promise<{ name: string }[]> {
  const client = new ChromaClient(chromaClientParams(runtimeConfig));
  const collections = await client.listCollections();

  // Depending on chroma client version, listCollections might return an array of strings or objects
  if (collections.length > 0 && typeof collections[0] === "string") {
    return (collections as unknown as string[]).map((name) => ({ name }));
  }

  return (collections as unknown as Array<{ name: string }>).map((c) => ({ name: c.name }));
}
