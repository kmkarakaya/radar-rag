import type { CollectionRegistry, IndexJob, RagCollection, RequestContext } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { hasConfiguredModel, checkChromaHealth, checkOllamaHealth } from "../rag.js";
import { recommendedActionFor, unique } from "../readiness.js";

export type CollectionReadinessIssue = {
  code: string;
  message: string;
  recommendedAction?: string;
};

export type CollectionReadinessPayload = {
  id: string;
  status: RagCollection["status"];
  hasActivePhysicalCollection: boolean;
  activeVersion: string | null;
  activeJob: Pick<IndexJob, "id" | "status"> | null;
  chromaReadable: boolean;
  chromaCount: number;
  modelAvailability: {
    embeddingModel: string;
    embeddingModelAvailable: boolean;
    chatModel: string;
    chatModelAvailable: boolean;
    desiredEmbeddingModel?: string;
  };
  capabilities: {
    query: boolean;
    retrieve: boolean;
    reindex: boolean;
  };
  blockers: CollectionReadinessIssue[];
  warnings: CollectionReadinessIssue[];
  recommendedActions: string[];
};

export type CollectionReadinessHealthChecks = {
  checkChromaHealth?: typeof checkChromaHealth;
  checkOllamaHealth?: typeof checkOllamaHealth;
};

function makeIssue(
  code: string,
  message: string,
  runtimeConfig: ResolvedConfig,
  recommendedActionOverride?: string,
): CollectionReadinessIssue {
  const recommendedAction = recommendedActionOverride ?? recommendedActionFor(code, runtimeConfig);
  return recommendedAction
    ? { code, message, recommendedAction }
    : { code, message };
}

export async function buildCollectionReadinessPayload(
  registry: CollectionRegistry,
  context: RequestContext,
  collection: RagCollection,
  runtimeConfig: ResolvedConfig,
  healthChecks?: CollectionReadinessHealthChecks,
): Promise<CollectionReadinessPayload> {
  const activeJob = await registry.getActiveJobForCollection(context, collection.id);
  const ollama = await (healthChecks?.checkOllamaHealth ?? checkOllamaHealth)(runtimeConfig);
  const availableModels = Array.isArray(ollama.details?.availableModels)
    ? ollama.details.availableModels.filter((value): value is string => typeof value === "string")
    : [];

  const readEmbeddingModel = collection.activeEmbeddingModel ?? collection.embeddingModel;
  const hasActivePhysicalCollection = Boolean(collection.activePhysicalCollection);
  const embeddingModelAvailable = ollama.ok && hasConfiguredModel(availableModels, readEmbeddingModel);
  const chatModelAvailable = ollama.ok && hasConfiguredModel(availableModels, collection.chatModel);

  let chromaCount = -1;
  let chromaReadable = false;

  if (collection.activePhysicalCollection) {
    const health = await (healthChecks?.checkChromaHealth ?? checkChromaHealth)(
      runtimeConfig,
      { collectionName: collection.activePhysicalCollection },
    );
    chromaReadable = health.details?.collectionReadable === true;
    if (chromaReadable) {
      chromaCount = (health.details?.collectionCount as number | undefined) ?? -1;
    }
  }

  const blockers: CollectionReadinessIssue[] = [];
  const warnings: CollectionReadinessIssue[] = [];

  if (!hasActivePhysicalCollection) {
    blockers.push(makeIssue(
      "COLLECTION_NO_ACTIVE_PHYSICAL_COLLECTION",
      "No active physical collection exists. Run re-index first.",
      runtimeConfig,
    ));
  } else if (!chromaReadable) {
    blockers.push(makeIssue(
      "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE",
      `Active physical collection ${collection.activePhysicalCollection} is not readable.`,
      runtimeConfig,
    ));
  }

  if (!ollama.ok) {
    blockers.push(makeIssue(
      "OLLAMA_UNREACHABLE",
      `Ollama is not reachable at ${runtimeConfig.ollamaBaseUrl}. ${ollama.error ?? ""}`.trim(),
      runtimeConfig,
    ));
  } else {
    if (!embeddingModelAvailable) {
      blockers.push(makeIssue(
        "EMBED_MODEL_MISSING",
        `Embedding model ${readEmbeddingModel} is missing in Ollama, so retrieval and indexing embeddings cannot run.`,
        runtimeConfig,
        `Pull the embedding model with: ollama pull ${readEmbeddingModel}`,
      ));
    }

    if (!chatModelAvailable) {
      blockers.push(makeIssue(
        "CHAT_MODEL_MISSING",
        `Chat model ${collection.chatModel} is missing in Ollama, so answer generation cannot run.`,
        runtimeConfig,
        `Pull the chat model with: ollama pull ${collection.chatModel}`,
      ));
    }
  }

  if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
    warnings.push(makeIssue(
      "COLLECTION_INDEX_JOB_ACTIVE",
      activeJob.status === "running"
        ? `Index job ${activeJob.id} is running.`
        : `Index job ${activeJob.id} is queued.`,
      runtimeConfig,
    ));
  }

  const queryReady = chromaReadable && embeddingModelAvailable && chatModelAvailable;
  const retrieveReady = chromaReadable && embeddingModelAvailable;

  return {
    id: collection.id,
    status: collection.status,
    hasActivePhysicalCollection,
    activeVersion: collection.activeVersion ?? null,
    activeJob: activeJob ? { id: activeJob.id, status: activeJob.status } : null,
    chromaReadable,
    chromaCount,
    modelAvailability: {
      embeddingModel: readEmbeddingModel,
      embeddingModelAvailable,
      chatModel: collection.chatModel,
      chatModelAvailable,
      desiredEmbeddingModel: collection.embeddingModel !== readEmbeddingModel ? collection.embeddingModel : undefined,
    },
    capabilities: {
      query: queryReady,
      retrieve: retrieveReady,
      reindex: true,
    },
    blockers,
    warnings,
    recommendedActions: unique(
      [...blockers, ...warnings]
        .map((issue) => issue.recommendedAction)
        .filter((action): action is string => Boolean(action)),
    ),
  };
}
