import type { RequestHandler, Router } from "express";
import { z } from "zod";
import type {
  CreateServiceConnectionInput,
  ServiceConnection,
  UpdateServiceConnectionPatch,
} from "../collections/types.js";
import { HttpError, type ApiErrorCode } from "./errors.js";
import type { RequestContext } from "./requestContext.js";

/**
 * Routes shared by every kind of service connection (embedding services, chat services): list, test,
 * create, update and delete. What differs per kind (read-only entries, what "in use" means, messages) is
 * described by a ServiceKind, so both APIs behave the same way.
 */

export type ServiceConnectionLike = { serviceId: string; baseUrl: string; apiKey?: string; version: string };

export type ServiceConnectionModels = {
  id: string;
  name: string;
  reachable: boolean;
  authOk: boolean;
  models: string[];
  error?: string;
};

export const httpUrlSchema = z.string().trim().url().refine(
  (value) => /^https?:\/\//i.test(value),
  "Use an http:// or https:// URL, for example http://host.docker.internal:11434/v1.",
).transform((value) => value.replace(/\/+$/, ""));

const apiKeySchema = z.string().trim().min(1).max(1000);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: httpUrlSchema,
  apiKey: apiKeySchema.optional(),
}).strict();

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  baseUrl: httpUrlSchema.optional(),
  /** A new key; null removes it; omitted keeps it. */
  apiKey: apiKeySchema.nullable().optional(),
}).strict();

const testSchema = z.union([
  z.object({ serviceId: z.string().trim().min(1) }).strict(),
  z.object({ baseUrl: httpUrlSchema, apiKey: apiKeySchema.optional() }).strict(),
]);

export type ServiceKind = {
  /** Lower case, used in messages: "embedding service", "chat service". */
  label: string;
  /** The label with its article: "an embedding service", "a chat service". */
  labelWithArticle: string;
  codes: { notFound: ApiErrorCode; readOnly: ApiErrorCode; inUse: ApiErrorCode };
  /** The read-only service from .env / config. */
  server: {
    id: string;
    name: string;
    connection: () => ServiceConnectionLike | null;
    readOnlyMessage: string;
    notConfiguredMessage: string;
  };
  /** Names no stored service may take (the read-only entries). */
  reservedNames: string[];
  /** Shown in `warnings` while admin auth is off. */
  managementWarning: string;
  store: {
    list: (context: RequestContext) => Promise<ServiceConnection[]>;
    get: (context: RequestContext, serviceId: string) => Promise<ServiceConnection | null>;
    create: (context: RequestContext, input: CreateServiceConnectionInput) => Promise<ServiceConnection>;
    update: (context: RequestContext, serviceId: string, patch: UpdateServiceConnectionPatch) => Promise<ServiceConnection>;
    delete: (context: RequestContext, serviceId: string) => Promise<void>;
  };
  connectionOf: (service: ServiceConnection) => ServiceConnectionLike;
  /** Free GET /models check of one connection; never runs an embedding or a generation. */
  checkConnection: (connection: ServiceConnectionLike, name: string) => Promise<ServiceConnectionModels>;
  /** Every entry the list returns, read-only ones first. */
  serialize: (context: RequestContext) => Promise<Array<{ id: string }>>;
  /** Throws (409 inUse) when the service is in use and must not be deleted. */
  assertDeletable: (context: RequestContext, serviceId: string) => Promise<void>;
  /** Other read-only ids (embedding: "builtin"): the error to raise for a change or a connection test. */
  specialEntry?: (serviceId: string) => { readOnlyMessage: string; testMessage: string } | undefined;
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function createServiceKindHelpers(kind: ServiceKind, adminAuthEnabled: () => boolean) {
  function managementWarnings(): string[] {
    return adminAuthEnabled() ? [] : [kind.managementWarning];
  }

  function notFound(serviceId: string): HttpError {
    return new HttpError(404, kind.codes.notFound, `${capitalize(kind.label)} ${serviceId} was not found.`);
  }

  /**
   * Warns (never blocks) when another service of the same kind already uses the same URL: legitimate with a
   * different API key (for example two OpenAI projects), otherwise usually a duplicate.
   */
  async function duplicateUrlWarnings(context: RequestContext, baseUrl: string, exceptId?: string): Promise<string[]> {
    const same = (url: string | null | undefined) => Boolean(url) && url!.replace(/\/+$/, "").toLowerCase() === baseUrl.toLowerCase();
    const names = (await kind.store.list(context))
      .filter((service) => service.id !== exceptId && same(service.baseUrl))
      .map((service) => `"${service.displayName}"`);
    if (same(kind.server.connection()?.baseUrl)) names.unshift(`"${kind.server.name}"`);
    return names.length === 0
      ? []
      : [`${baseUrl} is also used by ${names.join(", ")}. That is fine with a different API key; otherwise use the existing service.`];
  }

  async function assertUniqueName(context: RequestContext, name: string, exceptId?: string) {
    const clash = (await kind.store.list(context))
      .find((service) => service.displayName.toLowerCase() === name.toLowerCase() && service.id !== exceptId);
    const reserved = kind.reservedNames.map((item) => item.toLowerCase());
    if (clash || reserved.includes(name.toLowerCase())) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", `${capitalize(kind.labelWithArticle)} named "${name}" already exists.`);
    }
  }

  /** A stored service that may be changed or deleted; read-only entries are refused with 409. */
  async function requireWritable(context: RequestContext, serviceId: string): Promise<ServiceConnection> {
    const special = kind.specialEntry?.(serviceId);
    if (special) throw new HttpError(409, kind.codes.readOnly, special.readOnlyMessage);
    if (serviceId === kind.server.id) throw new HttpError(409, kind.codes.readOnly, kind.server.readOnlyMessage);
    const service = await kind.store.get(context, serviceId);
    if (!service) throw notFound(serviceId);
    return service;
  }

  /** The connection of a stored service or of the server service; 404 when there is none. */
  async function requireConnection(context: RequestContext, serviceId: string): Promise<{ connection: ServiceConnectionLike; name: string }> {
    if (serviceId === kind.server.id) {
      const server = kind.server.connection();
      if (!server) throw new HttpError(404, kind.codes.notFound, kind.server.notConfiguredMessage);
      return { connection: server, name: kind.server.name };
    }
    const service = await kind.store.get(context, serviceId);
    if (!service) throw notFound(serviceId);
    return { connection: kind.connectionOf(service), name: service.displayName };
  }

  return { managementWarnings, notFound, duplicateUrlWarnings, assertUniqueName, requireWritable, requireConnection };
}

/** Registers GET/POST {basePath}, POST {basePath}/test, PATCH/DELETE {basePath}/:serviceId. */
export function registerServiceConnectionRoutes(
  router: Router,
  basePath: string,
  kind: ServiceKind,
  options: { middleware: RequestHandler[]; adminAuthEnabled: () => boolean },
): ReturnType<typeof createServiceKindHelpers> {
  const helpers = createServiceKindHelpers(kind, options.adminAuthEnabled);
  const context = (res: { locals: Record<string, unknown> }) => res.locals.requestContext as RequestContext;
  const serializedOne = async (ctx: RequestContext, serviceId: string) =>
    (await kind.serialize(ctx)).find((item) => item.id === serviceId);

  router.get(basePath, ...options.middleware, async (_req, res, next) => {
    try {
      res.json({ services: await kind.serialize(context(res)), warnings: helpers.managementWarnings() });
    } catch (error) {
      next(error);
    }
  });

  router.post(`${basePath}/test`, ...options.middleware, async (req, res, next) => {
    try {
      const parsed = testSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", "Send { serviceId } or { baseUrl, apiKey? }.", { issues: parsed.error.issues });
      }
      let target: { connection: ServiceConnectionLike; name: string };
      if ("serviceId" in parsed.data) {
        const special = kind.specialEntry?.(parsed.data.serviceId);
        if (special) throw new HttpError(400, "INVALID_REQUEST_BODY", special.testMessage);
        target = await helpers.requireConnection(context(res), parsed.data.serviceId);
      } else {
        target = {
          connection: { serviceId: "test", baseUrl: parsed.data.baseUrl, apiKey: parsed.data.apiKey, version: `test:${Date.now()}` },
          name: "Connection test",
        };
      }
      // A free GET {baseUrl}/models; the key is never part of the response.
      const result = await kind.checkConnection(target.connection, target.name);
      res.json({ ...result, ok: result.reachable && result.authOk });
    } catch (error) {
      next(error);
    }
  });

  router.post(basePath, ...options.middleware, async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", `Invalid ${kind.label}`, { issues: parsed.error.issues });
      }
      const ctx = context(res);
      await helpers.assertUniqueName(ctx, parsed.data.name);
      const duplicates = await helpers.duplicateUrlWarnings(ctx, parsed.data.baseUrl);
      const service = await kind.store.create(ctx, {
        displayName: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
      });
      res.status(201).json({ service: await serializedOne(ctx, service.id), warnings: [...helpers.managementWarnings(), ...duplicates] });
    } catch (error) {
      next(error);
    }
  });

  router.patch(`${basePath}/:serviceId`, ...options.middleware, async (req, res, next) => {
    try {
      const serviceId = req.params.serviceId as string;
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST_BODY", `Invalid ${kind.label} update`, { issues: parsed.error.issues });
      }
      const ctx = context(res);
      await helpers.requireWritable(ctx, serviceId);
      if (parsed.data.name !== undefined) await helpers.assertUniqueName(ctx, parsed.data.name, serviceId);
      const duplicates = parsed.data.baseUrl !== undefined ? await helpers.duplicateUrlWarnings(ctx, parsed.data.baseUrl, serviceId) : [];
      await kind.store.update(ctx, serviceId, {
        displayName: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
      });
      res.json({ service: await serializedOne(ctx, serviceId), warnings: [...helpers.managementWarnings(), ...duplicates] });
    } catch (error) {
      next(error);
    }
  });

  router.delete(`${basePath}/:serviceId`, ...options.middleware, async (req, res, next) => {
    try {
      const serviceId = req.params.serviceId as string;
      const ctx = context(res);
      await helpers.requireWritable(ctx, serviceId);
      await kind.assertDeletable(ctx, serviceId);
      await kind.store.delete(ctx, serviceId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return helpers;
}
