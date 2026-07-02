import { readFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";
import type { RequestContext } from "./requestContext.js";
import type { ResolvedConfig } from "../config.js";
import { parsePasswordHash, verifyPasswordHash } from "../admin/passwordHash.js";

export type AdminRole = "viewer" | "operator" | "admin";
export type AdminCapability =
  | "read"
  | "createCollection"
  | "validateCollection"
  | "updateCollection"
  | "reindexCollection"
  | "cancelJob"
  | "deleteCollection"
  | "deleteJob"
  | "bulkDeleteJobs";

export type AdminSessionSummary = {
  username: string;
  role: AdminRole;
  tenantId: string;
  expiresAt: string;
};

type AdminSessionRecord = AdminSessionSummary & {
  sessionId: string;
  expiresAtMs: number;
};

type AdminActionTokenPayload = {
  sessionId: string;
  username: string;
  role: AdminRole;
  tenantId: string;
  method: string;
  path: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

type AdminActionTokenRecord = AdminActionTokenPayload & {
  used: boolean;
};

type AdminRouteMatch = {
  capability: AdminCapability;
  actionTokenRequired: boolean;
};

type AdminUserConfig = ResolvedConfig["adminAuth"]["users"][number];

type AdminAuthConfig = ResolvedConfig["adminAuth"];

const READ_ONLY_CAPABILITIES: AdminCapability[] = ["read"];
const OPERATOR_CAPABILITIES: AdminCapability[] = [
  "read",
  "createCollection",
  "validateCollection",
  "updateCollection",
  "reindexCollection",
  "cancelJob",
];
const ADMIN_CAPABILITIES: AdminCapability[] = [...OPERATOR_CAPABILITIES, "deleteCollection", "deleteJob", "bulkDeleteJobs"];
export const defaultAdminSessionSecretFilePath = ".local/rag_admin_session.secret";

const ADMIN_ROUTE_PATTERNS: Array<{
  method: string;
  pattern: RegExp;
  capability: AdminCapability;
  actionTokenRequired: boolean;
}> = [
  { method: "GET", pattern: /^\/v1\/admin\/config\/defaults\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/models\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/collections\/?$/, capability: "read", actionTokenRequired: false },
  { method: "POST", pattern: /^\/v1\/admin\/collections\/?$/, capability: "createCollection", actionTokenRequired: true },
  { method: "GET", pattern: /^\/v1\/admin\/collections\/[^/]+\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/collections\/[^/]+\/physical-collections\/?$/, capability: "read", actionTokenRequired: false },
  { method: "POST", pattern: /^\/v1\/admin\/collections\/validate\/?$/, capability: "validateCollection", actionTokenRequired: false },
  { method: "POST", pattern: /^\/v1\/admin\/collections\/[^/]+\/validate\/?$/, capability: "validateCollection", actionTokenRequired: false },
  { method: "PATCH", pattern: /^\/v1\/admin\/collections\/[^/]+\/?$/, capability: "updateCollection", actionTokenRequired: true },
  { method: "DELETE", pattern: /^\/v1\/admin\/collections\/[^/]+\/?$/, capability: "deleteCollection", actionTokenRequired: true },
  { method: "POST", pattern: /^\/v1\/admin\/collections\/[^/]+\/reindex\/?$/, capability: "reindexCollection", actionTokenRequired: true },
  { method: "GET", pattern: /^\/v1\/admin\/audit-log\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/jobs\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/jobs\/[^/]+\/?$/, capability: "read", actionTokenRequired: false },
  { method: "GET", pattern: /^\/v1\/admin\/jobs\/[^/]+\/events\/?$/, capability: "read", actionTokenRequired: false },
  { method: "POST", pattern: /^\/v1\/admin\/jobs\/[^/]+\/cancel\/?$/, capability: "cancelJob", actionTokenRequired: true },
  { method: "DELETE", pattern: /^\/v1\/admin\/jobs\/[^/]+\/?$/, capability: "deleteJob", actionTokenRequired: true },
  { method: "POST", pattern: /^\/v1\/admin\/jobs\/bulk-delete\/?$/, capability: "bulkDeleteJobs", actionTokenRequired: true },
];

function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  const normalized = path.trim();
  if (!normalized) {
    return "/";
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

function createSignature(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function createSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function createNonce(): string {
  return randomBytes(16).toString("base64url");
}

function toSummary(record: AdminSessionRecord): AdminSessionSummary {
  return {
    username: record.username,
    role: record.role,
    tenantId: record.tenantId,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
  };
}

function ensureValidPasswordHashes(users: AdminUserConfig[]): void {
  for (const user of users) {
    parsePasswordHash(user.passwordHash);
  }
}

function readConfiguredSessionSecret(sessionSecretFilePath: string): string {
  const resolvedPath = path.resolve(process.cwd(), sessionSecretFilePath);

  try {
    return readFileSync(resolvedPath, "utf8").trim();
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
    if (code === "ENOENT") {
      return "";
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read admin session secret file at ${resolvedPath}: ${message}`);
  }
}

export function validateAdminAuthConfig(input: {
  config: AdminAuthConfig;
  env?: NodeJS.ProcessEnv;
}): { secret: string; sessionSecretConfigured: boolean } {
  const cfg = input.config;
  const configuredSecret = (input.env?.[cfg.sessionSecretEnvVar] ?? "").trim();
  const fileSecret = configuredSecret.length > 0 ? "" : readConfiguredSessionSecret(defaultAdminSessionSecretFilePath);
  const sessionSecretConfigured = configuredSecret.length > 0 || fileSecret.length > 0;
  const secret = cfg.enabled ? (configuredSecret.length > 0 ? configuredSecret : fileSecret) : "";

  if (cfg.enabled) {
    if (!secret) {
      throw new Error(
        `Admin auth is enabled but ${cfg.sessionSecretEnvVar} is missing and no secret file was found at ${defaultAdminSessionSecretFilePath}.`,
      );
    }
    if (!Array.isArray(cfg.users) || cfg.users.length === 0) {
      throw new Error("Admin auth is enabled but no admin users are configured.");
    }
    ensureValidPasswordHashes(cfg.users);
  }

  return {
    secret,
    sessionSecretConfigured,
  };
}

function pickCapabilities(role: AdminRole): AdminCapability[] {
  if (role === "admin") {
    return ADMIN_CAPABILITIES;
  }
  if (role === "operator") {
    return OPERATOR_CAPABILITIES;
  }
  return READ_ONLY_CAPABILITIES;
}

export function hasAdminCapability(role: AdminRole, capability: AdminCapability): boolean {
  return pickCapabilities(role).includes(capability);
}

export function matchAdminRoute(method: string, path: string): AdminRouteMatch | null {
  const normalizedPath = normalizePath(path);
  const upperMethod = method.toUpperCase();
  for (const route of ADMIN_ROUTE_PATTERNS) {
    if (route.method === upperMethod && route.pattern.test(normalizedPath)) {
      return {
        capability: route.capability,
        actionTokenRequired: route.actionTokenRequired,
      };
    }
  }
  return null;
}

export function isAdminActionTokenRequired(method: string, path: string): boolean {
  return matchAdminRoute(method, path)?.actionTokenRequired ?? false;
}

export function createAdminAuthService(input: {
  config: AdminAuthConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  const cfg = input.config;
  const now = input.now ?? (() => Date.now());
  const { secret } = validateAdminAuthConfig({
    config: cfg,
    env: input.env,
  });

  const userMap = new Map(cfg.users.map((user) => [user.username, user]));
  const sessions = new Map<string, AdminSessionRecord>();
  const actionTokens = new Map<string, AdminActionTokenRecord>();

  function isEnabled(): boolean {
    return cfg.enabled;
  }

  function buildClearedCookie(): string {
    const parts = [
      `${cfg.cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (process.env.NODE_ENV === "production") {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  function signCookie(sessionId: string): string {
    return `${sessionId}.${createSignature(secret, sessionId)}`;
  }

  function parseSignedCookie(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    const [sessionId, signature] = value.split(".");
    if (!sessionId || !signature) {
      return null;
    }
    if (!safeEqual(createSignature(secret, sessionId), signature)) {
      return null;
    }
    return sessionId;
  }

  function getCookieHeaderValue(req: Request): string | undefined {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader === "string") {
      return cookieHeader;
    }
    if (Array.isArray(cookieHeader)) {
      return cookieHeader[0];
    }
    return undefined;
  }

  function readCookie(req: Request): string | null {
    const cookieHeader = getCookieHeaderValue(req);
    if (!cookieHeader) {
      return null;
    }
    const pairs = cookieHeader.split(";").map((value) => value.trim());
    for (const pair of pairs) {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const name = pair.slice(0, separatorIndex);
      const value = pair.slice(separatorIndex + 1);
      if (name === cfg.cookieName) {
        return parseSignedCookie(value);
      }
    }
    return null;
  }

  function pruneExpiredSessions(): void {
    const nowMs = now();
    for (const [sessionId, record] of sessions) {
      if (record.expiresAtMs <= nowMs) {
        sessions.delete(sessionId);
      }
    }
  }

  function pruneExpiredActionTokens(): void {
    const nowMs = now();
    for (const [nonce, record] of actionTokens) {
      if (record.expiresAtMs <= nowMs || record.used) {
        actionTokens.delete(nonce);
      }
    }
  }

  function getSessionRecordFromRequest(req: Request): AdminSessionRecord | null {
    if (!cfg.enabled) {
      return null;
    }

    pruneExpiredSessions();
    const sessionId = readCookie(req);
    if (!sessionId) {
      return null;
    }

    const record = sessions.get(sessionId) ?? null;
    if (!record) {
      return null;
    }

    if (record.expiresAtMs <= now()) {
      sessions.delete(sessionId);
      return null;
    }

    return record;
  }

  function getSessionSummaryFromRequest(req: Request): AdminSessionSummary | null {
    const record = getSessionRecordFromRequest(req);
    return record ? toSummary(record) : null;
  }

  function login(username: string, password: string): AdminSessionRecord | null {
    if (!cfg.enabled) {
      throw new HttpError(404, "ROUTE_NOT_FOUND", "Admin auth is disabled.");
    }

    const user = userMap.get(username.trim());
    if (!user || !verifyPasswordHash(password, user.passwordHash)) {
      return null;
    }

    const sessionId = createSessionId();
    const expiresAtMs = now() + cfg.sessionTtlMs;
    const record: AdminSessionRecord = {
      sessionId,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    sessions.set(sessionId, record);
    return record;
  }

  function setSessionCookie(res: Response, sessionId: string): void {
    res.setHeader("Set-Cookie", [
      [
        `${cfg.cookieName}=${signCookie(sessionId)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, Math.floor(cfg.sessionTtlMs / 1000))}`,
        process.env.NODE_ENV === "production" ? "Secure" : null,
      ]
        .filter(Boolean)
        .join("; "),
    ]);
  }

  function clearSessionCookie(res: Response): void {
    res.setHeader("Set-Cookie", [
      [
        `${cfg.cookieName}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
        process.env.NODE_ENV === "production" ? "Secure" : null,
      ]
        .filter(Boolean)
        .join("; "),
    ]);
  }

  function invalidateRequestSession(req: Request): void {
    if (!cfg.enabled) {
      return;
    }
    const sessionId = readCookie(req);
    if (sessionId) {
      sessions.delete(sessionId);
    }
  }

  function createActionToken(session: AdminSessionRecord, input: {
    method: string;
    path: string;
  }): { actionToken: string; expiresAt: string } {
    if (!cfg.enabled) {
      throw new HttpError(404, "ROUTE_NOT_FOUND", "Admin auth is disabled.");
    }

    const method = input.method.trim().toUpperCase();
    const path = normalizePath(input.path);
    const route = matchAdminRoute(method, path);
    if (!route) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "Unsupported admin action token target.");
    }
    if (!route.actionTokenRequired) {
      throw new HttpError(400, "INVALID_REQUEST_BODY", "The selected admin route does not require an action token.");
    }
    if (!hasAdminCapability(session.role, route.capability)) {
      throw new HttpError(403, "FORBIDDEN", "Admin role does not allow this operation.");
    }

    pruneExpiredActionTokens();
    const issuedAtMs = now();
    const expiresAtMs = issuedAtMs + cfg.actionTokenTtlMs;
    const payload: AdminActionTokenPayload = {
      sessionId: session.sessionId,
      username: session.username,
      role: session.role,
      tenantId: session.tenantId,
      method,
      path,
      nonce: createNonce(),
      issuedAtMs,
      expiresAtMs,
    };
    const payloadJson = JSON.stringify(payload);
    const token = `${Buffer.from(payloadJson, "utf8").toString("base64url")}.${createSignature(secret, payloadJson)}`;
    actionTokens.set(payload.nonce, { ...payload, used: false });
    return { actionToken: token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  function consumeActionToken(session: AdminSessionRecord, input: {
    method: string;
    path: string;
    token: string | undefined;
  }): void {
    if (!cfg.enabled) {
      return;
    }

    const token = input.token?.trim();
    if (!token) {
      throw new HttpError(403, "FORBIDDEN", "Missing admin action token.");
    }

    const [payloadPart, signature] = token.split(".");
    if (!payloadPart || !signature) {
      throw new HttpError(403, "FORBIDDEN", "Invalid admin action token.");
    }

    const payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8");
    if (!safeEqual(createSignature(secret, payloadJson), signature)) {
      throw new HttpError(403, "FORBIDDEN", "Invalid admin action token.");
    }

    let payload: AdminActionTokenPayload;
    try {
      payload = JSON.parse(payloadJson) as AdminActionTokenPayload;
    } catch {
      throw new HttpError(403, "FORBIDDEN", "Invalid admin action token.");
    }

    pruneExpiredActionTokens();
    const record = actionTokens.get(payload.nonce);
    if (!record || record.used) {
      throw new HttpError(403, "FORBIDDEN", "Admin action token has already been used.");
    }

    if (record.expiresAtMs <= now() || payload.expiresAtMs <= now()) {
      actionTokens.delete(payload.nonce);
      throw new HttpError(403, "FORBIDDEN", "Admin action token expired.");
    }

    const method = input.method.trim().toUpperCase();
    const path = normalizePath(input.path);
    if (record.sessionId !== session.sessionId || payload.sessionId !== session.sessionId) {
      throw new HttpError(403, "FORBIDDEN", "Admin action token does not belong to this session.");
    }
    if (record.tenantId !== session.tenantId || payload.tenantId !== session.tenantId) {
      throw new HttpError(403, "FORBIDDEN", "Admin action token does not belong to this tenant.");
    }
    if (record.method !== method || payload.method !== method || record.path !== path || payload.path !== path) {
      throw new HttpError(403, "FORBIDDEN", "Admin action token cannot be reused on a different route.");
    }

    const route = matchAdminRoute(method, path);
    if (!route || !route.actionTokenRequired) {
      throw new HttpError(403, "FORBIDDEN", "Admin action token is not valid for this route.");
    }
    if (!hasAdminCapability(session.role, route.capability)) {
      throw new HttpError(403, "FORBIDDEN", "Admin role does not allow this operation.");
    }

    record.used = true;
    actionTokens.set(payload.nonce, record);
  }

  function requireSession(req: Request, res: Response, next: NextFunction): void {
    if (!cfg.enabled) {
      next();
      return;
    }

    const record = getSessionRecordFromRequest(req);
    if (!record) {
      next(new HttpError(401, "UNAUTHORIZED", "Admin session required."));
      return;
    }

    res.locals.adminSession = toSummary(record);
    res.locals.adminSessionRecord = record;
    const requestContext = res.locals.requestContext as RequestContext | undefined;
    if (requestContext) {
      res.locals.requestContext = {
        ...requestContext,
        tenantId: record.tenantId,
        userId: record.username,
      };
    }

    next();
  }

  function requireCapability(capability: AdminCapability) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!cfg.enabled) {
        next();
        return;
      }

      const session = (res.locals.adminSessionRecord as AdminSessionRecord | undefined) ?? getSessionRecordFromRequest(req);
      if (!session) {
        next(new HttpError(401, "UNAUTHORIZED", "Admin session required."));
        return;
      }

      if (!hasAdminCapability(session.role, capability)) {
        next(new HttpError(403, "FORBIDDEN", "Admin role does not allow this operation."));
        return;
      }

      res.locals.adminSessionRecord = session;
      res.locals.adminSession = toSummary(session);
      const requestContext = res.locals.requestContext as RequestContext | undefined;
      if (requestContext) {
        res.locals.requestContext = {
          ...requestContext,
          tenantId: session.tenantId,
          userId: session.username,
        };
      }

      next();
    };
  }

  function requireActionTokenFor(path?: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!cfg.enabled) {
        next();
        return;
      }

      const session = (res.locals.adminSessionRecord as AdminSessionRecord | undefined) ?? getSessionRecordFromRequest(req);
      if (!session) {
        next(new HttpError(401, "UNAUTHORIZED", "Admin session required."));
        return;
      }

      try {
        consumeActionToken(session, {
          method: req.method,
          path: path ? normalizePath(path) : req.path,
          token: typeof req.headers["x-admin-action-token"] === "string"
            ? req.headers["x-admin-action-token"]
            : Array.isArray(req.headers["x-admin-action-token"])
              ? req.headers["x-admin-action-token"][0]
              : undefined,
        });
        res.locals.adminSessionRecord = session;
        res.locals.adminSession = toSummary(session);
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  function requireAdminSessionIfEnabled(req: Request, res: Response, next: NextFunction): void {
    requireSession(req, res, next);
  }

  return {
    isEnabled,
    cookieName: cfg.cookieName,
    sessionTtlMs: cfg.sessionTtlMs,
    actionTokenTtlMs: cfg.actionTokenTtlMs,
    login,
    logout(req: Request, res: Response): void {
      invalidateRequestSession(req);
      clearSessionCookie(res);
    },
    setSessionCookie,
    clearSessionCookie,
    getSessionSummaryFromRequest,
    getSessionRecordFromRequest,
    requireSession: requireAdminSessionIfEnabled,
    requireCapability,
    requireActionTokenFor,
    createActionToken,
    matchAdminRoute,
    isAdminActionTokenRequired,
    hasAdminCapability,
  };
}

export type AdminAuthService = ReturnType<typeof createAdminAuthService>;
