import type {
  CollectionRegistry,
  CollectionSourceKind,
  CreateCollectionInput,
  RagCollection,
  RequestContext,
  UpdateCollectionPatch,
} from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { analyzeIndexingSource, sourceScanExcludes } from "../ingestion/pipeline.js";
import { checkChromaHealth } from "../rag.js";
import {
  checkEmbeddingTarget,
  DEFAULT_BUILTIN_EMBEDDING_MODEL,
  type EmbeddingProvider,
} from "../embeddings/index.js";
import { describeEmbeddingReadiness } from "../readiness.js";
import { resolveEmbeddingTarget } from "../embeddings/services.js";
import { normalizeEmbeddingServiceId } from "../collections/indexState.js";
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
  sourceKind: CollectionSourceKind;
  sourcePath: string;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  /** openai-compatible: the embedding service (null/undefined = "server"). */
  embeddingServiceId?: string | null;
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
  checkEmbeddingTarget?: typeof checkEmbeddingTarget;
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
]);

const REINDEX_FIELDS = new Set([
  "sourcePath",
  "distanceMetric",
  "chunkSize",
  "chunkOverlap",
  "embeddingProvider",
  "embeddingModel",
  "embeddingServiceId",
]);

const EMBEDDING_FIELDS = new Set([
  "embeddingProvider",
  "embeddingModel",
  "embeddingServiceId",
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
  "embeddingProvider",
  "embeddingModel",
  "embeddingServiceId",
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
  // No source path: the collection gets its own folder for uploaded documents (data/collections/<id>).
  const sourceKind: CollectionSourceKind = input.sourcePath ? "folder" : "uploads";
  return {
    displayName: input.displayName as string,
    description: input.description,
    sourceKind,
    sourcePath: input.sourcePath ?? runtimeConfig.uploadsDir,
    embeddingServiceId: input.embeddingServiceId,
    distanceMetric: input.distanceMetric ?? runtimeConfig.collectionDefaults.distanceMetric,
    chunkSize: input.chunkSize ?? runtimeConfig.collectionDefaults.chunkSize,
    chunkOverlap: input.chunkOverlap ?? runtimeConfig.collectionDefaults.chunkOverlap,
    retrievalK: input.retrievalK ?? runtimeConfig.collectionDefaults.retrievalK,
    retrievalDistanceThreshold:
      input.retrievalDistanceThreshold ?? runtimeConfig.collectionDefaults.retrievalDistanceThreshold,
    ...defaultEmbeddingForCreate(input, runtimeConfig),
  };
}

/**
 * The configured embedding default applies to NEW collections only. A request may pick another provider;
 * then the model defaults to that provider's default (builtin) or must be given (openai-compatible).
 */
function defaultEmbeddingForCreate(
  input: Partial<CreateCollectionInput>,
  runtimeConfig: ResolvedConfig,
): { embeddingProvider: EmbeddingProvider; embeddingModel: string } {
  const provider = input.embeddingProvider ?? runtimeConfig.embedding.provider;
  if (input.embeddingModel) {
    return { embeddingProvider: provider, embeddingModel: input.embeddingModel };
  }
  if (provider === runtimeConfig.embedding.provider) {
    return { embeddingProvider: provider, embeddingModel: runtimeConfig.embedding.model };
  }
  return { embeddingProvider: provider, embeddingModel: provider === "builtin" ? DEFAULT_BUILTIN_EMBEDDING_MODEL : "" };
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
    sourceKind: input.sourceKind ?? "folder",
    sourcePath: input.sourcePath,
    embeddingProvider: input.embeddingProvider ?? "builtin",
    embeddingModel: input.embeddingModel,
    embeddingServiceId: input.embeddingServiceId ?? null,
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
  pushIfChanged("embeddingProvider", collection.embeddingProvider);
  pushIfChanged("embeddingModel", collection.embeddingModel);
  if (patch.embeddingServiceId !== undefined) {
    const nextProvider = patch.embeddingProvider ?? collection.embeddingProvider;
    if (normalizeEmbeddingServiceId(nextProvider, patch.embeddingServiceId)
      !== normalizeEmbeddingServiceId(collection.embeddingProvider, collection.embeddingServiceId)) {
      changed.push("embeddingServiceId");
    }
  }

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
    sourceKind: collection.sourceKind,
    sourcePath: patch.sourcePath ?? collection.sourcePath,
    embeddingProvider: patch.embeddingProvider ?? collection.embeddingProvider,
    embeddingModel: patch.embeddingModel ?? collection.embeddingModel,
    embeddingServiceId: patch.embeddingServiceId !== undefined ? patch.embeddingServiceId : collection.embeddingServiceId ?? null,
    chunkSize: patch.chunkSize ?? collection.chunkSize,
    chunkOverlap: patch.chunkOverlap ?? collection.chunkOverlap,
    retrievalK: patch.retrievalK ?? collection.retrievalK,
    retrievalDistanceThreshold: patch.retrievalDistanceThreshold ?? collection.retrievalDistanceThreshold,
    changedFields,
    activePhysicalCollection: collection.activePhysicalCollection,
    activeVersion: collection.activeVersion,
  };
}

const UPLOAD_DOCUMENTS_ACTION =
  "Upload documents to this collection (the Documents tab in the admin panel, or POST /v1/admin/collections/<id>/files), then re-index.";

/** A Windows path such as C:\docs given to a server that runs on Linux (for example in Docker). */
export function looksLikeHostWindowsPath(sourcePath: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32" && /^[A-Za-z]:[\\/]/.test(sourcePath.trim());
}

function folderSourceAction(sourcePath: string): string {
  const hostPathHint = looksLikeHostWindowsPath(sourcePath)
    ? "This is a path on your computer, but the server runs in a container and only sees its data folder. "
    : "";
  return `${hostPathHint}Use a folder the server can read, for example data/my-docs (with Docker: ./data/my-docs next to docker-compose.yml), `
    + "and put supported files (.txt, .md, .pdf, .doc, .docx) in it. Or create the collection without a source path and upload the documents.";
}

async function analyzeSourcePath(
  draft: CollectionValidationDraft,
  runtimeConfig: ResolvedConfig,
): Promise<{ blockers: CollectionValidationIssue[]; warnings: CollectionValidationIssue[] }> {
  const uploads = draft.sourceKind === "uploads";
  // A new uploads collection has no folder or documents yet; documents are uploaded after it is created.
  if (uploads && draft.mode === "create") return { blockers: [], warnings: [] };

  const noDocuments = (): CollectionValidationIssue => uploads
    ? makeIssue("NO_INDEXABLE_DOCUMENTS", "This collection has no documents.", runtimeConfig, UPLOAD_DOCUMENTS_ACTION)
    : makeIssue(
      "NO_INDEXABLE_DOCUMENTS",
      `No indexable documents were found in ${draft.sourcePath}.`,
      runtimeConfig,
      folderSourceAction(draft.sourcePath),
    );

  try {
    const analysis = await analyzeIndexingSource({
      sourcePath: draft.sourcePath,
      ...sourceScanExcludes(runtimeConfig),
    });

    const blockers: CollectionValidationIssue[] = [];
    const warnings: CollectionValidationIssue[] = [];

    if (analysis.loadedDocumentCount === 0) {
      blockers.push(noDocuments());
    }

    return { blockers, warnings };
  } catch (error) {
    // The uploads folder is created by the first upload; until then the collection simply has no documents.
    if (uploads && (error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { blockers: [noDocuments()], warnings: [] };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      blockers: [
        makeIssue(
          "INDEXING_SOURCE_UNREADABLE",
          `Indexing source cannot be read at ${draft.sourcePath}. ${message}`.trim(),
          runtimeConfig,
          folderSourceAction(draft.sourcePath),
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
  const requiresEmbeddingChecks = draft.mode === "create" || !hasAnyChanges || hasChangedField(draft, EMBEDDING_FIELDS);
  const requiresChromaChecks = draft.mode === "create" || !hasAnyChanges || hasChangedField(draft, REINDEX_FIELDS);

  if (draft.sourceKind === "uploads" && draft.mode === "update" && draft.changedFields.includes("sourcePath")) {
    blockers.push(makeIssue(
      "COLLECTION_SOURCE_FIXED",
      "This collection stores uploaded documents in its own folder; its source path cannot be changed.",
      runtimeConfig,
      "Manage the documents with the files API instead, or create a new collection with a source path.",
    ));
  }

  if (draft.chunkOverlap >= draft.chunkSize) {
    blockers.push(makeIssue(
      "COLLECTION_CHUNK_OVERLAP_INVALID",
      `chunkOverlap (${draft.chunkOverlap}) must be smaller than chunkSize (${draft.chunkSize}).`,
      runtimeConfig,
    ));
  }

  const [sourceResult, embeddingResult, chromaResult, activePhysicalResult, activeJob] = await Promise.all([
    requiresReindexChecks
      ? analyzeSourcePath(draft, runtimeConfig)
      : Promise.resolve({ blockers: [], warnings: [] }),
    requiresEmbeddingChecks && draft.embeddingModel
      ? resolveEmbeddingTarget({
        registry,
        runtimeConfig,
        context: context ?? { tenantId: "default", userId: "local-dev", requestId: "validate" },
        target: { provider: draft.embeddingProvider, model: draft.embeddingModel, serviceId: draft.embeddingServiceId },
      }).then((target) => (healthChecks.checkEmbeddingTarget ?? checkEmbeddingTarget)(runtimeConfig, target))
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

  if (requiresEmbeddingChecks && !draft.embeddingModel) {
    blockers.push(makeIssue(
      "EMBEDDING_MODEL_MISSING",
      `An embedding model is required for the ${draft.embeddingProvider} provider.`,
      runtimeConfig,
    ));
  }

  if (embeddingResult) {
    const embedding = describeEmbeddingReadiness(embeddingResult);
    if (embedding.status === "fail") {
      blockers.push(makeIssue(embedding.code, embedding.message, runtimeConfig));
    } else if (embedding.status === "warn") {
      warnings.push(makeIssue(embedding.code, embedding.message, runtimeConfig));
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
