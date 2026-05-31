import path from "node:path";
import express, { type Express } from "express";
import type { CollectionRegistry } from "./collections/types.js";
import { config } from "./config.js";
import { errorHandler, notFoundHandler, sendErrorResponse } from "./http/errors.js";
import { createRequestContext } from "./http/requestContext.js";
import { checkIndexingSourceHealth, type IndexingSourceHealthDetails } from "./index.js";
import { createAdminRouter } from "./http/adminRouter.js";
import { createRagRouter } from "./http/ragRouter.js";
import {
  checkChatGenerationHealth,
  checkChromaHealth,
  checkEmbeddingHealth,
  checkOllamaHealth,
  type ChatGenerationHealthDetails,
  type EmbeddingHealthDetails,
  type OllamaHealthDetails,
} from "./rag.js";

export type AppDependencies = {
  registry?: CollectionRegistry;
};

type Capability = "query" | "index";
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

type ReadinessIssue = {
  code: string;
  capabilities: Capability[];
  message: string;
  details?: Record<string, unknown>;
  recommendedAction?: string;
};

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();
  app.locals.dependencies = deps;
  configureApp(app);
  return app;
}

function configureApp(app: Express): void {
  app.use((req, res, next) => {
    res.locals.requestContext = createRequestContext(req);
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
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

  app.use("/v1/admin", createAdminRouter(app.locals.dependencies));
  app.use("/v1/rag", createRagRouter(app.locals.dependencies));

  app.use("/test-frontend", express.static(path.resolve(process.cwd(), "test_frontend")));

async function getReadinessPayload() {
  const [chroma, ollama, dataSource] = await Promise.all([
    checkChromaHealth(),
    checkOllamaHealth(),
    checkIndexingSourceHealth(),
  ]);
  const ollamaDetails = (ollama.details ?? {}) as Partial<OllamaHealthDetails>;
  const dataSourceDetails = (dataSource.details ?? {}) as Partial<IndexingSourceHealthDetails>;
  const chromaReachable = chroma.ok;

  const embedding = ollama.ok && ollamaDetails.embeddingModelAvailable
    ? await checkEmbeddingHealth()
    : null;
  const chatGeneration = ollama.ok && ollamaDetails.chatModelAvailable
    ? await checkChatGenerationHealth()
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
      ? `Chroma is reachable at ${config.chromaUrl}.`
      : `Chroma is not reachable at ${config.chromaUrl}. ${chroma.error ?? ""}`.trim(),
    details: {
      url: config.chromaUrl,
      latencyMs: chroma.latencyMs,
      error: chroma.error,
    },
  });

  checks.push({
    code: ollama.ok ? "OLLAMA_REACHABLE" : "OLLAMA_UNREACHABLE",
    name: "Ollama reachability",
    status: ollama.ok ? "pass" : "fail",
    blocking: true,
    capabilities: ["query", "index"],
    message: ollama.ok
      ? `Ollama is reachable at ${config.ollamaBaseUrl}.`
      : `Ollama is not reachable at ${config.ollamaBaseUrl}. ${ollama.error ?? ""}`.trim(),
    details: {
      url: config.ollamaBaseUrl,
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
        ? `Chat model ${config.ollamaChatModel} is available in Ollama.`
        : `Chat model ${config.ollamaChatModel} is missing in Ollama, so answer generation cannot run.`,
      details: {
        model: config.ollamaChatModel,
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
        ? `Embedding model ${config.ollamaEmbeddingModel} is available in Ollama.`
        : `Embedding model ${config.ollamaEmbeddingModel} is missing in Ollama, so retrieval and indexing embeddings cannot run.`,
      details: {
        model: config.ollamaEmbeddingModel,
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
        probeText: config.readyEmbedProbeText,
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
        probeText: embeddingDetails.probeText ?? config.readyEmbedProbeText,
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
        probeText: config.readyChatProbeText,
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
        probeText: chatGenerationDetails.probeText ?? config.readyChatProbeText,
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
      ? `Indexing source is readable at ${config.sourcePath}.`
      : `Indexing source cannot be read at ${config.sourcePath}. ${dataSource.error ?? ""}`.trim(),
    details: {
      sourcePath: config.sourcePath,
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
        sourcePath: config.sourcePath,
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
        message: `Indexing currently uses only the first ${dataSourceDetails.documentCount} documents because data.indexSampleSize is set to ${dataSourceDetails.indexSampleSize}.`,
        details: {
          sourcePath: config.sourcePath,
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
      recommendedAction: recommendedActionFor(check.code),
    } satisfies ReadinessIssue));

  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => ({
      code: check.code,
      capabilities: check.capabilities,
      message: check.message,
      details: check.details,
      recommendedAction: recommendedActionFor(check.code),
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
      port: config.port,
      chatModel: config.ollamaChatModel,
      embeddingModel: config.ollamaEmbeddingModel,
      chromaUrl: config.chromaUrl,
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
          url: config.chromaUrl,
          ...chroma,
        },
        ollama: {
          url: config.ollamaBaseUrl,
          chatModel: config.ollamaChatModel,
          embeddingModel: config.ollamaEmbeddingModel,
          ...ollama,
        },
        embeddings: embedding
          ? {
              model: config.ollamaEmbeddingModel,
              ...embedding,
            }
          : {
              model: config.ollamaEmbeddingModel,
              ok: false,
              latencyMs: 0,
              skipped: true,
            },
        chatGeneration: chatGeneration
          ? {
              model: config.ollamaChatModel,
              ...chatGeneration,
            }
          : {
              model: config.ollamaChatModel,
              ok: false,
              latencyMs: 0,
              skipped: true,
            },
      },
      dataSource: {
        path: config.sourcePath,
        ...dataSource,
      },
    },
  };
}

function recommendedActionFor(code: string): string | undefined {
  switch (code) {
    case "CHROMA_UNREACHABLE":
      return "Start Chroma and verify config/rag.config.yaml chroma.url is correct.";
    case "COLLECTION_MISSING":
    case "COLLECTION_EMPTY":
      return "Run npm run index to create or populate the Chroma collection before sending RAG queries.";
    case "COLLECTION_STATE_UNREADABLE":
      return "Inspect the Chroma collection state and verify the collection can be counted.";
    case "OLLAMA_UNREACHABLE":
      return "Start Ollama and verify config/rag.config.yaml ollama.baseUrl is correct.";
    case "CHAT_MODEL_MISSING":
      return `Pull the chat model with: ollama pull ${config.ollamaChatModel}`;
    case "EMBED_MODEL_MISSING":
      return `Pull the embedding model with: ollama pull ${config.ollamaEmbeddingModel}`;
    case "EMBED_SMOKE_FAILED":
      return "Verify Ollama embedding inference is working and that the embedding model can generate vectors.";
    case "CHAT_SMOKE_FAILED":
      return "Verify Ollama chat generation can load the configured model. If Ollama reports memory allocation errors, reduce config/rag.config.yaml ollama.numCtx, ollama.numPredict, or rag.retrievalK, then restart Ollama and the backend.";
    case "INDEXING_SOURCE_UNREADABLE":
      return "Verify config/rag.config.yaml data.sourcePath points to a readable file or directory.";
    case "NO_INDEXABLE_DOCUMENTS":
      return "Verify the configured indexing source contains supported files with non-empty document content before running indexing.";
    case "INDEX_SAMPLE_LIMIT_ACTIVE":
      return "Increase config/rag.config.yaml data.indexSampleSize, or set it to 0, if you want indexing to cover more of the source dataset.";
    default:
      return undefined;
  }
}

function capabilitySummary(capability: Capability, ready: boolean, blockers: ReadinessIssue[]): string {
  if (ready) {
    return capability === "query"
      ? "Ready to serve RAG queries."
      : "Ready to run indexing from the configured data source.";
  }

  const relevantBlockers = blockers.filter((issue) => issue.capabilities.includes(capability));
  if (relevantBlockers.length === 0) {
    return capability === "query"
      ? "Not ready to serve RAG queries."
      : "Not ready to run indexing from the configured data source.";
  }

  return relevantBlockers.map((issue) => issue.message).join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    alive: true,
    port: config.port,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (req, res) => {
  const { ready, payload } = await getReadinessPayload();
  const includeDetails = truthyQuery(req.query.details) || truthyQuery(req.query.verbose);
  const strictHttpStatus = truthyQuery(req.query.strict);
  const responsePayload = includeDetails ? payload : summarizeReadinessPayload(payload);

  res.status(strictHttpStatus && !ready ? 503 : 200).json(responsePayload);
});

app.use(notFoundHandler);
app.use(errorHandler);
}
