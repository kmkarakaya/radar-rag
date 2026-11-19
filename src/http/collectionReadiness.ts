import type { CollectionRegistry, IndexJob, RagCollection, RequestContext } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { checkChatProvider } from "../chat.js";
import { activeEmbeddingTarget, checkEmbeddingTarget, type EmbeddingProvider } from "../embeddings/index.js";
import { resolveEmbeddingTarget } from "../embeddings/services.js";
import { normalizeEmbeddingServiceId } from "../collections/indexState.js";
import { checkChromaHealth } from "../rag.js";
import { describeChatReadiness, describeEmbeddingReadiness, recommendedActionFor, unique } from "../readiness.js";

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
    /** The embedding the active index was built with (what reads use). */
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    /** openai-compatible: the embedding service the active index was built with ("server" = .env / config). */
    embeddingServiceId?: string;
    embeddingModelAvailable: boolean;
    /** The global chat LLM model, or null when no chat LLM is configured (retrieve-only). */
    chatModel: string | null;
    chatModelAvailable: boolean;
    /** Set when the collection's saved embedding differs from the active one (takes effect after re-index). */
    desiredEmbeddingProvider?: EmbeddingProvider;
    desiredEmbeddingModel?: string;
    desiredEmbeddingServiceId?: string;
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
  checkEmbeddingTarget?: typeof checkEmbeddingTarget;
  checkChatProvider?: typeof checkChatProvider;
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
  // Reads use the embedding the active index was built with (and its service), so that is what is checked here.
  const readEmbedding = await resolveEmbeddingTarget({
    registry,
    runtimeConfig,
    context,
    target: activeEmbeddingTarget(collection),
  });
  const desiredServiceId = normalizeEmbeddingServiceId(collection.embeddingProvider, collection.embeddingServiceId);
  const embeddingStatus = await (healthChecks?.checkEmbeddingTarget ?? checkEmbeddingTarget)(runtimeConfig, readEmbedding);
  const hasActivePhysicalCollection = Boolean(collection.activePhysicalCollection);
  const embeddingModelAvailable = embeddingStatus.ok;
  // The chat LLM is global (not per collection) and optional; it only gates /query.
  const chatProvider = await (healthChecks?.checkChatProvider ?? checkChatProvider)(runtimeConfig);
  const chatModelAvailable = chatProvider.ok;

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

  const embeddingReadiness = describeEmbeddingReadiness(embeddingStatus);
  if (embeddingReadiness.status === "fail") {
    blockers.push(makeIssue(embeddingReadiness.code, embeddingReadiness.message, runtimeConfig));
  } else if (embeddingReadiness.status === "warn") {
    warnings.push(makeIssue(embeddingReadiness.code, embeddingReadiness.message, runtimeConfig));
  }

  const chatReadiness = describeChatReadiness(chatProvider, runtimeConfig);
  if (chatReadiness.status === "fail") {
    blockers.push(makeIssue(chatReadiness.code, chatReadiness.message, runtimeConfig));
  } else if (chatReadiness.status === "warn" || chatReadiness.status === "skip") {
    // Not configured (retrieve-only) or unverifiable: informational, retrieval is unaffected.
    warnings.push(makeIssue(chatReadiness.code, chatReadiness.message, runtimeConfig));
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

  const retrieveReady = chromaReadable && embeddingModelAvailable;
  const queryReady = retrieveReady && runtimeConfig.chat.enabled && chatModelAvailable;

  return {
    id: collection.id,
    status: collection.status,
    hasActivePhysicalCollection,
    activeVersion: collection.activeVersion ?? null,
    activeJob: activeJob ? { id: activeJob.id, status: activeJob.status } : null,
    chromaReadable,
    chromaCount,
    modelAvailability: {
      embeddingProvider: readEmbedding.provider,
      embeddingModel: readEmbedding.model,
      ...(readEmbedding.serviceId ? { embeddingServiceId: readEmbedding.serviceId } : {}),
      embeddingModelAvailable,
      chatModel: runtimeConfig.chat.enabled ? runtimeConfig.chat.model : null,
      chatModelAvailable,
      ...(collection.embeddingProvider !== readEmbedding.provider
        || collection.embeddingModel !== readEmbedding.model
        || desiredServiceId !== (readEmbedding.serviceId ?? null)
        ? {
          desiredEmbeddingProvider: collection.embeddingProvider,
          desiredEmbeddingModel: collection.embeddingModel,
          ...(desiredServiceId ? { desiredEmbeddingServiceId: desiredServiceId } : {}),
        }
        : {}),
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
