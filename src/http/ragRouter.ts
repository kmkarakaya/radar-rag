import express from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { HttpError } from "./errors.js";
import { config, type ResolvedConfig } from "../config.js";
import type { RequestContext } from "./requestContext.js";
import { resolveReadableCollection } from "../collections/resolveReadableCollection.js";
import { retrieveSources, answerQuestion, checkChromaHealth, checkOllamaHealth } from "../rag.js";
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
    readyUrl: `/v1/rag/collections/${c.id}/ready`,
    queryUrl: `/v1/rag/collections/${c.id}/query`,
    retrieveUrl: `/v1/rag/collections/${c.id}/retrieve`,
  };
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

      const activeJob = await deps.registry!.getActiveJobForCollection(context, collection.id);
      const ollama = await (deps.healthChecks?.checkOllamaHealth ?? checkOllamaHealth)(runtimeConfig);
      const availableModels = Array.isArray(ollama.details?.availableModels)
        ? ollama.details.availableModels.filter((value): value is string => typeof value === "string")
        : [];

      const readEmbeddingModel = collection.activeEmbeddingModel ?? collection.embeddingModel;
      const embeddingModelAvailable = ollama.ok && hasConfiguredModel(availableModels, readEmbeddingModel);
      const chatModelAvailable = ollama.ok && hasConfiguredModel(availableModels, collection.chatModel);

      let chromaCount = -1;
      let chromaReadable = false;

      if (collection.activePhysicalCollection) {
        const health = await (deps.healthChecks?.checkChromaHealth ?? checkChromaHealth)(
          runtimeConfig,
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
          embeddingModel: readEmbeddingModel,
          embeddingModelAvailable,
          chatModel: collection.chatModel,
          chatModelAvailable,
          desiredEmbeddingModel: collection.embeddingModel !== readEmbeddingModel ? collection.embeddingModel : undefined,
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
      
      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const collection = await resolveCollection(req, { registry: deps.registry! }, runtimeConfig, {
        abortSignal: ac.signal,
        timeoutMs: runtimeConfig.ragTimeoutMs,
      });
      res.locals.collectionId = collection.id;
      res.locals.physicalCollection = collection.activePhysicalCollection;

      const result = await retrieve(parsed.data.question, {
        collectionId: collection.id,
        collectionName: collection.activePhysicalCollection!,
        k: parsed.data.k ?? collection.retrievalK,
        runtimeConfig,
        embeddingModel: collection.activeEmbeddingModel ?? collection.embeddingModel,
        retrievalDistanceThreshold: collection.retrievalDistanceThreshold,
        context,
        abortSignal: ac.signal,
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
      
      const ac = new AbortController();
      req.on("close", () => ac.abort());

      const collection = await resolveCollection(req, { registry: deps.registry! }, runtimeConfig, {
        abortSignal: ac.signal,
        timeoutMs: runtimeConfig.ragTimeoutMs,
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
        abortSignal: ac.signal,
        includeDebugTimings: runtimeConfig.includeDebugTimings,
        logEvent: deps.logEvent,
      });
      const { debug, ...publicResult } = result;

      res.json({
        ...publicResult,
        collectionId: collection.id,
        collectionDisplayName: collection.displayName,
        activeVersion: collection.activeVersion,
        ...(runtimeConfig.includeDebugTimings && debug ? { debug } : {}),
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
