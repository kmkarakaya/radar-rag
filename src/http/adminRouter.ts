import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import { startReindexJob } from "../indexing/jobs.js";
import type { RequestContext } from "./requestContext.js";
import type { CreateCollectionInput, IndexJob, IndexJobStatus, ListAuditLogInput, ListJobsInput } from "../collections/types.js";
import { collectionCreateSchema, collectionUpdateSchema } from "./collectionSchemas.js";
import {
  buildCreateCollectionInput,
  buildCreateValidationDraft,
  buildUpdateValidationDraft,
  validateCollectionDraft,
} from "./collectionValidation.js";
import { createAdminAuthService, type AdminAuthService } from "./adminAuth.js";
import { getOllamaModelDiscovery } from "../rag.js";

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
        ozelgeDataPath: runtimeConfig.collectionDefaults.ozelgeDataPath,
        distanceMetric: runtimeConfig.chromaDistanceMetric,
        indexSampleSize: runtimeConfig.indexSampleSize,
        chunkSize: runtimeConfig.collectionDefaults.chunkSize,
        chunkOverlap: runtimeConfig.collectionDefaults.chunkOverlap,
        retrievalK: runtimeConfig.collectionDefaults.retrievalK,
        retrievalDistanceThreshold: runtimeConfig.collectionDefaults.retrievalDistanceThreshold,
      },
      modelDefaults: {
        embeddingModel: runtimeConfig.ollamaEmbeddingModel,
        chatModel: runtimeConfig.ollamaChatModel,
      },
    };
  }

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

      const collection = await deps.registry!.createCollection(context, input);
      res.status(201).json({
        collection: {
          id: collection.id,
          displayName: collection.displayName,
          status: collection.status,
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
      const discovery = await (deps.healthChecks?.checkOllamaModelDiscovery ?? getOllamaModelDiscovery)(runtimeConfig);
      res.json({
        reachable: discovery.reachable,
        models: discovery.models,
        embeddingModels: discovery.embeddingModels,
        chatModels: discovery.chatModels,
        defaults: discovery.defaults,
      });
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
        buildUpdateValidationDraft(collection, parsed.data),
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
      await requireVisibleCollection(context, collectionId);
      const collection = await deps.registry!.updateCollection(context, collectionId, parsed.data);
      res.json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/collections/:collectionId", requireRegistry, requireJobRunner, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      await requireVisibleCollection(context, collectionId);
      
      const cancelledJobIds = await deps.registry!.deleteCollection(context, collectionId);
      for (const jobId of cancelledJobIds) {
        await deps.jobRunner!.abort(jobId);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/collections/:collectionId/reindex", requireRegistry, requireJobRunner, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const context = res.locals.requestContext as RequestContext;
      await requireVisibleCollection(context, collectionId);
      
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
