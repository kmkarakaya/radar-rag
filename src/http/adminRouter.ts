import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import { startReindexJob } from "../indexing/jobs.js";
import type { RequestContext } from "./requestContext.js";
import type { CreateCollectionInput, IndexJobStatus, ListJobsInput } from "../collections/types.js";
import { collectionCreateSchema, collectionUpdateSchema } from "./collectionSchemas.js";
import {
  buildCreateCollectionInput,
  buildCreateValidationDraft,
  buildUpdateValidationDraft,
  validateCollectionDraft,
} from "./collectionValidation.js";

const JOB_STATUS_VALUES = ["queued", "running", "succeeded", "failed", "cancelled"] as const satisfies readonly IndexJobStatus[];

export function createAdminRouter(deps: AppDependencies, runtimeConfig: ResolvedConfig = deps.runtimeConfig ?? config) {
  const router = express.Router();

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
        jobs: result.jobs,
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
      res.json({ job });
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
