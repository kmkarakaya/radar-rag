import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import type { RequestContext } from "./requestContext.js";
import { resolveReadableCollection } from "../collections/resolveReadableCollection.js";
import { retrieveSources, answerQuestion } from "../rag.js";
import { buildCollectionReadinessPayload } from "./collectionReadiness.js";
import type { RagCollection } from "../collections/types.js";

function mapToPublicCollectionDTO(c: RagCollection) {
  return {
    id: c.id,
    displayName: c.displayName,
    description: c.description ?? null,
    status: c.status,
    chunkCount: c.chunkCount ?? null,
    activeVersion: c.activeVersion ?? null,
    updatedAt: c.updatedAt,
    indexState: c.indexState ?? null,
    readyUrl: `/v1/rag/collections/${c.id}/ready`,
    queryUrl: `/v1/rag/collections/${c.id}/query`,
    retrieveUrl: `/v1/rag/collections/${c.id}/retrieve`,
  };
}

function createRequestAbortSignal(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();

  req.on("aborted", () => controller.abort());
  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  return controller.signal;
}

export function createRagRouter(deps: AppDependencies, runtimeConfig: ResolvedConfig = deps.runtimeConfig ?? config) {
  const router = express.Router();
  const retrieve = deps.ragHandlers?.retrieveSources ?? retrieveSources;
  const answer = deps.ragHandlers?.answerQuestion ?? answerQuestion;
  const resolveCollection = deps.ragHandlers?.resolveReadableCollection ?? resolveReadableCollection;

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
      
      const mapped = collections.map(mapToPublicCollectionDTO);

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
      res.json({ collection: mapToPublicCollectionDTO(collection) });
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
      const readiness = await buildCollectionReadinessPayload(
        deps.registry!,
        context,
        collection,
        runtimeConfig,
        deps.healthChecks,
      );

      res.json(readiness);
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
      
      const abortSignal = createRequestAbortSignal(req, res);

      const collection = await resolveCollection(req, { registry: deps.registry! }, runtimeConfig, {
        abortSignal,
        timeoutMs: runtimeConfig.ragTimeoutMs,
        logEvent: deps.logEvent,
      });
      const embeddingModel = collection.activeEmbeddingModel ?? collection.embeddingModel;
      res.locals.collectionId = collection.id;
      res.locals.physicalCollection = collection.activePhysicalCollection;

      const result = await retrieve(parsed.data.question, {
        collectionId: collection.id,
        collectionName: collection.activePhysicalCollection!,
        k: parsed.data.k ?? collection.retrievalK,
        runtimeConfig,
        embeddingModel,
        retrievalDistanceThreshold: collection.retrievalDistanceThreshold,
        context,
        abortSignal,
        includeDebugTimings: runtimeConfig.includeDebugTimings,
        logEvent: deps.logEvent,
      });
      const { debug, ...publicResult } = result;

      res.json({
        question: parsed.data.question,
        k: parsed.data.k ?? collection.retrievalK,
        sourceCount: publicResult.sources.length,
        ...publicResult,
        collectionId: collection.id,
        collectionDisplayName: collection.displayName,
        activeVersion: collection.activeVersion,
        embeddingModel,
        ...(runtimeConfig.includeDebugTimings && debug ? { debug } : {}),
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
      
      const abortSignal = createRequestAbortSignal(req, res);

      const collection = await resolveCollection(req, { registry: deps.registry! }, runtimeConfig, {
        abortSignal,
        timeoutMs: runtimeConfig.ragTimeoutMs,
        logEvent: deps.logEvent,
      });
      res.locals.collectionId = collection.id;
      res.locals.physicalCollection = collection.activePhysicalCollection;

      const result = await answer(parsed.data.question, {
        collectionId: collection.id,
        collectionName: collection.activePhysicalCollection!,
        retrievalK: collection.retrievalK,
        runtimeConfig,
        embeddingModel: collection.activeEmbeddingModel ?? collection.embeddingModel,
        chatModel: collection.chatModel,
        retrievalDistanceThreshold: collection.retrievalDistanceThreshold,
        context,
        abortSignal,
        includeDebugTimings: runtimeConfig.includeDebugTimings,
        logEvent: deps.logEvent,
      });
      const { debug, chatModel, embeddingModel, ...publicResult } = result;

      res.json({
        ...publicResult,
        collectionId: collection.id,
        collectionDisplayName: collection.displayName,
        activeVersion: collection.activeVersion,
        chatModel,
        embeddingModel,
        ...(runtimeConfig.includeDebugTimings && debug ? { debug } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
