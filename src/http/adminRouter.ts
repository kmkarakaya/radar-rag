import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import { startReindexJob } from "../indexing/jobs.js";
import type { RequestContext } from "./requestContext.js";
import type {
  CreateCollectionInput,
  IndexJob,
  IndexJobStatus,
  ListAuditLogInput,
  ListJobsInput,
  RagCollection,
  UpdateCollectionPatch,
} from "../collections/types.js";
import { collectionCreateSchema, collectionUpdateSchema } from "./collectionSchemas.js";
import {
  buildCreateCollectionInput,
  buildCreateValidationDraft,
  buildUpdateValidationDraft,
  validateCollectionDraft,
} from "./collectionValidation.js";
import { createAdminAuthService, type AdminAuthService } from "./adminAuth.js";
import {
  BUILTIN_EMBEDDING_SERVICE_ID,
  BUILTIN_EMBEDDING_SERVICE_NAME,
  builtinEmbeddingModelIds,
  desiredEmbeddingTarget,
  listConnectionModels,
  listEmbeddingModels,
  serverEmbeddingConnection,
  SERVER_EMBEDDING_SERVICE_ID,
  SERVER_EMBEDDING_SERVICE_NAME,
  type EmbeddingConnection,
  type EmbeddingProvider,
} from "../embeddings/index.js";
import { resolveEmbeddingTarget, serviceConnection } from "../embeddings/services.js";
import { assertEmbeddingAvailable } from "./modelAvailability.js";
import { deleteSourceChunks } from "../collections/chromaCollections.js";
import {
  MAX_FILES_PER_UPLOAD,
  UPLOAD_TEMP_PREFIX,
  checkUploadName,
  findCollectionFile,
  listCollectionFiles,
  placeUploadedFile,
  removeUploadsFolder,
  resolveCollectionFolder,
  resolveUploadsFolder,
  type RejectedUpload,
} from "../documents/collectionFiles.js";

type UploadRequest = Request & { uploadFolder?: string; rejectedUploads?: RejectedUpload[] };

const JOB_STATUS_VALUES = ["queued", "running", "succeeded", "failed", "cancelled"] as const satisfies readonly IndexJobStatus[];

// Strip the internal concurrency lock token before serializing a job to any API response.
function serializeJob({ lockToken, ...job }: IndexJob): Omit<IndexJob, "lockToken"> {
  return job;
}

export function createAdminRouter(deps: AppDependencies, runtimeConfig: ResolvedConfig = deps.runtimeConfig ?? config) {
  const router = express.Router();
  const adminAuth: AdminAuthService = deps.adminAuth ?? createAdminAuthService({
    config: runtimeConfig.adminAuth,
    env: process.env,
  });
  const adminLoginSchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
  }).strict();
  const adminActionTokenSchema = z.object({
    method: z.string().trim().min(1),
    path: z.string().trim().min(1),
  }).strict();

  const requireRegistry = (req: Request, _res: Response, next: NextFunction) => {
    if (!deps.registry) {
      next(new HttpError(500, "INTERNAL_ERROR", "Registry is not available"));
      return;
    }
    next();
  };

  const requireJobRunner = (req: Request, _res: Response, next: NextFunction) => {
    if (!deps.jobRunner) {
      next(new HttpError(500, "INTERNAL_ERROR", "Job Runner is not available"));
      return;
    }
    next();
  };

  const requireRead = adminAuth.requireCapability("read");
  const requireCreateCollection = adminAuth.requireCapability("createCollection");
  const requireValidateCollection = adminAuth.requireCapability("validateCollection");
  const requireUpdateCollection = adminAuth.requireCapability("updateCollection");
  const requireReindexCollection = adminAuth.requireCapability("reindexCollection");
  const requireCancelJob = adminAuth.requireCapability("cancelJob");
  const requireDeleteCollection = adminAuth.requireCapability("deleteCollection");
  const requireDeleteJob = adminAuth.requireCapability("deleteJob");
  const requireBulkDeleteJobs = adminAuth.requireCapability("bulkDeleteJobs");

  async function requireVisibleCollection(context: RequestContext, collectionId: string) {
    const collection = await deps.registry!.getVisibleCollection(context, collectionId);
    if (collection) {
      return collection;
    }

    const exists = await deps.registry!.collectionExists(collectionId);
    if (exists) {
      throw new HttpError(403, "COLLECTION_FORBIDDEN", "Collection access forbidden");
    }

    throw new HttpError(404, "COLLECTION_NOT_FOUND", "Collection not found");
  }

  function parseJobStatuses(input: unknown): IndexJobStatus[] {
    const rawValues = Array.isArray(input) ? input : input ? [input] : [];
    const statuses = rawValues
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    const valid = new Set<IndexJobStatus>();

    for (const status of statuses) {
      if (!JOB_STATUS_VALUES.includes(status as IndexJobStatus)) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", `Invalid job status filter: ${status}`);
      }
      valid.add(status as IndexJobStatus);
    }

    return [...valid];
  }

  function parseJobListQuery(query: Record<string, unknown>): ListJobsInput {
    const collectionId = typeof query.collectionId === "string" ? query.collectionId.trim() : undefined;
    const cursor = typeof query.cursor === "string" ? query.cursor.trim() : undefined;
    const limitRaw = query.limit;
    const limit = typeof limitRaw === "string" && limitRaw.trim() !== ""
      ? Number(limitRaw)
      : Array.isArray(limitRaw) && typeof limitRaw[0] === "string"
        ? Number(limitRaw[0])
        : undefined;

    if (limit !== undefined && (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0)) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job list limit.");
    }

    return {
      collectionId: collectionId || undefined,
      cursor: cursor || undefined,
      limit,
      statuses: parseJobStatuses(query.status),
    };
  }

  function parseAuditLogQuery(query: Record<string, unknown>): ListAuditLogInput {
    const cursor = typeof query.cursor === "string" ? query.cursor.trim() : undefined;
    const limitRaw = query.limit;
    const limit = typeof limitRaw === "string" && limitRaw.trim() !== ""
      ? Number(limitRaw)
      : Array.isArray(limitRaw) && typeof limitRaw[0] === "string"
        ? Number(limitRaw[0])
        : undefined;
    const collectionIds = normalizeStringList(query.collectionId);
    const operationValues = normalizeStringList(query.operation);

    if (limit !== undefined && (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0)) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid audit log limit.");
    }

    return {
      collectionId: collectionIds.length > 0 ? collectionIds : undefined,
      operation: operationValues.length > 0 ? operationValues : undefined,
      cursor: cursor || undefined,
      limit,
    };
  }

  function normalizeStringList(input: unknown): string[] {
    const rawValues = Array.isArray(input) ? input : input ? [input] : [];
    return [...new Set(
      rawValues
        .flatMap((value) => String(value).split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    )];
  }

  function parseJobDeleteBody(body: unknown): string[] {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job delete payload.");
    }

    const rawJobIds = (body as { jobIds?: unknown }).jobIds;
    if (!Array.isArray(rawJobIds)) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job delete payload.");
    }

    const jobIds = rawJobIds.map((value) => {
      if (typeof value !== "string") {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job delete payload.");
      }

      const trimmed = value.trim();
      if (!trimmed) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job delete payload.");
      }
      return trimmed;
    });

    const uniqueJobIds = [...new Set(jobIds)];
    if (uniqueJobIds.length === 0) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job delete payload.");
    }

    return uniqueJobIds;
  }

  router.post("/auth/login", async (req, res, next) => {
    try {
      if (!adminAuth.isEnabled()) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Admin auth is disabled.");
      }

      const parsed = adminLoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid admin login payload.", {
          issues: parsed.error.issues,
        });
      }

      const session = adminAuth.login(parsed.data.username, parsed.data.password);
      if (!session) {
        throw new HttpError(401, "UNAUTHORIZED", "Invalid admin credentials.");
      }

      adminAuth.setSessionCookie(res, session.sessionId);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        session: {
          username: session.username,
          role: session.role,
          tenantId: session.tenantId,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", async (req, res, next) => {
    try {
      adminAuth.logout(req, res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/session", async (req, res, next) => {
    try {
      if (!adminAuth.isEnabled()) {
        res.json({
          enabled: false,
          authenticated: false,
          session: null,
        });
        return;
      }

      const session = adminAuth.getSessionSummaryFromRequest(req);
      if (!session) {
        throw new HttpError(401, "UNAUTHORIZED", "Admin session required.");
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({
        enabled: true,
        authenticated: true,
        session,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/action-token", requireSessionIfEnabled, async (req, res, next) => {
    try {
      if (!adminAuth.isEnabled()) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Admin auth is disabled.");
      }

      const parsed = adminActionTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid admin action token payload.", {
          issues: parsed.error.issues,
        });
      }

      const session = res.locals.adminSessionRecord;
      if (!session) {
        throw new HttpError(401, "UNAUTHORIZED", "Admin session required.");
      }

      const token = adminAuth.createActionToken(session, parsed.data);
      res.setHeader("Cache-Control", "no-store");
      res.json(token);
    } catch (error) {
      next(error);
    }
  });

  function requireSessionIfEnabled(req: Request, res: Response, next: NextFunction): void {
    adminAuth.requireSession(req, res, next);
  }

  router.use(requireSessionIfEnabled);
  router.use((req, res, next) => {
    if (!adminAuth.isEnabled()) {
      next();
      return;
    }

    const requestPath = req.originalUrl.split("?")[0] || req.path;
    const match = adminAuth.matchAdminRoute(req.method, requestPath);
    if (!match) {
      next();
      return;
    }

    const session = (res.locals.adminSessionRecord as ReturnType<AdminAuthService["getSessionRecordFromRequest"]> | undefined)
      ?? adminAuth.getSessionRecordFromRequest(req);
    if (!session) {
      next(new HttpError(401, "UNAUTHORIZED", "Admin session required."));
      return;
    }
    if (!adminAuth.hasAdminCapability(session.role, match.capability)) {
      next(new HttpError(403, "FORBIDDEN", "Admin role does not allow this operation."));
      return;
    }

    const requestContext = res.locals.requestContext as RequestContext | undefined;
    if (requestContext) {
      res.locals.requestContext = {
        ...requestContext,
        tenantId: session.tenantId,
        userId: session.username,
      };
    }
    res.locals.adminSessionRecord = session;
    res.locals.adminSession = {
      username: session.username,
      role: session.role,
      tenantId: session.tenantId,
      expiresAt: session.expiresAt,
    };

    if (match.actionTokenRequired) {
      adminAuth.requireActionTokenFor(requestPath)(req, res, next);
      return;
    }

    next();
  });

  function getConfigDefaults() {
    return {
      collectionDefaults: {
        sourcePath: runtimeConfig.collectionDefaults.sourcePath,
        distanceMetric: runtimeConfig.chromaDistanceMetric,
        chunkSize: runtimeConfig.collectionDefaults.chunkSize,
        chunkOverlap: runtimeConfig.collectionDefaults.chunkOverlap,
        retrievalK: runtimeConfig.collectionDefaults.retrievalK,
        retrievalDistanceThreshold: runtimeConfig.collectionDefaults.retrievalDistanceThreshold,
      },
      // Embedding defaults for NEW collections; existing collections keep their own provider/model.
      modelDefaults: {
        embeddingProvider: runtimeConfig.embedding.provider,
        embeddingModel: runtimeConfig.embedding.model,
        // The "server" embedding service (RAG_EMBEDDING_BASE_URL / embedding.baseUrl); more via /embedding-services.
        embeddingServerConfigured: Boolean(runtimeConfig.embedding.baseUrl),
      },
      // Global, optional chat LLM for /query (set via onboarding or RAG_CHAT_*). The API key is never returned.
      chat: {
        enabled: runtimeConfig.chat.enabled,
        baseUrl: runtimeConfig.chat.baseUrl || null,
        model: runtimeConfig.chat.model || null,
        apiKeyConfigured: runtimeConfig.chat.apiKeySource !== "none",
      },
    };
  }

  // ---- Embedding services ----

  const httpUrlSchema = z.string().trim().url().refine(
    (value) => /^https?:\/\//i.test(value),
    "Use an http:// or https:// URL, for example http://host.docker.internal:11434/v1.",
  ).transform((value) => value.replace(/\/+$/, ""));
  const embeddingServiceCreateSchema = z.object({
    name: z.string().trim().min(1).max(100),
    baseUrl: httpUrlSchema,
    apiKey: z.string().trim().min(1).max(1000).optional(),
  }).strict();
  const embeddingServiceUpdateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    baseUrl: httpUrlSchema.optional(),
    /** A new key; null removes it; omitted keeps it. */
    apiKey: z.string().trim().min(1).max(1000).nullable().optional(),
  }).strict();
  const embeddingServiceTestSchema = z.union([
    z.object({ serviceId: z.string().trim().min(1) }).strict(),
    z.object({ baseUrl: httpUrlSchema, apiKey: z.string().trim().min(1).max(1000).optional() }).strict(),
  ]);

  function managementWarnings(): string[] {
    return runtimeConfig.adminAuth.enabled
      ? []
      : ["Admin auth is off: anyone who can reach this server can change where documents are sent for embedding. "
        + "Turn on admin auth before other people can reach it."];
  }

  async function serializeEmbeddingServices(context: RequestContext) {
    const services = await deps.registry!.listEmbeddingServices(context);
    const server = serverEmbeddingConnection(runtimeConfig);
    const serverUsers = await deps.registry!.listCollectionsUsingEmbeddingService(context, SERVER_EMBEDDING_SERVICE_ID);
    const builtinUsers = await deps.registry!.listCollectionsUsingEmbeddingService(context, BUILTIN_EMBEDDING_SERVICE_ID);
    const stored = await Promise.all(services.map(async (service) => ({
      id: service.id,
      name: service.displayName,
      baseUrl: service.baseUrl,
      apiKeyConfigured: Boolean(service.apiKey),
      source: "panel" as const,
      readOnly: false,
      configured: true,
      collectionCount: (await deps.registry!.listCollectionsUsingEmbeddingService(context, service.id)).length,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    })));
    return [
      {
        // The built-in model runs inside the backend: no URL or key. Listed so its models and users are visible;
        // collections pick it with embeddingProvider "builtin", not with embeddingServiceId.
        id: BUILTIN_EMBEDDING_SERVICE_ID,
        name: BUILTIN_EMBEDDING_SERVICE_NAME,
        baseUrl: null,
        apiKeyConfigured: false,
        source: "builtin" as const,
        readOnly: true,
        configured: true,
        collectionCount: builtinUsers.length,
        models: builtinEmbeddingModelIds(),
      },
      {
        id: SERVER_EMBEDDING_SERVICE_ID,
        name: SERVER_EMBEDDING_SERVICE_NAME,
        baseUrl: server?.baseUrl ?? null,
        apiKeyConfigured: Boolean(server?.apiKey),
        source: "server" as const,
        readOnly: true,
        configured: Boolean(server),
        collectionCount: serverUsers.length,
      },
      ...stored,
    ];
  }

  async function requireEmbeddingService(context: RequestContext, serviceId: string) {
    if (serviceId === BUILTIN_EMBEDDING_SERVICE_ID) {
      throw new HttpError(
        409,
        "EMBEDDING_SERVICE_READ_ONLY",
        "The built-in model is part of the backend; it cannot be changed or deleted.",
      );
    }
    if (serviceId === SERVER_EMBEDDING_SERVICE_ID) {
      throw new HttpError(
        409,
        "EMBEDDING_SERVICE_READ_ONLY",
        "The server embedding service comes from .env / config (RAG_EMBEDDING_BASE_URL, embedding.baseUrl); change it there.",
      );
    }
    const service = await deps.registry!.getEmbeddingService(context, serviceId);
    if (!service) {
      throw new HttpError(404, "EMBEDDING_SERVICE_NOT_FOUND", `Embedding service ${serviceId} was not found.`);
    }
    return service;
  }

  async function assertUniqueServiceName(context: RequestContext, name: string, exceptId?: string) {
    const clash = (await deps.registry!.listEmbeddingServices(context))
      .find((service) => service.displayName.toLowerCase() === name.toLowerCase() && service.id !== exceptId);
    const reserved = [SERVER_EMBEDDING_SERVICE_NAME, BUILTIN_EMBEDDING_SERVICE_NAME].map((item) => item.toLowerCase());
    if (clash || reserved.includes(name.toLowerCase())) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", `An embedding service named "${name}" already exists.`);
    }
  }

  /**
   * The embedding service a collection uses. Given: it must exist for the tenant ("server" always does).
   * Not given, on create: "server" when configured, else the tenant's only service, else "server"
   * (the preflight then reports that no service is configured).
   */
  async function chooseEmbeddingService(
    context: RequestContext,
    provider: EmbeddingProvider,
    requested: string | null | undefined,
    mode: "create" | "update",
  ): Promise<string | null | undefined> {
    if (provider !== "openai-compatible") {
      if (requested) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "embeddingServiceId only applies to the openai-compatible provider.");
      }
      return mode === "create" ? undefined : requested;
    }
    if (requested === BUILTIN_EMBEDDING_SERVICE_ID) {
      throw new HttpError(
        400,
        "INVALID_REQUEST_BODY",
        'The built-in model is not an embedding service: use "embeddingProvider": "builtin" without embeddingServiceId.',
      );
    }
    if (requested) {
      if (requested !== SERVER_EMBEDDING_SERVICE_ID && !(await deps.registry!.getEmbeddingService(context, requested))) {
        throw new HttpError(404, "EMBEDDING_SERVICE_NOT_FOUND", `Embedding service ${requested} was not found.`);
      }
      return requested;
    }
    if (mode === "update") return requested;
    if (serverEmbeddingConnection(runtimeConfig)) return SERVER_EMBEDDING_SERVICE_ID;
    const services = await deps.registry!.listEmbeddingServices(context);
    if (services.length === 1) return services[0].id;
    if (services.length > 1) {
      throw new HttpError(
        400,
        "INVALID_REQUEST_BODY",
        `Choose the embedding service with embeddingServiceId: ${services.map((service) => service.id).join(", ")}.`,
      );
    }
    return SERVER_EMBEDDING_SERVICE_ID;
  }

  /**
   * Checks an update's embedding service like a create: a given id must exist for the tenant and only goes with
   * openai-compatible. Switching a collection to openai-compatible without an id picks the default the same way
   * a create does, so PATCH and POST never disagree.
   */
  async function withUpdateEmbeddingService(
    context: RequestContext,
    existing: RagCollection,
    patch: UpdateCollectionPatch,
  ): Promise<UpdateCollectionPatch> {
    if (patch.embeddingServiceId === undefined && patch.embeddingProvider === undefined) return patch;
    const provider = patch.embeddingProvider ?? existing.embeddingProvider;
    const switchingToExternal = provider === "openai-compatible" && existing.embeddingProvider !== "openai-compatible";
    const chosen = await chooseEmbeddingService(
      context,
      provider,
      patch.embeddingServiceId,
      switchingToExternal ? "create" : "update",
    );
    return chosen && chosen !== patch.embeddingServiceId ? { ...patch, embeddingServiceId: chosen } : patch;
  }

  router.get("/embedding-services", requireRegistry, async (_req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      res.json({ services: await serializeEmbeddingServices(context), warnings: managementWarnings() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/embedding-services/test", requireRegistry, async (req, res, next) => {
    try {
      const parsed = embeddingServiceTestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Send { serviceId } or { baseUrl, apiKey? }.", { issues: parsed.error.issues });
      }
      const context = res.locals.requestContext as RequestContext;
      let connection: EmbeddingConnection;
      let name: string;
      if ("serviceId" in parsed.data) {
        if (parsed.data.serviceId === BUILTIN_EMBEDDING_SERVICE_ID) {
          throw new HttpError(
            400,
            "INVALID_REQUEST_BODY",
            "The built-in model runs inside the backend; there is no connection to test.",
          );
        }
        if (parsed.data.serviceId === SERVER_EMBEDDING_SERVICE_ID) {
          const server = serverEmbeddingConnection(runtimeConfig);
          if (!server) {
            throw new HttpError(404, "EMBEDDING_SERVICE_NOT_FOUND", "No server embedding service is configured (RAG_EMBEDDING_BASE_URL).");
          }
          connection = server;
          name = SERVER_EMBEDDING_SERVICE_NAME;
        } else {
          const service = await deps.registry!.getEmbeddingService(context, parsed.data.serviceId);
          if (!service) {
            throw new HttpError(404, "EMBEDDING_SERVICE_NOT_FOUND", `Embedding service ${parsed.data.serviceId} was not found.`);
          }
          connection = serviceConnection(service);
          name = service.displayName;
        }
      } else {
        connection = { serviceId: "test", baseUrl: parsed.data.baseUrl, apiKey: parsed.data.apiKey, version: `test:${Date.now()}` };
        name = "Connection test";
      }
      // A free GET {baseUrl}/models: never runs an embedding; the key is never part of the response.
      const result = await (deps.healthChecks?.checkEmbeddingConnection ?? listConnectionModels)(
        runtimeConfig,
        connection,
        name,
        { useCache: false },
      );
      res.json({ ...result, ok: result.reachable && result.authOk });
    } catch (error) {
      next(error);
    }
  });

  router.post("/embedding-services", requireRegistry, async (req, res, next) => {
    try {
      const parsed = embeddingServiceCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid embedding service", { issues: parsed.error.issues });
      }
      const context = res.locals.requestContext as RequestContext;
      await assertUniqueServiceName(context, parsed.data.name);
      const service = await deps.registry!.createEmbeddingService(context, {
        displayName: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
      });
      const serialized = (await serializeEmbeddingServices(context)).find((item) => item.id === service.id);
      res.status(201).json({ service: serialized, warnings: managementWarnings() });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/embedding-services/:serviceId", requireRegistry, async (req, res, next) => {
    try {
      const serviceId = req.params.serviceId as string;
      const parsed = embeddingServiceUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid embedding service update", { issues: parsed.error.issues });
      }
      const context = res.locals.requestContext as RequestContext;
      await requireEmbeddingService(context, serviceId);
      if (parsed.data.name !== undefined) await assertUniqueServiceName(context, parsed.data.name, serviceId);
      await deps.registry!.updateEmbeddingService(context, serviceId, {
        displayName: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
      });
      const serialized = (await serializeEmbeddingServices(context)).find((item) => item.id === serviceId);
      res.json({ service: serialized, warnings: managementWarnings() });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/embedding-services/:serviceId", requireRegistry, async (req, res, next) => {
    try {
      const serviceId = req.params.serviceId as string;
      const context = res.locals.requestContext as RequestContext;
      await requireEmbeddingService(context, serviceId);
      const users = await deps.registry!.listCollectionsUsingEmbeddingService(context, serviceId);
      if (users.length > 0) {
        throw new HttpError(
          409,
          "EMBEDDING_SERVICE_IN_USE",
          `Embedding service ${serviceId} is used by ${users.length} collection(s); switch them to another service (and re-index) or delete them first.`,
          { collections: users },
        );
      }
      await deps.registry!.deleteEmbeddingService(context, serviceId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections", requireRegistry, async (req, res, next) => {
    try {
      const parsed = collectionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid collection configuration", {
          issues: parsed.error.issues,
        });
      }

      const context = res.locals.requestContext as RequestContext;

      const input: CreateCollectionInput = buildCreateCollectionInput(parsed.data, runtimeConfig);
      const provider = input.embeddingProvider ?? runtimeConfig.embedding.provider;
      input.embeddingServiceId = (await chooseEmbeddingService(context, provider, parsed.data.embeddingServiceId, "create")) ?? undefined;

      await assertEmbeddingAvailable({
        runtimeConfig,
        target: await resolveEmbeddingTarget({
          registry: deps.registry,
          runtimeConfig,
          context,
          target: { provider, model: input.embeddingModel, serviceId: input.embeddingServiceId },
        }),
        action: "Collection cannot be created.",
        check: deps.healthChecks?.checkEmbeddingTarget,
      });

      const collection = await deps.registry!.createCollection(context, input);
      res.status(201).json({
        collection: {
          id: collection.id,
          displayName: collection.displayName,
          status: collection.status,
          ...(collection.embeddingServiceId ? { embeddingServiceId: collection.embeddingServiceId } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/config/defaults", async (_req, res, next) => {
    try {
      res.json(getConfigDefaults());
    } catch (error) {
      next(error);
    }
  });

  router.get("/models", async (_req, res, next) => {
    try {
      // Embedding model suggestions: builtin catalog plus GET /models of every embedding service of the tenant.
      const context = res.locals.requestContext as RequestContext;
      const services = deps.registry
        ? (await deps.registry.listEmbeddingServices(context)).map((service) => ({
          connection: serviceConnection(service),
          name: service.displayName,
        }))
        : [];
      res.json(await (deps.healthChecks?.listEmbeddingModels ?? listEmbeddingModels)(runtimeConfig, { services }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/collections/:collectionId", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      const collection = await requireVisibleCollection(context, collectionId);
      res.json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.get("/collections/:collectionId/physical-collections", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      await requireVisibleCollection(context, collectionId);
      const physicalCollections = await deps.registry!.listPhysicalCollectionsForCollection(context, collectionId);
      res.setHeader("Cache-Control", "no-store");
      res.locals.collectionId = collectionId;
      res.json({
        collectionId,
        physicalCollections,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/audit-log", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const filters = parseAuditLogQuery(req.query as Record<string, unknown>);
      const listAuditLog = deps.registry!.listAuditLog;

      if (filters.collectionId && filters.collectionId.length > 0) {
        for (const collectionId of filters.collectionId) {
          await requireVisibleCollection(context, collectionId);
        }
      }

      if (!listAuditLog) {
        throw new HttpError(500, "INTERNAL_ERROR", "Audit log persistence is not available");
      }

      const result = await deps.registry!.listAuditLog!(context, filters);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        auditLog: result.auditLog,
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid audit log cursor.") {
        next(new HttpError(400, "INVALID_REQUEST_BODY", "Invalid audit log cursor."));
        return;
      }
      next(error);
    }
  });

  router.post("/collections/validate", requireRegistry, async (req, res, next) => {
    try {
      const parsed = collectionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid collection configuration", {
          issues: parsed.error.issues,
        });
      }

      const context = res.locals.requestContext as RequestContext;
      const input = buildCreateCollectionInput(parsed.data, runtimeConfig);
      input.embeddingServiceId = (await chooseEmbeddingService(
        context,
        input.embeddingProvider ?? runtimeConfig.embedding.provider,
        parsed.data.embeddingServiceId,
        "create",
      )) ?? undefined;
      const validation = await validateCollectionDraft(
        buildCreateValidationDraft(input),
        runtimeConfig,
        deps.registry!,
        context,
        deps.healthChecks,
      );
      res.json(validation);
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections/:collectionId/validate", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      const collection = await requireVisibleCollection(context, collectionId);
      const parsed = collectionUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid collection update payload", {
          issues: parsed.error.issues,
        });
      }

      const validation = await validateCollectionDraft(
        buildUpdateValidationDraft(collection, await withUpdateEmbeddingService(context, collection, parsed.data)),
        runtimeConfig,
        deps.registry!,
        context,
        deps.healthChecks,
      );
      res.json(validation);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/collections/:collectionId", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const parsed = collectionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid collection update payload", {
          issues: parsed.error.issues,
        });
      }

      const context = res.locals.requestContext as RequestContext;
      const existing = await requireVisibleCollection(context, collectionId);
      const patch = await withUpdateEmbeddingService(context, existing, parsed.data);
      if (existing.sourceKind === "uploads" && parsed.data.sourcePath !== undefined && parsed.data.sourcePath !== existing.sourcePath) {
        throw new HttpError(
          400,
          "INVALID_REQUEST_BODY",
          "This collection stores uploaded documents in its own folder; its sourcePath cannot be changed.",
        );
      }
      const collection = await deps.registry!.updateCollection(context, collectionId, patch);
      res.json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/collections/:collectionId", requireRegistry, requireJobRunner, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      const collection = await requireVisibleCollection(context, collectionId);

      const cancelledJobIds = await deps.registry!.deleteCollection(context, collectionId);
      for (const jobId of cancelledJobIds) {
        await deps.jobRunner!.abort(jobId);
      }

      // Uploaded documents belong to the collection; a folder collection's files are never touched.
      if (collection.sourceKind === "uploads") {
        await removeUploadsFolder(
          resolveCollectionFolder(collection.sourcePath, runtimeConfig.projectRoot),
          runtimeConfig.uploadsDir,
        );
      }

      res.locals.collectionId = collectionId;
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ---- Documents of a collection (files API) ----

  router.get("/collections/:collectionId/files", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      const collection = await requireVisibleCollection(context, collectionId);
      const folder = resolveCollectionFolder(collection.sourcePath, runtimeConfig.projectRoot);
      const files = await listCollectionFiles(folder, runtimeConfig);
      res.json({
        collectionId,
        sourceKind: collection.sourceKind,
        writable: collection.sourceKind === "uploads",
        files,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        indexState: collection.indexState,
      });
    } catch (error) {
      next(error);
    }
  });

  /** Checks shared by upload and delete: visible, an uploads collection, and no index job reading the folder. */
  async function requireWritableCollection(context: RequestContext, collectionId: string) {
    const collection = await requireVisibleCollection(context, collectionId);
    if (collection.sourceKind !== "uploads") {
      throw new HttpError(
        409,
        "COLLECTION_FILES_READ_ONLY",
        "This collection reads a folder on the server; manage its files there. Create a collection without a sourcePath to upload documents.",
      );
    }
    const activeJob = await deps.registry!.getActiveJobForCollection(context, collectionId);
    if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
      throw new HttpError(
        409,
        "COLLECTION_INDEX_ALREADY_RUNNING",
        `Index job ${activeJob.id} is ${activeJob.status}; change documents after it finishes.`,
        { jobId: activeJob.id, status: activeJob.status },
      );
    }
    return { collection, folder: resolveUploadsFolder(collection.sourcePath, runtimeConfig) };
  }

  const uploadParser = multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => callback(null, (req as UploadRequest).uploadFolder as string),
      // Hidden temp name: scans skip it, and a failed upload never replaces an existing document.
      filename: (_req, _file, callback) => callback(null, `${UPLOAD_TEMP_PREFIX}${randomUUID()}`),
    }),
    // File names are sent as UTF-8 by browsers and curl; the multer default (latin1) garbles e.g. Turkish names.
    defParamCharset: "utf8",
    limits: {
      fileSize: runtimeConfig.uploadMaxFileSizeBytes,
      files: MAX_FILES_PER_UPLOAD,
      fields: 10,
    },
    fileFilter: (req, file, callback) => {
      const checked = checkUploadName(file.originalname);
      if (!checked.ok) {
        const uploadReq = req as UploadRequest;
        (uploadReq.rejectedUploads ??= []).push({ name: file.originalname, code: checked.code, reason: checked.reason });
        callback(null, false);
        return;
      }
      callback(null, true);
    },
  }).array("files", MAX_FILES_PER_UPLOAD);

  function parseUpload(req: Request, res: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      uploadParser(req, res, (error: unknown) => {
        if (!error) {
          resolve();
          return;
        }
        if (error instanceof multer.MulterError) {
          if (error.code === "LIMIT_FILE_SIZE") {
            const limitMb = Math.round(runtimeConfig.uploadMaxFileSizeBytes / (1024 * 1024));
            reject(new HttpError(413, "FILE_TOO_LARGE", `A file is larger than the limit of ${limitMb} MB (uploads.maxFileSizeMb).`));
            return;
          }
          if (error.code === "LIMIT_FILE_COUNT") {
            reject(new HttpError(400, "TOO_MANY_FILES", `Send at most ${MAX_FILES_PER_UPLOAD} files per request.`));
            return;
          }
          if (error.code === "LIMIT_UNEXPECTED_FILE") {
            reject(new HttpError(400, "INVALID_REQUEST_BODY", `Send the documents as multipart/form-data in the "files" field.`));
            return;
          }
          reject(new HttpError(400, "INVALID_REQUEST_BODY", `Invalid upload: ${error.message}`));
          return;
        }
        reject(error);
      });
    });
  }

  router.post("/collections/:collectionId/files", requireRegistry, async (req, res, next) => {
    const uploadReq = req as UploadRequest;
    let received: Express.Multer.File[] = [];
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      if (!req.is("multipart/form-data")) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", `Send the documents as multipart/form-data in the "files" field.`);
      }
      const { folder } = await requireWritableCollection(context, collectionId);
      await fs.mkdir(folder, { recursive: true });
      uploadReq.uploadFolder = folder;

      await parseUpload(req, res);
      received = (req.files as Express.Multer.File[] | undefined) ?? [];
      const rejected = uploadReq.rejectedUploads ?? [];
      if (received.length === 0) {
        if (rejected.length > 0) {
          throw new HttpError(400, "UNSUPPORTED_FILE", "None of the files can be indexed.", { rejected });
        }
        throw new HttpError(400, "INVALID_REQUEST_BODY", `No files received. Send them as multipart/form-data in the "files" field.`);
      }

      const uploaded: Array<{ name: string; sizeBytes: number; replaced: boolean }> = [];
      for (const file of received) {
        const checked = checkUploadName(file.originalname);
        if (!checked.ok) continue; // already filtered by fileFilter; kept for type narrowing
        const replaced = await fs.stat(path.join(folder, checked.name)).then(() => true, () => false);
        await placeUploadedFile(folder, file.path, checked.name);
        uploaded.push({ name: checked.name, sizeBytes: file.size, replaced });
      }

      await deps.registry!.markDocumentsChanged(context, collectionId);
      const collection = await requireVisibleCollection(context, collectionId);
      res.locals.collectionId = collectionId;
      res.status(201).json({ collectionId, uploaded, rejected, indexState: collection.indexState });
    } catch (error) {
      next(error);
    } finally {
      // Temp files that were not renamed (an error part-way) are removed; renamed ones are already gone.
      await Promise.all(received.map((file) => fs.rm(file.path, { force: true }).catch(() => {})));
    }
  });

  router.delete("/collections/:collectionId/files/:fileName", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const fileName = req.params.fileName as string;
      const context = res.locals.requestContext as RequestContext;
      const { collection, folder } = await requireWritableCollection(context, collectionId);
      const filePath = await findCollectionFile(folder, fileName);
      if (!filePath) {
        throw new HttpError(404, "DOCUMENT_NOT_FOUND", `Document ${fileName} was not found in this collection.`);
      }

      // A deleted document must leave search results right away, not only after the next re-index
      // (which is impossible once the last document is gone). Remove its chunks from the active index
      // first; if that fails, nothing is deleted and the request can be retried.
      let removed = { chunkCount: 0, documentCount: 0 };
      if (collection.activePhysicalCollection) {
        try {
          removed = await (deps.documentIndex?.deleteSourceChunks ?? deleteSourceChunks)({
            name: collection.activePhysicalCollection,
            sourcePath: filePath,
            runtimeConfig,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new HttpError(
            503,
            "COLLECTION_STORAGE_INCONSISTENT",
            `The document could not be removed from the search index, so it was not deleted. Check that Chroma is running and try again. (${reason})`,
            { physicalCollection: collection.activePhysicalCollection },
          );
        }
      }

      await fs.rm(filePath);
      if (removed.chunkCount > 0) {
        await deps.registry!.updateCollection(context, collectionId, {
          chunkCount: Math.max(0, (collection.chunkCount ?? 0) - removed.chunkCount),
          documentCount: Math.max(0, (collection.documentCount ?? 0) - removed.documentCount),
        });
      }
      res.locals.collectionId = collectionId;
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections/:collectionId/reindex", requireRegistry, requireJobRunner, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      const collection = await requireVisibleCollection(context, collectionId);

      // Report an in-flight job before probing Ollama. beginIndexJob still enforces this atomically.
      const activeJob = await deps.registry!.getActiveJobForCollection(context, collectionId);
      if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
        throw new HttpError(
          409,
          "COLLECTION_INDEX_ALREADY_RUNNING",
          `Collection ${collectionId} already has a ${activeJob.status} index job (${activeJob.id}).`,
          { jobId: activeJob.id, status: activeJob.status },
        );
      }

      // Indexing only needs the embedding model; the optional chat LLM is never involved.
      // The job builds with the collection's desired (saved) embedding.
      await assertEmbeddingAvailable({
        runtimeConfig,
        // The job builds with the collection's saved embedding and its service.
        target: await resolveEmbeddingTarget({
          registry: deps.registry,
          runtimeConfig,
          context,
          target: desiredEmbeddingTarget(collection),
        }),
        action: "Re-index cannot start.",
        check: deps.healthChecks?.checkEmbeddingTarget,
      });

      const job = await startReindexJob({
        registry: deps.registry!,
        collectionId,
        context,
        runtimeConfig,
      });

      deps.jobRunner!.start(job.id);
      res.locals.collectionId = collectionId;
      res.locals.jobId = job.id;
      res.locals.physicalCollection = job.targetPhysicalCollection;

      res.status(202).json({
        job: {
          id: job.id,
          collectionId: job.collectionId,
          status: job.status,
          targetPhysicalCollection: job.targetPhysicalCollection,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/jobs", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const filters = parseJobListQuery(req.query as Record<string, unknown>);
      const result = await deps.registry!.listJobs(context, filters);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        jobs: result.jobs.map((item) => ({ ...item, job: serializeJob(item.job) })),
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid job cursor.") {
        next(new HttpError(400, "INVALID_REQUEST_BODY", "Invalid job cursor."));
        return;
      }
      next(error);
    }
  });

  router.get("/jobs/:jobId", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const job = await deps.registry!.getJob(req.params.jobId as string);
      if (!job || job.tenantId !== context.tenantId) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
      }
      res.setHeader("Cache-Control", "no-store");
      res.locals.collectionId = job.collectionId;
      res.locals.jobId = job.id;
      res.locals.physicalCollection = job.targetPhysicalCollection;
      res.json({ job: serializeJob(job) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/jobs/:jobId/events", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const jobId = req.params.jobId as string;
      const job = await deps.registry!.getJob(jobId);
      if (!job || job.tenantId !== context.tenantId) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
      }

      const events = await deps.registry!.listJobEvents(context, jobId);
      res.setHeader("Cache-Control", "no-store");
      res.locals.collectionId = job.collectionId;
      res.locals.jobId = job.id;
      res.locals.physicalCollection = job.targetPhysicalCollection;
      res.json({
        jobId: job.id,
        events,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/jobs/:jobId", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const jobId = req.params.jobId as string;
      const job = await deps.registry!.getJob(jobId);
      if (!job || job.tenantId !== context.tenantId) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
      }

      if (job.status === "queued" || job.status === "running") {
        throw new HttpError(400, "INVALID_JOB_STATUS", "Only terminal jobs can be deleted.");
      }

      res.locals.collectionId = job.collectionId;
      res.locals.jobId = job.id;
      res.locals.physicalCollection = job.targetPhysicalCollection;

      await deps.registry!.deleteJob(context, jobId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/bulk-delete", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const jobIds = parseJobDeleteBody(req.body);
      const jobs = await Promise.all(jobIds.map((jobId) => deps.registry!.getJob(jobId)));

      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const jobId = jobIds[index]!;
        if (!job || job.tenantId !== context.tenantId) {
          throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
        }

        if (job.status === "queued" || job.status === "running") {
          throw new HttpError(400, "INVALID_JOB_STATUS", "Only terminal jobs can be deleted.");
        }
      }

      await deps.registry!.deleteJobs(context, jobIds);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/:jobId/cancel", requireRegistry, requireJobRunner, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const jobId = req.params.jobId as string;
      const job = await deps.registry!.getJob(jobId);
      if (!job || job.tenantId !== context.tenantId) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
      }

      if (job.status !== "queued" && job.status !== "running") {
        throw new HttpError(400, "INVALID_JOB_STATUS", "Only queued or running jobs can be cancelled.");
      }

      await deps.jobRunner!.abort(jobId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
