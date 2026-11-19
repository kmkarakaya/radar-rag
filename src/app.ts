import path from "node:path";
import express, { type Express } from "express";
import type { CollectionRegistry, SystemOperationsAggregateSummary } from "./collections/types.js";
import { resolveReadableCollection } from "./collections/resolveReadableCollection.js";
import { config, type ResolvedConfig } from "./config.js";
import { errorHandler, notFoundHandler, sendErrorResponse } from "./http/errors.js";
import { createRequestContext } from "./http/requestContext.js";
import { createRateLimitMiddleware, createInMemoryRequestRateLimiter, type RequestRateLimiter } from "./http/rateLimit.js";
import { createAdminAuthService } from "./http/adminAuth.js";
import { checkIndexingSourceHealth, type IndexingSourceHealthDetails } from "./index.js";
import { createAdminRouter } from "./http/adminRouter.js";
import type { deleteSourceChunks } from "./collections/chromaCollections.js";
import { createRagRouter } from "./http/ragRouter.js";
import {
  createConsoleLogSink,
  createOperationalHttpLogger,
  createPersistentOperationalLogSink,
  type OperationalLogSink,
} from "./observability/logger.js";
import { checkChatProvider } from "./chat.js";
import {
  capabilitySummary,
  describeChatReadiness,
  describeEmbeddingReadiness,
  QUERY_DISABLED_SUMMARY,
  recommendedActionFor,
  unique,
  type Capability,
  type ReadinessIssue,
} from "./readiness.js";
import {
  answerQuestion,
  checkChromaHealth,
  retrieveSources,
} from "./rag.js";
import { checkEmbeddingTarget, defaultEmbeddingTarget, listConnectionModels, listEmbeddingModels } from "./embeddings/index.js";
import type { IndexJobRunner } from "./indexing/jobRunner.js";

export type AppDependencies = {
  runtimeConfig?: ResolvedConfig;
  registry?: CollectionRegistry;
  jobRunner?: IndexJobRunner;
  logEvent?: OperationalLogSink;
  rateLimiter?: RequestRateLimiter;
  adminAuth?: ReturnType<typeof createAdminAuthService>;
  ragHandlers?: {
    retrieveSources?: typeof retrieveSources;
    answerQuestion?: typeof answerQuestion;
    resolveReadableCollection?: typeof resolveReadableCollection;
  };
  healthChecks?: {
    checkChromaHealth?: typeof checkChromaHealth;
    /** Cheap embedding availability check (builtin: catalog + cache; openai-compatible: free GET /models). */
    checkEmbeddingTarget?: typeof checkEmbeddingTarget;
    /** Model suggestions for GET /v1/admin/models. */
    listEmbeddingModels?: typeof listEmbeddingModels;
    /** Free GET /models check of one embedding service (POST /v1/admin/embedding-services/test). */
    checkEmbeddingConnection?: typeof listConnectionModels;
    /** Free GET /models check of the optional chat LLM (never a generation). */
    checkChatProvider?: typeof checkChatProvider;
    checkIndexingSourceHealth?: typeof checkIndexingSourceHealth;
  };
  /** Removes a deleted document's chunks from the active index (Chroma). */
  documentIndex?: {
    deleteSourceChunks?: typeof deleteSourceChunks;
  };
};

type CheckStatus = "pass" | "fail" | "warn" | "skip";

type ReadinessCheck = {
  code: string;
  name: string;
  status: CheckStatus;
  blocking: boolean;
  capabilities: Capability[];
  message: string;
  details?: Record<string, unknown>;
};

type OperationalAlertCode =
  | "FAILED_COLLECTIONS_PRESENT"
  | "FAILED_JOBS_PRESENT"
  | "CLEANUP_BACKLOG_PRESENT"
  | "CLEANUP_RETRY_REQUIRED";

type OperationalAlert = {
  code: OperationalAlertCode;
  severity: "warn" | "info";
  message: string;
  recommendedAction?: string;
};

type ReadyOperationsSummary = SystemOperationsAggregateSummary & {
  runtime: {
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequestsPerWindow: number;
    };
    concurrency: {
      maxConcurrentEmbeddings: number;
      maxConcurrentGenerations: number;
    };
    timeouts: {
      readinessMs: number;
      ragMs: number;
    };
  };
};

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();
  const runtimeConfig = deps.runtimeConfig ?? config;
  const logEvent = createPersistentOperationalLogSink(deps.logEvent ?? createConsoleLogSink(), deps.registry);
  const rateLimiter = deps.rateLimiter ?? createInMemoryRequestRateLimiter({
    enabled: runtimeConfig.rateLimitEnabled,
    windowMs: runtimeConfig.rateLimitWindowMs,
    maxRequestsPerWindow: runtimeConfig.rateLimitMaxRequestsPerWindow,
  });
  const adminAuth = deps.adminAuth ?? createAdminAuthService({
    config: runtimeConfig.adminAuth,
    env: process.env,
  });
  app.locals.dependencies = {
    ...deps,
    runtimeConfig,
    logEvent,
    rateLimiter,
    adminAuth,
  } satisfies AppDependencies;
  configureApp(app);
  return app;
}

export async function checkRegistryHealth(registry?: CollectionRegistry): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    if (!registry) {
      throw new Error("Registry dependency not provided.");
    }
    
    // Attempt a lightweight operation to verify db access.
    // e.g. list collections with limit 1
    const testContext = { tenantId: "health", userId: "health", requestId: "health" };
    await registry.listVisibleCollections(testContext);
    
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

function emptySystemOperationsAggregateSummary(observedAt: string): SystemOperationsAggregateSummary {
  return {
    observedAt,
    collections: {
      total: 0,
      creating: 0,
      indexing: 0,
      ready: 0,
      failed: 0,
      archived: 0,
    },
    jobs: {
      total: 0,
      active: 0,
      queued: 0,
      running: 0,
      terminal: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      oldestActiveUpdatedAt: null,
      oldestActiveAgeSec: null,
      newestFailureAt: null,
    },
    physicalCollections: {
      total: 0,
      building: 0,
      active: 0,
      failedBuild: 0,
      deletePending: 0,
      cleanupFailed: 0,
      deleted: 0,
      cleanupBacklog: 0,
      oldestDueDeleteAt: null,
    },
  };
}

function buildReadyOperationsSummary(
  aggregate: SystemOperationsAggregateSummary,
  runtimeConfig: ResolvedConfig,
): ReadyOperationsSummary {
  return {
    ...aggregate,
    runtime: {
      rateLimit: {
        enabled: runtimeConfig.rateLimitEnabled,
        windowMs: runtimeConfig.rateLimitWindowMs,
        maxRequestsPerWindow: runtimeConfig.rateLimitMaxRequestsPerWindow,
      },
      concurrency: {
        maxConcurrentEmbeddings: runtimeConfig.maxConcurrentEmbeddings,
        maxConcurrentGenerations: runtimeConfig.maxConcurrentGenerations,
      },
      timeouts: {
        readinessMs: runtimeConfig.readyTimeoutMs,
        ragMs: runtimeConfig.ragTimeoutMs,
      },
    },
  };
}

function buildOperationalAlerts(operations: ReadyOperationsSummary): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];

  if (operations.collections.failed > 0) {
    alerts.push({
      code: "FAILED_COLLECTIONS_PRESENT",
      severity: "warn",
      message: `${operations.collections.failed} collections are currently in failed state.`,
      recommendedAction: "Review failed collections in the admin panel and rerun indexing after the underlying dependency or data issue is fixed.",
    });
  }

  if (operations.jobs.failed > 0) {
    alerts.push({
      code: "FAILED_JOBS_PRESENT",
      severity: "warn",
      message: `${operations.jobs.failed} jobs have failed. Latest failure was observed at ${operations.jobs.newestFailureAt ?? "an unknown time"}.`,
      recommendedAction: "Inspect recent failed jobs and retry indexing only after the root cause is understood.",
    });
  }

  if (operations.physicalCollections.cleanupBacklog > 0) {
    alerts.push({
      code: "CLEANUP_BACKLOG_PRESENT",
      severity: "info",
      message: `${operations.physicalCollections.cleanupBacklog} retired physical collections are due for cleanup.`,
      recommendedAction: "Allow startup or maintenance cleanup to run, or inspect cleanup scheduling if backlog keeps growing.",
    });
  }

  if (operations.physicalCollections.cleanupFailed > 0) {
    alerts.push({
      code: "CLEANUP_RETRY_REQUIRED",
      severity: "warn",
      message: `${operations.physicalCollections.cleanupFailed} physical collections are waiting for cleanup retry.`,
      recommendedAction: "Review cleanup errors and retry or manually remove orphaned physical collections if automated cleanup keeps failing.",
    });
  }

  return alerts;
}

function configureApp(app: Express): void {
  const deps = app.locals.dependencies as AppDependencies;
  const runtimeConfig = deps.runtimeConfig ?? config;
  const logEvent = deps.logEvent ?? createConsoleLogSink();
  const adminAuth = deps.adminAuth;
  const adminShellPath = path.resolve(process.cwd(), "admin", "index.html");

  app.use((req, res, next) => {
    res.locals.requestContext = createRequestContext(req);
    next();
  });

  app.use(createOperationalHttpLogger(logEvent));
  app.use(express.json({ limit: "1mb" }));
  app.use(createRateLimitMiddleware({
    limiter: deps.rateLimiter ?? createInMemoryRequestRateLimiter({
      enabled: runtimeConfig.rateLimitEnabled,
      windowMs: runtimeConfig.rateLimitWindowMs,
      maxRequestsPerWindow: runtimeConfig.rateLimitMaxRequestsPerWindow,
    }),
    runtimeConfig,
    logEvent,
  }));

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Check for express.json body parser errors (such as Payload Too Large or Invalid JSON)
    if (err instanceof Error && "status" in err && typeof err.status === "number") {
      if (err.status === 413) {
        sendErrorResponse(res, {
          statusCode: 413,
          error: "Payload Too Large",
          code: "INVALID_REQUEST_BODY",
          message: "Request entity too large.",
          context: res.locals.requestContext,
        });
        return;
      }
      if (err.status === 400 && err instanceof SyntaxError && "body" in err) {
        sendErrorResponse(res, {
          statusCode: 400,
          error: "Invalid JSON body",
          code: "INVALID_REQUEST_BODY",
          message: err.message,
          context: res.locals.requestContext,
        });
        return;
      }
    }

    if (err instanceof SyntaxError && "body" in err) {
      sendErrorResponse(res, {
        statusCode: 400,
        error: "Invalid JSON body",
        code: "INVALID_REQUEST_BODY",
        message: err.message,
        context: res.locals.requestContext,
      });
      return;
    }

    next(err);
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "Radar RAG",
      status: "ok",
      message: "Use the versioned multi-collection API under /v1/rag/collections.",
      endpoints: {
        health: "/health",
        ready: "/ready",
        adminCollections: "/v1/admin/collections",
        collections: "/v1/rag/collections",
        query: "/v1/rag/collections/:collectionId/query",
        retrieve: "/v1/rag/collections/:collectionId/retrieve",
        testFrontend: "/test-frontend/",
      },
    });
  });

  app.use("/v1/admin", createAdminRouter(app.locals.dependencies, runtimeConfig));
  app.use("/v1/rag", createRagRouter(app.locals.dependencies, runtimeConfig));

  app.get(/^\/admin\/?$/, (req, res) => {
    if (adminAuth?.isEnabled() && !adminAuth.getSessionSummaryFromRequest(req)) {
      res.redirect(302, "/admin/login");
      return;
    }
    res.sendFile(adminShellPath);
  });

  app.get(/^\/admin\/login\/?$/, (_req, res) => {
    res.sendFile(adminShellPath);
  });

  app.use("/admin", express.static(path.resolve(process.cwd(), "admin")));
  app.use("/test-frontend", express.static(path.resolve(process.cwd(), "test_frontend")));

async function getReadinessPayload(registry?: CollectionRegistry) {
  const healthChecks = deps.healthChecks;
  const observedAt = new Date().toISOString();
  const defaultEmbedding = defaultEmbeddingTarget(runtimeConfig);
  const [chroma, embeddingStatus, dataSource, registryHealth] = await Promise.all([
    (healthChecks?.checkChromaHealth ?? checkChromaHealth)(runtimeConfig),
    (healthChecks?.checkEmbeddingTarget ?? checkEmbeddingTarget)(runtimeConfig, defaultEmbedding),
    (healthChecks?.checkIndexingSourceHealth ?? checkIndexingSourceHealth)(runtimeConfig),
    checkRegistryHealth(registry),
  ]);
  const dataSourceDetails = (dataSource.details ?? {}) as Partial<IndexingSourceHealthDetails>;
  const chromaReachable = chroma.ok;
  const operationsAggregate = registry
    ? await registry.getSystemOperationsSummary(observedAt).catch(() => emptySystemOperationsAggregateSummary(observedAt))
    : emptySystemOperationsAggregateSummary(observedAt);
  const operations = buildReadyOperationsSummary(operationsAggregate, runtimeConfig);
  const operationalAlerts = buildOperationalAlerts(operations);

  const chatEnabled = runtimeConfig.chat.enabled;
  const chatProvider = await (healthChecks?.checkChatProvider ?? checkChatProvider)(runtimeConfig);
  const checks: ReadinessCheck[] = [];

  checks.push({
    code: chromaReachable ? "CHROMA_REACHABLE" : "CHROMA_UNREACHABLE",
    name: "Chroma reachability",
    status: chromaReachable ? "pass" : "fail",
    blocking: true,
    capabilities: ["retrieve", "query", "index"],
    message: chromaReachable
      ? `Chroma is reachable at ${runtimeConfig.chromaUrl}.`
      : `Chroma is not reachable at ${runtimeConfig.chromaUrl}. ${chroma.error ?? ""}`.trim(),
    details: {
      url: runtimeConfig.chromaUrl,
      latencyMs: chroma.latencyMs,
      error: chroma.error,
    },
  });

  checks.push({
    code: registryHealth.ok ? "REGISTRY_REACHABLE" : "REGISTRY_UNREACHABLE",
    name: "Registry reachability",
    status: registryHealth.ok ? "pass" : "fail",
    blocking: true,
    capabilities: ["retrieve", "query", "index"],
    message: registryHealth.ok
      ? "SQLite registry is reachable."
      : `SQLite registry is unreachable. ${registryHealth.error ?? ""}`.trim(),
    details: {
      latencyMs: registryHealth.latencyMs,
      error: registryHealth.error,
    }
  });

  // The configured default embedding is only used when indexing new collections, so it can only block
  // `index`. Existing collections keep their own provider/model and are checked individually by
  // GET /v1/rag/collections/:id/ready (a collection on another provider keeps working when this one is down).
  checks.push({
    name: "Embedding (default for new collections)",
    capabilities: ["index"],
    ...describeEmbeddingReadiness(embeddingStatus),
  });

  checks.push({ name: "Chat LLM", capabilities: ["query"], ...describeChatReadiness(chatProvider, runtimeConfig) });

  checks.push({
    code: dataSource.ok ? "INDEXING_SOURCE_READABLE" : "INDEXING_SOURCE_UNREADABLE",
    name: "Indexing data source",
    status: dataSource.ok ? "pass" : "fail",
    blocking: true,
    capabilities: ["index"],
    message: dataSource.ok
      ? `Indexing source is readable at ${runtimeConfig.sourcePath}.`
      : `Indexing source cannot be read at ${runtimeConfig.sourcePath}. ${dataSource.error ?? ""}`.trim(),
    details: {
      sourcePath: runtimeConfig.sourcePath,
      latencyMs: dataSource.latencyMs,
      error: dataSource.error,
    },
  });

  if (dataSource.ok) {
    const documentCount = typeof dataSourceDetails.documentCount === "number"
      ? dataSourceDetails.documentCount
      : 0;

    checks.push({
      code: documentCount > 0 ? "INDEXABLE_DOCUMENTS_PRESENT" : "NO_INDEXABLE_DOCUMENTS",
      name: "Indexable document availability",
      status: documentCount > 0 ? "pass" : "fail",
      blocking: true,
      capabilities: ["index"],
      message: documentCount > 0
        ? `Indexing source contains ${documentCount} documents with indexable content.`
        : "Indexing source does not contain any documents with indexable content so indexing cannot proceed.",
      details: {
        sourcePath: runtimeConfig.sourcePath,
        fileCount: dataSourceDetails.fileCount,
        loadedDocumentCount: dataSourceDetails.loadedDocumentCount,
        documentCount,
        unsupportedFiles: dataSourceDetails.unsupportedFiles,
      },
    });
  }

  const blockers = checks
    .filter((check) => check.status === "fail" && check.blocking)
    .map((check) => ({
      code: check.code,
      capabilities: check.capabilities,
      message: check.message,
      details: check.details,
      recommendedAction: recommendedActionFor(check.code, runtimeConfig),
    } satisfies ReadinessIssue));

  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => ({
      code: check.code,
      capabilities: check.capabilities,
      message: check.message,
      details: check.details,
      recommendedAction: recommendedActionFor(check.code, runtimeConfig),
    } satisfies ReadinessIssue));

  const isBlocked = (capability: Capability) => checks.some(
    (check) => check.blocking && check.status === "fail" && check.capabilities.includes(capability),
  );
  const retrieveReady = !isBlocked("retrieve");
  // /query exists only when a chat LLM is configured; without one the system is retrieve-only.
  const queryReady = chatEnabled && !isBlocked("query");
  const indexReady = !isBlocked("index");
  const ready = retrieveReady && indexReady && (!chatEnabled || queryReady);
  const systemReadyFor = queryReady && indexReady
    ? "query-and-index"
    : retrieveReady && indexReady
      ? "retrieve-and-index"
      : queryReady
        ? "query"
        : retrieveReady
          ? "retrieve"
          : indexReady
            ? "index"
            : "neither";
  const overallSummary = systemReadyFor === "query-and-index"
    ? "System is ready to serve RAG queries and to run indexing from the configured data source."
    : systemReadyFor === "retrieve-and-index"
      ? chatEnabled
        ? "System can retrieve evidence and run indexing, but answer generation (/query) is not ready."
        : "System is ready to retrieve evidence and to run indexing (retrieve-only: no chat LLM configured)."
      : systemReadyFor === "query"
        ? "System can serve RAG queries, but it is not ready to run indexing."
        : systemReadyFor === "retrieve"
          ? "System can retrieve evidence from existing collections, but it is not ready to run indexing."
        : systemReadyFor === "index"
          ? "System can run indexing, but it is not ready to serve retrieval or RAG queries yet."
          : "System is not ready for retrieval, RAG queries or indexing.";
  const querySummary = chatEnabled ? capabilitySummary("query", queryReady, blockers) : QUERY_DISABLED_SUMMARY;

  return {
    ready,
    payload: {
      status: ready ? "ok" : "degraded",
      ready,
      systemReadyFor,
      overallSummary,
      retrieveReady,
      queryEnabled: chatEnabled,
      queryReady,
      indexReady,
      retrieveSummary: capabilitySummary("retrieve", retrieveReady, blockers),
      querySummary,
      indexSummary: capabilitySummary("index", indexReady, blockers),
      blockerCodes: blockers.map((issue) => issue.code),
      warningCodes: warnings.map((issue) => issue.code),
      recommendedActions: unique(
        blockers
          .map((issue) => issue.recommendedAction)
          .filter((action): action is string => Boolean(action)),
      ),
      port: runtimeConfig.port,
      chatModel: chatEnabled ? runtimeConfig.chat.model : null,
      embeddingProvider: runtimeConfig.embedding.provider,
      embeddingModel: runtimeConfig.embedding.model,
      chromaUrl: runtimeConfig.chromaUrl,
      chromaLatencyMs: chroma.latencyMs,
      capabilities: {
        retrieve: {
          ready: retrieveReady,
          message: capabilitySummary("retrieve", retrieveReady, blockers),
        },
        query: {
          enabled: chatEnabled,
          ready: queryReady,
          message: querySummary,
        },
        index: {
          ready: indexReady,
          message: capabilitySummary("index", indexReady, blockers),
        },
      },
      blockers,
      warnings,
      checks,
      dependencies: {
        chroma: {
          url: runtimeConfig.chromaUrl,
          ...chroma,
        },
        registry: {
          ok: registryHealth.ok,
          latencyMs: registryHealth.latencyMs,
          error: registryHealth.error,
        },
        // Default embedding for new collections; never includes the API key.
        embedding: embeddingStatus,
        // Never includes the API key.
        chat: chatProvider,
      },
      dataSource: {
        path: runtimeConfig.sourcePath,
        ...dataSource,
      },
      operations,
      operationalAlerts,
    },
  };
}

type ReadinessPayload = Awaited<ReturnType<typeof getReadinessPayload>>["payload"];

function truthyQuery(value: unknown): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function summarizeReadinessPayload(payload: ReadinessPayload) {
  return {
    status: payload.status,
    ready: payload.ready,
    systemReadyFor: payload.systemReadyFor,
    overallSummary: payload.overallSummary,
    retrieveReady: payload.retrieveReady,
    queryEnabled: payload.queryEnabled,
    queryReady: payload.queryReady,
    indexReady: payload.indexReady,
    retrieveSummary: payload.retrieveSummary,
    querySummary: payload.querySummary,
    indexSummary: payload.indexSummary,
    blockerCodes: payload.blockerCodes,
    warningCodes: payload.warningCodes,
    recommendedActions: payload.recommendedActions,
    blockers: payload.blockers.map((issue) => ({
      code: issue.code,
      message: issue.message,
      recommendedAction: issue.recommendedAction,
    })),
    warnings: payload.warnings.map((issue) => ({
      code: issue.code,
      message: issue.message,
      recommendedAction: issue.recommendedAction,
    })),
    dependencies: {
      registry: { ok: payload.dependencies.registry.ok },
      chroma: { ok: payload.dependencies.chroma.ok },
      embedding: { ok: payload.dependencies.embedding.ok },
      chat: { ok: payload.dependencies.chat.ok, configured: payload.dependencies.chat.configured },
    },
    config: {
      port: payload.port,
      chatModel: payload.chatModel,
      embeddingProvider: payload.embeddingProvider,
      embeddingModel: payload.embeddingModel,
      chromaUrl: payload.chromaUrl,
    },
    diagnostics: {
      full: "GET /ready?details=true",
      strictHttpStatus: "GET /ready?strict=true",
      fullStrict: "GET /ready?details=true&strict=true",
    },
    operations: payload.operations,
    operationalAlerts: payload.operationalAlerts,
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    alive: true,
    port: runtimeConfig.port,
    uptimeSec: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (req, res) => {
  const isStrict = truthyQuery(req.query.strict);
  const wantsDetails = truthyQuery(req.query.details);

  const payload = await getReadinessPayload(app.locals.dependencies?.registry);

  res
    .status(isStrict && !payload.ready ? 503 : 200)
    .json(wantsDetails ? payload.payload : summarizeReadinessPayload(payload.payload));
});

app.use(notFoundHandler);
app.use(errorHandler);
}
