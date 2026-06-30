import path from "node:path";
import express, { type Express } from "express";
import type { CollectionRegistry, SystemOperationsAggregateSummary } from "./collections/types.js";
import { resolveReadableCollection } from "./collections/resolveReadableCollection.js";
import { config, type ResolvedConfig } from "./config.js";
import { errorHandler, notFoundHandler, sendErrorResponse } from "./http/errors.js";
import { createRequestContext } from "./http/requestContext.js";
import { createRateLimitMiddleware, createInMemoryRequestRateLimiter, type RequestRateLimiter } from "./http/rateLimit.js";
import { checkIndexingSourceHealth, type IndexingSourceHealthDetails } from "./index.js";
import { createAdminRouter } from "./http/adminRouter.js";
import { createRagRouter } from "./http/ragRouter.js";
import { createConsoleLogSink, createOperationalHttpLogger, type OperationalLogSink } from "./observability/logger.js";
import { capabilitySummary, recommendedActionFor, unique, type Capability, type ReadinessIssue } from "./readiness.js";
import {
  answerQuestion,
  checkChatGenerationHealth,
  checkChromaHealth,
  checkEmbeddingHealth,
  checkOllamaHealth,
  getOllamaModelDiscovery,
  retrieveSources,
  type ChatGenerationHealthDetails,
  type EmbeddingHealthDetails,
  type OllamaHealthDetails,
} from "./rag.js";
import type { IndexJobRunner } from "./indexing/jobRunner.js";

export type AppDependencies = {
  runtimeConfig?: ResolvedConfig;
  registry?: CollectionRegistry;
  jobRunner?: IndexJobRunner;
  logEvent?: OperationalLogSink;
  rateLimiter?: RequestRateLimiter;
  ragHandlers?: {
    retrieveSources?: typeof retrieveSources;
    answerQuestion?: typeof answerQuestion;
    resolveReadableCollection?: typeof resolveReadableCollection;
  };
  healthChecks?: {
    checkChromaHealth?: typeof checkChromaHealth;
    checkOllamaHealth?: typeof checkOllamaHealth;
    checkOllamaModelDiscovery?: typeof getOllamaModelDiscovery;
    checkEmbeddingHealth?: typeof checkEmbeddingHealth;
    checkChatGenerationHealth?: typeof checkChatGenerationHealth;
    checkIndexingSourceHealth?: typeof checkIndexingSourceHealth;
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
  const logEvent = deps.logEvent ?? createConsoleLogSink();
  const rateLimiter = deps.rateLimiter ?? createInMemoryRequestRateLimiter({
    enabled: runtimeConfig.rateLimitEnabled,
    windowMs: runtimeConfig.rateLimitWindowMs,
    maxRequestsPerWindow: runtimeConfig.rateLimitMaxRequestsPerWindow,
  });
  app.locals.dependencies = {
    ...deps,
    runtimeConfig,
    logEvent,
    rateLimiter,
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
      name: "Vanilla RAG Backend",
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

  app.use("/admin", express.static(path.resolve(process.cwd(), "admin")));
  app.use("/test-frontend", express.static(path.resolve(process.cwd(), "test_frontend")));

async function getReadinessPayload(registry?: CollectionRegistry) {
  const healthChecks = deps.healthChecks;
  const observedAt = new Date().toISOString();
  const [chroma, ollama, dataSource, registryHealth] = await Promise.all([
    (healthChecks?.checkChromaHealth ?? checkChromaHealth)(runtimeConfig),
    (healthChecks?.checkOllamaHealth ?? checkOllamaHealth)(runtimeConfig),
    (healthChecks?.checkIndexingSourceHealth ?? checkIndexingSourceHealth)(runtimeConfig),
    checkRegistryHealth(registry),
  ]);
  const ollamaDetails = (ollama.details ?? {}) as Partial<OllamaHealthDetails>;
  const dataSourceDetails = (dataSource.details ?? {}) as Partial<IndexingSourceHealthDetails>;
  const chromaReachable = chroma.ok;
  const operationsAggregate = registry
    ? await registry.getSystemOperationsSummary(observedAt).catch(() => emptySystemOperationsAggregateSummary(observedAt))
    : emptySystemOperationsAggregateSummary(observedAt);
  const operations = buildReadyOperationsSummary(operationsAggregate, runtimeConfig);
  const operationalAlerts = buildOperationalAlerts(operations);

  const embedding = ollama.ok && ollamaDetails.embeddingModelAvailable
    ? await (healthChecks?.checkEmbeddingHealth ?? checkEmbeddingHealth)(runtimeConfig)
    : null;
  const chatGeneration = ollama.ok && ollamaDetails.chatModelAvailable
    ? await (healthChecks?.checkChatGenerationHealth ?? checkChatGenerationHealth)(runtimeConfig)
    : null;
  const embeddingDetails = (embedding?.details ?? {}) as Partial<EmbeddingHealthDetails>;
  const chatGenerationDetails = (
    chatGeneration?.details ?? {}
  ) as Partial<ChatGenerationHealthDetails>;
  const checks: ReadinessCheck[] = [];

  checks.push({
    code: chromaReachable ? "CHROMA_REACHABLE" : "CHROMA_UNREACHABLE",
    name: "Chroma reachability",
    status: chromaReachable ? "pass" : "fail",
    blocking: true,
    capabilities: ["query", "index"],
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
    capabilities: ["query", "index"],
    message: registryHealth.ok
      ? "SQLite registry is reachable."
      : `SQLite registry is unreachable. ${registryHealth.error ?? ""}`.trim(),
    details: {
      latencyMs: registryHealth.latencyMs,
      error: registryHealth.error,
    }
  });

  checks.push({
    code: ollama.ok ? "OLLAMA_REACHABLE" : "OLLAMA_UNREACHABLE",
    name: "Ollama reachability",
    status: ollama.ok ? "pass" : "fail",
    blocking: true,
    capabilities: ["query", "index"],
    message: ollama.ok
      ? `Ollama is reachable at ${runtimeConfig.ollamaBaseUrl}.`
      : `Ollama is not reachable at ${runtimeConfig.ollamaBaseUrl}. ${ollama.error ?? ""}`.trim(),
    details: {
      url: runtimeConfig.ollamaBaseUrl,
      latencyMs: ollama.latencyMs,
      error: ollama.error,
    },
  });

  if (ollama.ok) {
    checks.push({
      code: ollamaDetails.chatModelAvailable ? "CHAT_MODEL_AVAILABLE" : "CHAT_MODEL_MISSING",
      name: "Chat model availability",
      status: ollamaDetails.chatModelAvailable ? "pass" : "fail",
      blocking: true,
      capabilities: ["query"],
      message: ollamaDetails.chatModelAvailable
        ? `Chat model ${runtimeConfig.ollamaChatModel} is available in Ollama.`
        : `Chat model ${runtimeConfig.ollamaChatModel} is missing in Ollama, so answer generation cannot run.`,
      details: {
        model: runtimeConfig.ollamaChatModel,
        availableModels: ollamaDetails.availableModels,
      },
    });

    checks.push({
      code: ollamaDetails.embeddingModelAvailable ? "EMBED_MODEL_AVAILABLE" : "EMBED_MODEL_MISSING",
      name: "Embedding model availability",
      status: ollamaDetails.embeddingModelAvailable ? "pass" : "fail",
      blocking: true,
      capabilities: ["query", "index"],
      message: ollamaDetails.embeddingModelAvailable
        ? `Embedding model ${runtimeConfig.ollamaEmbeddingModel} is available in Ollama.`
        : `Embedding model ${runtimeConfig.ollamaEmbeddingModel} is missing in Ollama, so retrieval and indexing embeddings cannot run.`,
      details: {
        model: runtimeConfig.ollamaEmbeddingModel,
        availableModels: ollamaDetails.availableModels,
      },
    });
  }

  if (!ollama.ok || !ollamaDetails.embeddingModelAvailable) {
    checks.push({
      code: "EMBED_SMOKE_SKIPPED",
      name: "Embedding smoke test",
      status: "skip",
      blocking: true,
      capabilities: ["query", "index"],
      message: "Embedding smoke test was skipped because Ollama or the embedding model is not ready.",
      details: {
        probeText: runtimeConfig.readyEmbedProbeText,
      },
    });
  } else {
    checks.push({
      code: embedding?.ok ? "EMBED_SMOKE_PASSED" : "EMBED_SMOKE_FAILED",
      name: "Embedding smoke test",
      status: embedding?.ok ? "pass" : "fail",
      blocking: true,
      capabilities: ["query", "index"],
      message: embedding?.ok
        ? `Embedding smoke test succeeded with a vector length of ${embeddingDetails.vectorLength}.`
        : `Embedding smoke test failed. ${embedding?.error ?? ""}`.trim(),
      details: {
        probeText: embeddingDetails.probeText ?? runtimeConfig.readyEmbedProbeText,
        vectorLength: embeddingDetails.vectorLength,
        finiteValues: embeddingDetails.finiteValues,
      },
    });
  }

  if (!ollama.ok || !ollamaDetails.chatModelAvailable) {
    checks.push({
      code: "CHAT_SMOKE_SKIPPED",
      name: "Chat generation smoke test",
      status: "skip",
      blocking: true,
      capabilities: ["query"],
      message: "Chat generation smoke test was skipped because Ollama or the chat model is not ready.",
      details: {
        probeText: runtimeConfig.readyChatProbeText,
      },
    });
  } else {
    checks.push({
      code: chatGeneration?.ok ? "CHAT_SMOKE_PASSED" : "CHAT_SMOKE_FAILED",
      name: "Chat generation smoke test",
      status: chatGeneration?.ok ? "pass" : "fail",
      blocking: true,
      capabilities: ["query"],
      message: chatGeneration?.ok
        ? `Chat generation smoke test succeeded with a response length of ${chatGenerationDetails.responseLength}.`
        : `Chat generation smoke test failed. ${chatGeneration?.error ?? ""}`.trim(),
      details: {
        probeText: chatGenerationDetails.probeText ?? runtimeConfig.readyChatProbeText,
        responseLength: chatGenerationDetails.responseLength,
      },
    });
  }

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
        : "Indexing source does not contain any documents with indexable content in the current sample, so indexing cannot proceed.",
      details: {
        sourcePath: runtimeConfig.sourcePath,
        fileCount: dataSourceDetails.fileCount,
        loadedDocumentCount: dataSourceDetails.loadedDocumentCount,
        recordCount: dataSourceDetails.recordCount,
        sampledRecordCount: dataSourceDetails.sampledRecordCount,
        documentCount,
        unsupportedFiles: dataSourceDetails.unsupportedFiles,
        indexSampleSize: dataSourceDetails.indexSampleSize,
      },
    });

    if (dataSourceDetails.sampleLimited) {
      const loadedDocumentCount = dataSourceDetails.loadedDocumentCount ?? dataSourceDetails.recordCount;
      checks.push({
        code: "INDEX_SAMPLE_LIMIT_ACTIVE",
        name: "Index sample limit",
        status: "warn",
        blocking: false,
        capabilities: ["index", "query"],
        message: `Indexing currently uses only the first ${dataSourceDetails.documentCount} documents because collectionDefaults.indexSampleSize is set to ${dataSourceDetails.indexSampleSize}.`,
        details: {
          sourcePath: runtimeConfig.sourcePath,
          loadedDocumentCount,
          recordCount: dataSourceDetails.recordCount,
          sampledRecordCount: dataSourceDetails.sampledRecordCount,
          indexSampleSize: dataSourceDetails.indexSampleSize,
        },
      });
    }
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

  const queryReady = !checks.some(
    (check) => check.blocking && check.status === "fail" && check.capabilities.includes("query"),
  );
  const indexReady = !checks.some(
    (check) => check.blocking && check.status === "fail" && check.capabilities.includes("index"),
  );
  const ready = queryReady && indexReady;
  const systemReadyFor = queryReady && indexReady
    ? "query-and-index"
    : queryReady
      ? "query"
      : indexReady
        ? "index"
        : "neither";
  const overallSummary = ready
    ? "System is ready to serve RAG queries and to run indexing from the configured data source."
    : systemReadyFor === "query"
      ? "System can serve RAG queries, but it is not ready to run indexing from the configured data source."
      : systemReadyFor === "index"
        ? "System can run indexing, but it is not ready to serve RAG queries yet."
        : "System is not ready for RAG queries or indexing.";

  return {
    ready,
    payload: {
      status: ready ? "ok" : "degraded",
      ready,
      systemReadyFor,
      overallSummary,
      queryReady,
      indexReady,
      querySummary: capabilitySummary("query", queryReady, blockers),
      indexSummary: capabilitySummary("index", indexReady, blockers),
      blockerCodes: blockers.map((issue) => issue.code),
      warningCodes: warnings.map((issue) => issue.code),
      recommendedActions: unique(
        blockers
          .map((issue) => issue.recommendedAction)
          .filter((action): action is string => Boolean(action)),
      ),
      port: runtimeConfig.port,
      chatModel: runtimeConfig.ollamaChatModel,
      embeddingModel: runtimeConfig.ollamaEmbeddingModel,
      chromaUrl: runtimeConfig.chromaUrl,
      chromaLatencyMs: chroma.latencyMs,
      capabilities: {
        query: {
          ready: queryReady,
          message: capabilitySummary("query", queryReady, blockers),
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
        ollama: {
          url: runtimeConfig.ollamaBaseUrl,
          chatModel: runtimeConfig.ollamaChatModel,
          embeddingModel: runtimeConfig.ollamaEmbeddingModel,
          ...ollama,
        },
        embeddings: embedding
          ? {
              model: runtimeConfig.ollamaEmbeddingModel,
              ...embedding,
            }
          : {
              model: runtimeConfig.ollamaEmbeddingModel,
              ok: false,
              latencyMs: 0,
              skipped: true,
            },
        chatGeneration: chatGeneration
          ? {
              model: runtimeConfig.ollamaChatModel,
              ...chatGeneration,
            }
          : {
              model: runtimeConfig.ollamaChatModel,
              ok: false,
              latencyMs: 0,
              skipped: true,
            },
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
    queryReady: payload.queryReady,
    indexReady: payload.indexReady,
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
      ollama: { ok: payload.dependencies.ollama.ok },
    },
    config: {
      port: payload.port,
      chatModel: payload.chatModel,
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
