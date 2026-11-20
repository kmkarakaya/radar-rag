import type { RequestHandler, Router } from "express";
import { z } from "zod";
import {
  checkChatProvider,
  listChatConnectionModels,
  SERVER_CHAT_SERVICE_ID,
  SERVER_CHAT_SERVICE_NAME,
  serverChatConnection,
  type ChatServiceModels,
  type ChatTarget,
} from "../chat.js";
import { chatServiceConnection, resolveChatTarget } from "../chatServices.js";
import type { CollectionRegistry } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { describeChatReadiness } from "../readiness.js";
import { HttpError } from "./errors.js";
import type { RequestContext } from "./requestContext.js";
import { registerServiceConnectionRoutes, type ServiceKind } from "./serviceRoutes.js";

/**
 * Chat services (/v1/admin/chat-services) and the tenant's chat choice (/v1/admin/chat-settings): which chat
 * LLM answers /query. Every rule lives here, so any API client (the admin panel included) gets the same result.
 */

export type ChatRouteDeps = {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  healthChecks?: {
    checkChatProvider?: typeof checkChatProvider;
    /** Free GET /models check of one chat service (POST /v1/admin/chat-services/test, GET /v1/admin/models). */
    checkChatConnection?: typeof listChatConnectionModels;
  };
};

const chatSettingsSchema = z.object({
  /** A chat service id, or "server" (the chat LLM from .env / config). */
  serviceId: z.string().trim().min(1),
  model: z.string().trim().min(1).max(200),
}).strict();

export function registerChatRoutes(
  router: Router,
  deps: ChatRouteDeps,
  options: { middleware: RequestHandler[]; adminAuthEnabled: () => boolean },
) {
  const { registry, runtimeConfig } = deps;
  const checkProvider = deps.healthChecks?.checkChatProvider ?? checkChatProvider;
  const checkConnection = deps.healthChecks?.checkChatConnection ?? listChatConnectionModels;

  /** The service answering /query for the tenant (its choice, else the server's), or null. */
  async function effectiveServiceId(context: RequestContext): Promise<string | null> {
    const settings = await registry.getChatSettings(context);
    if (settings) return settings.serviceId;
    return runtimeConfig.chat.enabled ? SERVER_CHAT_SERVICE_ID : null;
  }

  const kind: ServiceKind = {
    label: "chat service",
    labelWithArticle: "a chat service",
    codes: { notFound: "CHAT_SERVICE_NOT_FOUND", readOnly: "CHAT_SERVICE_READ_ONLY", inUse: "CHAT_SERVICE_IN_USE" },
    server: {
      id: SERVER_CHAT_SERVICE_ID,
      name: SERVER_CHAT_SERVICE_NAME,
      connection: () => serverChatConnection(runtimeConfig),
      readOnlyMessage: "The server chat service comes from .env / config (RAG_CHAT_BASE_URL, chat.baseUrl); change it there.",
      notConfiguredMessage: "No server chat service is configured (RAG_CHAT_BASE_URL).",
    },
    reservedNames: [SERVER_CHAT_SERVICE_NAME],
    managementWarning: "Admin auth is off: anyone who can reach this server can change where questions and document text are "
      + "sent for answer generation. Turn on admin auth before other people can reach it.",
    store: {
      list: (context) => registry.listChatServices(context),
      get: (context, serviceId) => registry.getChatService(context, serviceId),
      create: (context, input) => registry.createChatService(context, input),
      update: (context, serviceId, patch) => registry.updateChatService(context, serviceId, patch),
      delete: (context, serviceId) => registry.deleteChatService(context, serviceId),
    },
    connectionOf: chatServiceConnection,
    checkConnection: (connection, name) => checkConnection(runtimeConfig, connection, name, { useCache: false }),
    async serialize(context) {
      const services = await registry.listChatServices(context);
      const server = serverChatConnection(runtimeConfig);
      const inUseId = await effectiveServiceId(context);
      return [
        {
          id: SERVER_CHAT_SERVICE_ID,
          name: SERVER_CHAT_SERVICE_NAME,
          baseUrl: server?.baseUrl ?? null,
          apiKeyConfigured: Boolean(server?.apiKey),
          source: "server" as const,
          readOnly: true,
          configured: Boolean(server),
          inUse: inUseId === SERVER_CHAT_SERVICE_ID,
          // The model from .env / config (used while the tenant has made no choice).
          defaultModel: runtimeConfig.chat.model || null,
        },
        ...services.map((service) => ({
          id: service.id,
          name: service.displayName,
          baseUrl: service.baseUrl,
          apiKeyConfigured: Boolean(service.apiKey),
          source: "panel" as const,
          readOnly: false,
          configured: true,
          inUse: inUseId === service.id,
          createdAt: service.createdAt,
          updatedAt: service.updatedAt,
        })),
      ];
    },
    async assertDeletable(context, serviceId) {
      const settings = await registry.getChatSettings(context);
      if (settings?.serviceId === serviceId) {
        throw new HttpError(
          409,
          "CHAT_SERVICE_IN_USE",
          `Chat service ${serviceId} answers /query for this tenant. Choose another one (PUT /v1/admin/chat-settings) `
            + "or go back to the server's chat LLM (DELETE /v1/admin/chat-settings) first.",
          { chatSettings: { serviceId: settings.serviceId, model: settings.model } },
        );
      }
    },
  };

  const helpers = registerServiceConnectionRoutes(router, "/chat-services", kind, options);

  /** The tenant's effective chat choice with a free availability check (never a generation). */
  async function describeSettings(context: RequestContext, useCache = true) {
    const [target, settings] = await Promise.all([
      resolveChatTarget({ registry, runtimeConfig, context }),
      registry.getChatSettings(context),
    ]);
    const status = await checkProvider(runtimeConfig, { target, useCache });
    const readiness = describeChatReadiness(status, target);
    return {
      target,
      settings: {
        source: target.source,
        serviceId: target.serviceId,
        serviceName: await serviceName(context, target),
        model: target.model,
        queryEnabled: target.source !== "none",
        status: {
          ok: status.ok,
          code: readiness.code,
          message: readiness.message,
          reachable: status.reachable,
          authOk: status.authOk,
          modelListed: status.modelListed,
          ...(status.availableModels ? { availableModels: status.availableModels } : {}),
        },
        updatedAt: settings?.updatedAt ?? null,
        updatedBy: settings?.updatedBy ?? null,
      },
    };
  }

  async function serviceName(context: RequestContext, target: ChatTarget): Promise<string | null> {
    if (!target.serviceId) return null;
    if (target.serviceId === SERVER_CHAT_SERVICE_ID) return SERVER_CHAT_SERVICE_NAME;
    return (await registry.getChatService(context, target.serviceId))?.displayName ?? null;
  }

  router.get("/chat-settings", ...options.middleware, async (_req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      res.json((await describeSettings(context)).settings);
    } catch (error) {
      next(error);
    }
  });

  router.put("/chat-settings", ...options.middleware, async (req, res, next) => {
    try {
      const parsed = chatSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Send { serviceId, model }.", { issues: parsed.error.issues });
      }
      const context = res.locals.requestContext as RequestContext;
      const { connection, name } = await helpers.requireConnection(context, parsed.data.serviceId);
      const target: ChatTarget = {
        source: "tenant",
        serviceId: parsed.data.serviceId,
        model: parsed.data.model,
        connection,
      };

      // Free GET /models: refuse a model the service says it does not offer; save otherwise.
      const status = await checkProvider(runtimeConfig, { target, useCache: false });
      if (status.reachable && status.authOk && status.modelListed === false) {
        throw new HttpError(
          422,
          "CHAT_MODEL_MISSING",
          `Chat model ${parsed.data.model} is not offered by ${name} (${connection.baseUrl}).`,
          { serviceId: parsed.data.serviceId, model: parsed.data.model, availableModels: status.availableModels ?? [] },
        );
      }
      const warnings: string[] = [];
      if (!status.reachable || !status.authOk) {
        // Chat is optional: saving while the service is down is allowed; /query reports the problem.
        warnings.push(`Saved, but ${name} cannot be used yet: ${describeChatReadiness(status, target).message}`);
      } else if (status.modelListed === "unknown") {
        warnings.push(`Saved, but ${name} does not list its models, so ${parsed.data.model} could not be verified.`);
      }

      await registry.setChatSettings(context, { serviceId: parsed.data.serviceId, model: parsed.data.model });
      res.json({
        settings: (await describeSettings(context)).settings,
        warnings: [...helpers.managementWarnings(), ...warnings],
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/chat-settings", ...options.middleware, async (_req, res, next) => {
    try {
      const context = res.locals.requestContext as RequestContext;
      await registry.clearChatSettings(context);
      res.json({ settings: (await describeSettings(context)).settings });
    } catch (error) {
      next(error);
    }
  });

  /** GET /v1/admin/models chatServices: models of every chat service of the tenant ("server" first when configured). */
  async function listChatServiceModels(context: RequestContext): Promise<ChatServiceModels[]> {
    const server = serverChatConnection(runtimeConfig);
    const services = await registry.listChatServices(context);
    return Promise.all([
      ...(server ? [checkConnection(runtimeConfig, server, SERVER_CHAT_SERVICE_NAME)] : []),
      ...services.map((service) => checkConnection(runtimeConfig, chatServiceConnection(service), service.displayName)),
    ]);
  }

  return { listChatServiceModels };
}
