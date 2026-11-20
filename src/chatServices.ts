import {
  SERVER_CHAT_SERVICE_ID,
  serverChatConnection,
  serverChatTarget,
  type ChatConnection,
  type ChatTarget,
} from "./chat.js";
import type { ChatService, CollectionRegistry, RequestContext } from "./collections/types.js";
import type { ResolvedConfig } from "./config.js";

/** The connection of a service stored through the chat services API. */
export function chatServiceConnection(service: ChatService): ChatConnection {
  return {
    serviceId: service.id,
    baseUrl: service.baseUrl,
    apiKey: service.apiKey,
    version: service.updatedAt,
  };
}

/**
 * The chat LLM that answers /query for the request's tenant:
 * 1. the tenant's choice (chat settings: a chat service or "server", plus a model);
 * 2. otherwise the chat LLM from .env / config;
 * 3. otherwise none (retrieve-only).
 * A chosen service that no longer exists yields connection: null with a reason, never another service, so
 * questions and document text are never sent somewhere the admin did not choose.
 */
export async function resolveChatTarget(input: {
  registry?: Pick<CollectionRegistry, "getChatSettings" | "getChatService">;
  runtimeConfig: ResolvedConfig;
  context: RequestContext;
}): Promise<ChatTarget> {
  const settings = input.registry ? await input.registry.getChatSettings(input.context) : null;
  if (!settings) {
    return serverChatTarget(input.runtimeConfig);
  }

  if (settings.serviceId === SERVER_CHAT_SERVICE_ID) {
    const connection = serverChatConnection(input.runtimeConfig);
    return {
      source: "tenant",
      serviceId: SERVER_CHAT_SERVICE_ID,
      model: settings.model,
      connection,
      ...(connection ? {} : {
        connectionError: 'the chosen chat service "server" (.env / config) is no longer configured (chat.baseUrl / '
          + "RAG_CHAT_BASE_URL is empty). Choose another one with PUT /v1/admin/chat-settings, or reset the choice "
          + "with DELETE /v1/admin/chat-settings.",
      }),
    };
  }

  const service = await input.registry!.getChatService(input.context, settings.serviceId);
  if (!service) {
    return {
      source: "tenant",
      serviceId: settings.serviceId,
      model: settings.model,
      connection: null,
      connectionError: `the chosen chat service "${settings.serviceId}" does not exist any more. Choose another one with `
        + "PUT /v1/admin/chat-settings, or reset the choice with DELETE /v1/admin/chat-settings.",
    };
  }
  return { source: "tenant", serviceId: service.id, model: settings.model, connection: chatServiceConnection(service) };
}
