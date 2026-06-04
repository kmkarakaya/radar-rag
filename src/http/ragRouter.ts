import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config } from "../config.js";
import type { RequestContext } from "./requestContext.js";
import { resolveReadableCollection } from "../collections/resolveReadableCollection.js";
import { retrieveSources, answerQuestion, checkChromaHealth, checkOllamaHealth } from "../rag.js";

export function createRagRouter(deps: AppDependencies) {
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
      
      const mapped = collections.map(c => ({
        id: c.id,
        displayName: c.displayName,
        description: c.description ?? null,
        status: c.status,
        chunkCount: c.chunkCount ?? null,
        activeVersion: c.activeVersion ?? null,
        updatedAt: c.updatedAt,
        readyUrl: `/v1/rag/collections/${c.id}/ready`,
        queryUrl: `/v1/rag/collections/${c.id}/query`,
        retrieveUrl: `/v1/rag/collections/${c.id}/retrieve`,
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
      const ollama = await (deps.healthChecks?.checkOllamaHealth ?? checkOllamaHealth)(config);
      const availableModels = Array.isArray(ollama.details?.availableModels)
        ? ollama.details.availableModels.filter((value): value is string => typeof value === "string")
        : [];
      const embeddingModelAvailable = ollama.ok && hasConfiguredModel(availableModels, collection.embeddingModel);
      const chatModelAvailable = ollama.ok && hasConfiguredModel(availableModels, collection.chatModel);

      let chromaCount = -1;
      let chromaReadable = false;

      if (collection.activePhysicalCollection) {
        const health = await (deps.healthChecks?.checkChromaHealth ?? checkChromaHealth)(
          config,
          { collectionName: collection.activePhysicalCollection },
        );
        chromaReadable = health.details?.collectionReadable === true;
        if (chromaReadable) {
          chromaCount = (health.details?.collectionCount as number | undefined) ?? -1;
        }
      }

      res.json({
        id: collection.id,
        status: collection.status,
        activePhysicalCollection: collection.activePhysicalCollection ?? null,
        activeVersion: collection.activeVersion ?? null,
        activeJob: activeJob ? { id: activeJob.id, status: activeJob.status } : null,
        chromaReadable,
        chromaCount,
        modelAvailability: {
          embeddingModel: collection.embeddingModel,
          embeddingModelAvailable,
          chatModel: collection.chatModel,
          chatModelAvailable,
        },
        capabilities: {
          query: chromaReadable && embeddingModelAvailable && chatModelAvailable,
          retrieve: chromaReadable && embeddingModelAvailable,
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
      const collection = await resolveCollection(req, { registry: deps.registry! }, config);

      req.on("close", () => {
        // We could abort an AbortController here if we wired one up fully, but 
        // express request doesn't directly expose standard abort signals until Express 5 
        // with node 16+. For now, we will just pass a local abort controller.
      });
      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const result = await retrieve(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        k: parsed.data.k ?? collection.retrievalK,
        runtimeConfig: config,
        embeddingModel: collection.embeddingModel,
        retrievalDistanceThreshold: collection.retrievalDistanceThreshold,
        context,
        abortSignal: ac.signal,
      });

      res.json({
        question: parsed.data.question,
        k: parsed.data.k ?? collection.retrievalK,
        sourceCount: result.sources.length,
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
      const collection = await resolveCollection(req, { registry: deps.registry! }, config);

      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const result = await answer(parsed.data.question, {
        collectionName: collection.activePhysicalCollection!,
        retrievalK: collection.retrievalK,
        runtimeConfig: config,
        embeddingModel: collection.embeddingModel,
        chatModel: collection.chatModel,
        retrievalDistanceThreshold: collection.retrievalDistanceThreshold,
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

function normalizeModelName(modelName: string): string {
  return modelName.endsWith(":latest") ? modelName.slice(0, -":latest".length) : modelName;
}

function hasConfiguredModel(availableModels: string[], configuredModel: string): boolean {
  const normalizedConfiguredModel = normalizeModelName(configuredModel);
  return availableModels.some(
    (availableModel) => normalizeModelName(availableModel) === normalizedConfiguredModel,
  );
}
