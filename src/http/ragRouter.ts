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
          query: !!c.activePhysicalCollection,
          retrieve: !!c.activePhysicalCollection,
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
      const collectionId = req.params.collectionId as string;
      const collection = await deps.registry!.getVisibleCollection(context, collectionId);
      if (!collection) {
        const exists = await deps.registry!.collectionExists(collectionId);
        if (exists) {
          throw new HttpError(403, "COLLECTION_FORBIDDEN", "Collection access forbidden");
        }
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
      const collectionId = req.params.collectionId as string;
      const collection = await deps.registry!.getVisibleCollection(context, collectionId);
      if (!collection) {
        const exists = await deps.registry!.collectionExists(collectionId);
        if (exists) {
          throw new HttpError(403, "COLLECTION_FORBIDDEN", "Collection access forbidden");
        }
        throw new HttpError(404, "COLLECTION_NOT_FOUND", "Collection not found");
      }

      const activeJob = await deps.registry!.getActiveJobForCollection(context, collection.id);

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
        activeJob: activeJob ? { id: activeJob.id, status: activeJob.status } : null,
        chromaReadable,
        chromaCount,
        capabilities: {
          query: chromaReadable,
          retrieve: chromaReadable,
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

      const context = res.locals.requestContext as RequestContext;
      const collection = await resolveReadableCollection(req, { registry: deps.registry! }, config);

      req.on("close", () => {
        // We could abort an AbortController here if we wired one up fully, but 
        // express request doesn't directly expose standard abort signals until Express 5 
        // with node 16+. For now, we will just pass a local abort controller.
      });
      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const result = await retrieveSources(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        k: parsed.data.k ?? collection.retrievalK,
        runtimeConfig: config,
        context,
        abortSignal: ac.signal,
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

      const context = res.locals.requestContext as RequestContext;
      const collection = await resolveReadableCollection(req, { registry: deps.registry! }, config);

      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const result = await answerQuestion(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        retrievalK: collection.retrievalK,
        runtimeConfig: config,
        context,
        abortSignal: ac.signal,
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
