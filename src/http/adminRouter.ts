import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import { startReindexJob } from "../indexing/jobs.js";
import type { RequestContext } from "./requestContext.js";

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

  const createCollectionSchema = z.object({
    displayName: z.string().trim().min(1),
    description: z.string().optional(),
    sourcePath: z.string().trim().min(1).default(runtimeConfig.sourcePath),
    ozelgeDataPath: z.string().trim().min(1).default(runtimeConfig.ozelgeDataPath),
    distanceMetric: z.enum(["l2", "cosine", "ip"]).default(runtimeConfig.chromaDistanceMetric),
    chunkSize: z.number().int().positive().default(runtimeConfig.chunkSize),
    chunkOverlap: z.number().int().nonnegative().default(runtimeConfig.chunkOverlap),
    retrievalK: z.number().int().positive().default(runtimeConfig.retrievalK),
    retrievalDistanceThreshold: z.number().nonnegative().default(runtimeConfig.retrievalDistanceThreshold),
    embeddingModel: z.string().trim().min(1).default(runtimeConfig.ollamaEmbeddingModel),
    chatModel: z.string().trim().min(1).default(runtimeConfig.ollamaChatModel),
  }).strict();

  router.post("/collections", requireRegistry, async (req, res, next) => {
    try {
      const parsed = createCollectionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid collection configuration", {
          issues: parsed.error.issues,
        });
      }

      const context = res.locals.requestContext as RequestContext;
      const collection = await deps.registry!.createCollection(context, parsed.data);
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

  const updateCollectionSchema = z.object({
    displayName: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    sourcePath: z.string().trim().min(1).optional(),
    ozelgeDataPath: z.string().trim().min(1).optional(),
    distanceMetric: z.enum(["l2", "cosine", "ip"]).optional(),
    chunkSize: z.number().int().positive().optional(),
    chunkOverlap: z.number().int().nonnegative().optional(),
    retrievalK: z.number().int().positive().optional(),
    retrievalDistanceThreshold: z.number().nonnegative().optional(),
    embeddingModel: z.string().trim().min(1).optional(),
    chatModel: z.string().trim().min(1).optional(),
  }).strict();

  router.patch("/collections/:collectionId", requireRegistry, async (req, res, next) => {
    try {
      const collectionId = req.params.collectionId as string;
      const parsed = updateCollectionSchema.safeParse(req.body);
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

  router.get("/jobs/:jobId", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const job = await deps.registry!.getJob(req.params.jobId as string);
      if (!job || job.tenantId !== context.tenantId) {
        throw new HttpError(404, "ROUTE_NOT_FOUND", "Job not found.");
      }
      res.locals.collectionId = job.collectionId;
      res.locals.jobId = job.id;
      res.locals.physicalCollection = job.targetPhysicalCollection;
      res.json({ job });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
