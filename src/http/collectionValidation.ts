import type { CollectionRegistry, CreateCollectionInput, RagCollection, RequestContext, UpdateCollectionPatch } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { analyzeIndexingSource, registryExcludePaths } from "../ingestion/pipeline.js";
import { checkChromaHealth, checkOllamaHealth, hasConfiguredModel } from "../rag.js";
import { recommendedActionFor, unique } from "../readiness.js";

export type CollectionValidationIssue = {
  code: string;
  message: string;
  recommendedAction?: string;
};

export type CollectionValidationImpact = {
  reindexRequired: boolean;
  immediateFields: string[];
  reindexFields: string[];
  note: string;
};

export type CollectionValidationResult = {
  blockers: CollectionValidationIssue[];
  warnings: CollectionValidationIssue[];
  recommendedActions: string[];
  impact: CollectionValidationImpact;
};

export type CollectionValidationMode = "create" | "update";

export type CollectionValidationDraft = {
  id?: string;
  mode: CollectionValidationMode;
  status: RagCollection["status"];
  displayName: string;
  description?: string;
  sourcePath: string;
  embeddingModel: string;
  chatModel: string;
  chunkSize: number;
  chunkOverlap: number;
  retrievalK: number;
  retrievalDistanceThreshold: number;
  changedFields: string[];
  activePhysicalCollection?: string;
  activeVersion?: string;
};

export type CollectionValidationHealthChecks = {
  checkChromaHealth?: typeof checkChromaHealth;
  checkOllamaHealth?: typeof checkOllamaHealth;
};

function makeIssue(
  code: string,
  message: string,
  runtimeConfig: ResolvedConfig,
  recommendedActionOverride?: string,
): CollectionValidationIssue {
  const recommendedAction = recommendedActionOverride ?? recommendedActionFor(code, runtimeConfig);
  return recommendedAction ? { code, message, recommendedAction } : { code, message };
}

const IMMEDIATE_FIELDS = new Set([
  "displayName",
  "description",
  "retrievalK",
  "retrievalDistanceThreshold",
  "chatModel",
]);

const REINDEX_FIELDS = new Set([
  "sourcePath",
  "distanceMetric",
  "chunkSize",
  "chunkOverlap",
  "embeddingModel",
]);

const OLLAMA_FIELDS = new Set([
  "embeddingModel",
  "chatModel",
]);

const VALIDATION_FIELD_ORDER = [
  "displayName",
  "description",
  "sourcePath",
  "distanceMetric",
  "chunkSize",
  "chunkOverlap",
  "retrievalK",
  "retrievalDistanceThreshold",
  "embeddingModel",
  "chatModel",
];

function buildImpact(draft: CollectionValidationDraft): CollectionValidationImpact {
  const changedFields = VALIDATION_FIELD_ORDER.filter((field) => draft.changedFields.includes(field));
  const immediateFields = changedFields.filter((field) => IMMEDIATE_FIELDS.has(field));
  const reindexFields = changedFields.filter((field) => REINDEX_FIELDS.has(field));

  if (draft.mode === "create") {
    const createImmediateFields = changedFields.filter((field) => ["displayName", "description"].includes(field));
    const createReindexFields = changedFields.filter((field) => !["displayName", "description"].includes(field));
    return {
      reindexRequired: true,
      immediateFields: createImmediateFields,
      reindexFields: createReindexFields,
      note: "New collections must be re-indexed before indexed settings become active.",
    };
  }

  if (reindexFields.length > 0) {
    const note = immediateFields.length > 0
      ? "Immediate settings were saved. Indexed settings were also saved, but they only take effect after re-index completes."
      : "These settings are saved, but they only take effect after re-index completes.";
    return {
      reindexRequired: true,
      immediateFields,
      reindexFields,
      note,
    };
  }

  if (immediateFields.length > 0) {
    return {
      reindexRequired: false,
      immediateFields,
      reindexFields,
      note: "These settings are saved and take effect immediately without re-index.",
    };
  }

  return {
    reindexRequired: false,
    immediateFields: [],
    reindexFields: [],
    note: "No indexed settings changed.",
  };
}

function hasChangedField(draft: CollectionValidationDraft, fields: Set<string>): boolean {
  return draft.changedFields.some((field) => fields.has(field));
}

export function buildCreateCollectionInput(
  input: Partial<CreateCollectionInput>,
  runtimeConfig: ResolvedConfig,
): CreateCollectionInput {
  return {
    displayName: input.displayName as string,
    description: input.description,
    sourcePath: input.sourcePath ?? runtimeConfig.collectionDefaults.sourcePath,
    distanceMetric: input.distanceMetric ?? runtimeConfig.collectionDefaults.distanceMetric,
    chunkSize: input.chunkSize ?? runtimeConfig.collectionDefaults.chunkSize,
    chunkOverlap: input.chunkOverlap ?? runtimeConfig.collectionDefaults.chunkOverlap,
    retrievalK: input.retrievalK ?? runtimeConfig.collectionDefaults.retrievalK,
    retrievalDistanceThreshold:
      input.retrievalDistanceThreshold ?? runtimeConfig.collectionDefaults.retrievalDistanceThreshold,
    embeddingModel: input.embeddingModel ?? runtimeConfig.ollamaEmbeddingModel,
    chatModel: input.chatModel ?? runtimeConfig.ollamaChatModel,
  };
}

export function buildCreateValidationDraft(
  input: CreateCollectionInput,
): CollectionValidationDraft {
  const changedFields = VALIDATION_FIELD_ORDER.filter((field) => {
    if (field === "description") return input.description !== undefined;
    return true;
  });

  return {
    mode: "create",
    status: "creating",
    displayName: input.displayName,
    description: input.description,
    sourcePath: input.sourcePath,
    embeddingModel: input.embeddingModel,
    chatModel: input.chatModel,
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
    retrievalK: input.retrievalK,
    retrievalDistanceThreshold: input.retrievalDistanceThreshold,
    changedFields,
  };
}

function buildChangedFields(collection: RagCollection, patch: UpdateCollectionPatch): string[] {
  const changed: string[] = [];
  const pushIfChanged = <K extends keyof UpdateCollectionPatch>(field: K, current: UpdateCollectionPatch[K]) => {
    if (patch[field] !== undefined && patch[field] !== current) {
      changed.push(String(field));
    }
  };

  pushIfChanged("displayName", collection.displayName);
  if (patch.description !== undefined && patch.description !== collection.description) changed.push("description");
  pushIfChanged("sourcePath", collection.sourcePath);
  pushIfChanged("distanceMetric", collection.distanceMetric);
  pushIfChanged("chunkSize", collection.chunkSize);
  pushIfChanged("chunkOverlap", collection.chunkOverlap);
  pushIfChanged("retrievalK", collection.retrievalK);
  pushIfChanged("retrievalDistanceThreshold", collection.retrievalDistanceThreshold);
  pushIfChanged("embeddingModel", collection.embeddingModel);
  pushIfChanged("chatModel", collection.chatModel);

  return changed;
}

export function buildUpdateValidationDraft(
  collection: RagCollection,
  patch: UpdateCollectionPatch,
): CollectionValidationDraft {
  const changedFields = buildChangedFields(collection, patch);

  return {
    mode: "update",
    id: collection.id,
    status: collection.status,
    displayName: patch.displayName ?? collection.displayName,
    description: patch.description ?? collection.description,
    sourcePath: patch.sourcePath ?? collection.sourcePath,
    embeddingModel: patch.embeddingModel ?? collection.embeddingModel,
    chatModel: patch.chatModel ?? collection.chatModel,
    chunkSize: patch.chunkSize ?? collection.chunkSize,
    chunkOverlap: patch.chunkOverlap ?? collection.chunkOverlap,
    retrievalK: patch.retrievalK ?? collection.retrievalK,
    retrievalDistanceThreshold: patch.retrievalDistanceThreshold ?? collection.retrievalDistanceThreshold,
    changedFields,
    activePhysicalCollection: collection.activePhysicalCollection,
    activeVersion: collection.activeVersion,
  };
}

async function analyzeSourcePath(
  draft: CollectionValidationDraft,
  runtimeConfig: ResolvedConfig,
): Promise<{ blockers: CollectionValidationIssue[]; warnings: CollectionValidationIssue[] }> {
  try {
    const analysis = await analyzeIndexingSource({
      sourcePath: draft.sourcePath,
      excludePaths: registryExcludePaths(runtimeConfig.registryPath),
    });

    const blockers: CollectionValidationIssue[] = [];
    const warnings: CollectionValidationIssue[] = [];

    if (analysis.loadedDocumentCount === 0) {
      blockers.push(makeIssue(
        "NO_INDEXABLE_DOCUMENTS",
        `No indexable documents were found in ${draft.sourcePath}.`,
        runtimeConfig,
      ));
    }

    return { blockers, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      blockers: [
        makeIssue(
          "INDEXING_SOURCE_UNREADABLE",
          `Indexing source cannot be read at ${draft.sourcePath}. ${message}`.trim(),
          runtimeConfig,
        ),
      ],
      warnings: [],
    };
  }
}

export async function validateCollectionDraft(
  draft: CollectionValidationDraft,
  runtimeConfig: ResolvedConfig,
  registry?: CollectionRegistry,
  context?: RequestContext,
  healthChecks: CollectionValidationHealthChecks = {},
): Promise<CollectionValidationResult> {
  const blockers: CollectionValidationIssue[] = [];
  const warnings: CollectionValidationIssue[] = [];
  const hasAnyChanges = draft.changedFields.length > 0;
  const requiresReindexChecks = draft.mode === "create" || !hasAnyChanges || hasChangedField(draft, REINDEX_FIELDS);
  const requiresOllamaChecks = draft.mode === "create" || !hasAnyChanges || hasChangedField(draft, OLLAMA_FIELDS);
  const requiresChromaChecks = draft.mode === "create" || !hasAnyChanges || hasChangedField(draft, REINDEX_FIELDS);

  if (draft.chunkOverlap >= draft.chunkSize) {
    blockers.push(makeIssue(
      "COLLECTION_CHUNK_OVERLAP_INVALID",
      `chunkOverlap (${draft.chunkOverlap}) must be smaller than chunkSize (${draft.chunkSize}).`,
      runtimeConfig,
    ));
  }

  const [sourceResult, ollamaResult, chromaResult, activePhysicalResult, activeJob] = await Promise.all([
    requiresReindexChecks
      ? analyzeSourcePath(draft, runtimeConfig)
      : Promise.resolve({ blockers: [], warnings: [] }),
    requiresOllamaChecks
      ? (healthChecks.checkOllamaHealth ?? checkOllamaHealth)(runtimeConfig).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details: {
          reachable: false,
          availableModels: [],
        },
      }))
      : Promise.resolve(null),
    requiresChromaChecks
      ? (healthChecks.checkChromaHealth ?? checkChromaHealth)(runtimeConfig).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details: {
          reachable: false,
        },
      }))
      : Promise.resolve(null),
    requiresChromaChecks && draft.activePhysicalCollection
      ? (healthChecks.checkChromaHealth ?? checkChromaHealth)(runtimeConfig, {
        collectionName: draft.activePhysicalCollection,
      }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details: {
          reachable: false,
          collectionReadable: false,
        },
      }))
      : Promise.resolve(null),
    draft.id && registry && context
      ? registry.getActiveJobForCollection(context, draft.id)
      : Promise.resolve(null),
  ]);

  blockers.push(...sourceResult.blockers);
  warnings.push(...sourceResult.warnings);

  if (ollamaResult) {
    if (!ollamaResult.ok) {
      blockers.push(makeIssue(
        "OLLAMA_UNREACHABLE",
        `Ollama is not reachable at ${runtimeConfig.ollamaBaseUrl}. ${ollamaResult.error ?? ""}`.trim(),
        runtimeConfig,
      ));
    } else {
      const availableModels = Array.isArray(ollamaResult.details?.availableModels)
        ? ollamaResult.details.availableModels.filter((value): value is string => typeof value === "string")
        : [];

      if (hasChangedField(draft, OLLAMA_FIELDS) || draft.mode === "create" || !hasAnyChanges) {
        if (!hasConfiguredModel(availableModels, draft.embeddingModel)) {
          blockers.push(makeIssue(
            "EMBED_MODEL_MISSING",
            `Embedding model ${draft.embeddingModel} is missing in Ollama, so retrieval and indexing embeddings cannot run.`,
            runtimeConfig,
            `Pull the embedding model with: ollama pull ${draft.embeddingModel}`,
          ));
        }

        if (!hasConfiguredModel(availableModels, draft.chatModel)) {
          blockers.push(makeIssue(
            "CHAT_MODEL_MISSING",
            `Chat model ${draft.chatModel} is missing in Ollama, so answer generation cannot run.`,
            runtimeConfig,
            `Pull the chat model with: ollama pull ${draft.chatModel}`,
          ));
        }
      }
    }
  }

  if (chromaResult) {
    if (!chromaResult.ok) {
      blockers.push(makeIssue(
        "CHROMA_UNREACHABLE",
        `Chroma is not reachable at ${runtimeConfig.chromaUrl}. ${chromaResult.error ?? ""}`.trim(),
        runtimeConfig,
      ));
    }
  }

  if (draft.activePhysicalCollection && activePhysicalResult && chromaResult?.ok) {
    const readable = activePhysicalResult?.details?.collectionReadable === true;
    if (!readable) {
      warnings.push(makeIssue(
        "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE",
        `Active physical collection ${draft.activePhysicalCollection} is not readable.`,
        runtimeConfig,
      ));
    }
  }

  if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
    blockers.push(makeIssue(
      "COLLECTION_INDEX_JOB_ACTIVE",
      activeJob.status === "running"
        ? `Index job ${activeJob.id} is running.`
        : `Index job ${activeJob.id} is queued.`,
      runtimeConfig,
    ));
  }

  return {
    blockers,
    warnings,
    recommendedActions: unique(
      [...blockers, ...warnings]
        .map((issue) => issue.recommendedAction)
        .filter((action): action is string => Boolean(action)),
    ),
    impact: buildImpact(draft),
  };
}
