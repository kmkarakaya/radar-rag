import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config } from "../config.js";
import type { RequestContext } from "./requestContext.js";
import { resolveReadableCollection } from "../collections/resolveReadableCollection.js";
import { retrieveSources, answerQuestion, checkChromaHealth } from "../rag.js";

export function createRagRouter(deps: AppDependencies) {
  const router = express.Router();

  const requireRegistry = (req: Request, _res: Response, next: NextFunction) => {
    if (!deps.registry) {
      next(new HttpError(500, "INTERNAL_ERROR", "Registry is not available"));
      return;
    }
    next();
  };

  router.get("/collections", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const collections = await deps.registry!.listVisibleCollections(context);
      
      const mapped = collections.map(c => ({
        id: c.id,
        displayName: c.displayName,
        description: c.description,
        status: c.status,
        chunkCount: c.chunkCount,
        activeVersion: c.activeVersion,
        capabilities: {
          query: c.status === "ready",
          retrieve: c.status === "ready",
          reindex: true,
        },
        updatedAt: c.updatedAt,
      }));

      res.json({ collections: mapped });
    } catch (error) {
      next(error);
    }
  });

  router.get("/collections/:collectionId", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const collection = await deps.registry!.getVisibleCollection(context, req.params.collectionId as string);
      if (!collection) {
        throw new HttpError(404, "COLLECTION_NOT_FOUND", "Collection not found");
      }
      res.json({ collection });
    } catch (error) {
      next(error);
    }
  });

  router.get("/collections/:collectionId/ready", requireRegistry, async (req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      const collection = await deps.registry!.getVisibleCollection(context, req.params.collectionId as string);
      if (!collection) {
        throw new HttpError(404, "COLLECTION_NOT_FOUND", "Collection not found");
      }

      let chromaCount = -1;
      let chromaReadable = false;

      if (collection.activePhysicalCollection) {
        const health = await checkChromaHealth(config, { collectionName: collection.activePhysicalCollection });
        chromaReadable = health.details?.collectionReadable === true;
        if (chromaReadable) {
          chromaCount = (health.details?.collectionCount as number | undefined) ?? -1;
        }
      }

      res.json({
        id: collection.id,
        status: collection.status,
        activePhysicalCollection: collection.activePhysicalCollection,
        activeVersion: collection.activeVersion,
        chromaReadable,
        chromaCount,
        capabilities: {
          query: chromaReadable && collection.status === "ready",
          retrieve: chromaReadable && collection.status === "ready",
          reindex: true,
        }
      });
    } catch (error) {
      next(error);
    }
  });

  const retrieveSchema = z.object({
    question: z.string().trim().min(1),
    k: z.number().int().positive().optional(),
  }).strict();

  router.post("/collections/:collectionId/retrieve", requireRegistry, async (req, res, next) => {
    try {
      const parsed = retrieveSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid retrieve payload", { issues: parsed.error.issues });
      }

      const collection = await resolveReadableCollection(req, { registry: deps.registry! }, config);

      const result = await retrieveSources(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        k: parsed.data.k ?? collection.retrievalK,
        runtimeConfig: config,
      });

      res.json({
        ...result,
        collectionId: collection.id,
        collectionDisplayName: collection.displayName,
        activeVersion: collection.activeVersion,
      });
    } catch (error) {
      next(error);
    }
  });

  const querySchema = z.object({
    question: z.string().trim().min(1),
  }).strict();

  router.post("/collections/:collectionId/query", requireRegistry, async (req, res, next) => {
    try {
      const parsed = querySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Invalid query payload", { issues: parsed.error.issues });
      }

      const collection = await resolveReadableCollection(req, { registry: deps.registry! }, config);

      const result = await answerQuestion(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        retrievalK: collection.retrievalK,
        runtimeConfig: config,
      });

      res.json({
        ...result,
        collectionId: collection.id,
        collectionDisplayName: collection.displayName,
        activeVersion: collection.activeVersion,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
