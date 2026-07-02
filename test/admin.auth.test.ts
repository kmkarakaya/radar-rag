import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createAdminAuthService, type AdminAuthService } from "../src/http/adminAuth.js";
import { hashPassword } from "../src/admin/passwordHash.js";
import { config } from "../src/config.js";

function createSessionCookieHeader(auth: AdminAuthService, sessionId: string): string {
  const res = {
    headers: new Map<string, string[]>(),
    setHeader(name: string, value: string | string[]) {
      this.headers.set(name.toLowerCase(), Array.isArray(value) ? value : [value]);
    },
  } as unknown as Parameters<AdminAuthService["setSessionCookie"]>[0];

  auth.setSessionCookie(res, sessionId);
  return (res as { headers: Map<string, string[]> }).headers.get("set-cookie")?.[0] ?? "";
}

function createCookiePair(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] ?? "";
}

function invokeMiddleware(
  middleware: ReturnType<AdminAuthService["requireActionTokenFor"]>,
  input: {
    method: string;
    path: string;
    token?: string;
    session?: unknown;
  },
): unknown[] {
  const req = {
    method: input.method,
    path: input.path,
    originalUrl: input.path,
    headers: input.token ? { "x-admin-action-token": input.token } : {},
  } as any;
  const res = {
    locals: input.session ? { adminSessionRecord: input.session } : {},
    setHeader() {},
  } as any;
  let nextArgs: unknown[] | null = null;
  middleware(req, res, (...args: unknown[]) => {
    nextArgs = args;
  });
  return nextArgs ?? [];
}

describe("admin auth service", () => {
  it("supports the configured role matrix and token lifecycle", () => {
    const passwordHash = hashPassword("secret-password");
    const auth = createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "viewer", passwordHash, role: "viewer", tenantId: "tenant-a" },
          { username: "operator", passwordHash, role: "operator", tenantId: "tenant-a" },
          { username: "admin", passwordHash, role: "admin", tenantId: "tenant-a" },
        ],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
      now: () => 1_000,
    });

    assert.equal(auth.hasAdminCapability("viewer", "read"), true);
    assert.equal(auth.hasAdminCapability("viewer", "createCollection"), false);
    assert.equal(auth.hasAdminCapability("operator", "updateCollection"), true);
    assert.equal(auth.hasAdminCapability("operator", "deleteCollection"), false);
    assert.equal(auth.hasAdminCapability("admin", "bulkDeleteJobs"), true);

    const session = auth.login("operator", "secret-password");
    assert.ok(session);
    assert.equal(session?.role, "operator");
    assert.equal(session?.tenantId, "tenant-a");

    const token = auth.createActionToken(session!, {
      method: "POST",
      path: "/v1/admin/collections/demo/reindex",
    });
    assert.ok(token.actionToken);

    const req = {
      method: "POST",
      path: "/v1/admin/collections/demo/reindex",
      originalUrl: "/v1/admin/collections/demo/reindex",
      headers: { "x-admin-action-token": token.actionToken },
    } as any;
    const res = {
      locals: { adminSessionRecord: session },
      setHeader() {},
    } as any;
    let nextArgs: unknown[] | null = null;
    auth.requireActionTokenFor("/v1/admin/collections/demo/reindex")(req, res, (...args: unknown[]) => {
      nextArgs = args;
    });

    assert.deepEqual(nextArgs, []);

    nextArgs = null;
    auth.requireActionTokenFor("/v1/admin/collections/demo/reindex")(req, res, (...args: unknown[]) => {
      nextArgs = args;
    });
    assert.ok(nextArgs);
    assert.equal(nextArgs?.[0] instanceof Error, true);
  });

  it("sets hardened cookies, rejects bad credentials, and invalidates sessions on logout", () => {
    const passwordHash = hashPassword("secret-password");
    const auth = createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "admin", passwordHash, role: "admin", tenantId: "tenant-a" },
        ],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
    });

    assert.equal(auth.login("admin", "wrong-password"), null);

    const session = auth.login("admin", "secret-password");
    assert.ok(session);

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const setCookie = createSessionCookieHeader(auth, session.sessionId);
      assert.match(setCookie, /rag_admin_session=/);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      assert.match(setCookie, /Max-Age=60/);
      assert.match(setCookie, /Secure/);

      const cookiePair = createCookiePair(setCookie);
      const req = { headers: { cookie: cookiePair } } as any;
      const res = {
        headers: new Map<string, string[]>(),
        setHeader(name: string, value: string | string[]) {
          this.headers.set(name.toLowerCase(), Array.isArray(value) ? value : [value]);
        },
      } as unknown as Parameters<AdminAuthService["logout"]>[1];

      assert.ok(auth.getSessionRecordFromRequest(req));
      auth.logout(req, res);
      assert.equal(auth.getSessionRecordFromRequest(req), null);

      const clearedCookie = (res as { headers: Map<string, string[]> }).headers.get("set-cookie")?.[0] ?? "";
      assert.match(clearedCookie, /Max-Age=0/);
      assert.match(clearedCookie, /HttpOnly/);
      assert.match(clearedCookie, /SameSite=Lax/);
      assert.match(clearedCookie, /Secure/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("rejects missing, expired, wrong-route, wrong-method, wrong-session, and wrong-tenant action tokens", () => {
    const passwordHash = hashPassword("secret-password");
    let nowMs = 1_000;
    const auth = createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "admin-a", passwordHash, role: "admin", tenantId: "tenant-a" },
          { username: "admin-b", passwordHash, role: "admin", tenantId: "tenant-b" },
        ],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
      now: () => nowMs,
    });

    const sessionA = auth.login("admin-a", "secret-password");
    const sessionB = auth.login("admin-a", "secret-password");
    const sessionOtherTenant = auth.login("admin-b", "secret-password");
    assert.ok(sessionA);
    assert.ok(sessionB);
    assert.ok(sessionOtherTenant);

    const protectedPath = "/v1/admin/collections/demo/reindex";

    const missingArgs = invokeMiddleware(auth.requireActionTokenFor(protectedPath), {
      method: "POST",
      path: protectedPath,
      session: sessionA,
    });
    assert.equal((missingArgs[0] as any)?.code, "FORBIDDEN");

    const wrongMethodToken = auth.createActionToken(sessionA!, { method: "POST", path: protectedPath }).actionToken;
    const wrongMethodArgs = invokeMiddleware(auth.requireActionTokenFor(protectedPath), {
      method: "DELETE",
      path: protectedPath,
      token: wrongMethodToken,
      session: sessionA,
    });
    assert.equal((wrongMethodArgs[0] as any)?.code, "FORBIDDEN");

    const wrongRouteToken = auth.createActionToken(sessionA!, { method: "POST", path: protectedPath }).actionToken;
    const wrongRouteArgs = invokeMiddleware(auth.requireActionTokenFor("/v1/admin/collections/demo"), {
      method: "POST",
      path: "/v1/admin/collections/demo",
      token: wrongRouteToken,
      session: sessionA,
    });
    assert.equal((wrongRouteArgs[0] as any)?.code, "FORBIDDEN");

    const wrongSessionToken = auth.createActionToken(sessionA!, { method: "POST", path: protectedPath }).actionToken;
    const wrongSessionArgs = invokeMiddleware(auth.requireActionTokenFor(protectedPath), {
      method: "POST",
      path: protectedPath,
      token: wrongSessionToken,
      session: sessionB,
    });
    assert.equal((wrongSessionArgs[0] as any)?.code, "FORBIDDEN");

    const wrongTenantToken = auth.createActionToken(sessionA!, { method: "POST", path: protectedPath }).actionToken;
    const wrongTenantArgs = invokeMiddleware(auth.requireActionTokenFor(protectedPath), {
      method: "POST",
      path: protectedPath,
      token: wrongTenantToken,
      session: sessionOtherTenant,
    });
    assert.equal((wrongTenantArgs[0] as any)?.code, "FORBIDDEN");

    const expiredToken = auth.createActionToken(sessionA!, { method: "POST", path: protectedPath }).actionToken;
    nowMs += 31_000;
    const expiredArgs = invokeMiddleware(auth.requireActionTokenFor(protectedPath), {
      method: "POST",
      path: protectedPath,
      token: expiredToken,
      session: sessionA,
    });
    assert.equal((expiredArgs[0] as any)?.code, "FORBIDDEN");
  });

  it("rejects missing startup secrets, empty users, and malformed password hashes", () => {
    assert.throws(() => createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
    }));

    assert.throws(() => createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "broken", passwordHash: "plaintext", role: "viewer", tenantId: "tenant-a" },
        ],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
    }));

    assert.throws(() => createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "broken", passwordHash: hashPassword("secret-password"), role: "viewer", tenantId: "tenant-a" },
        ],
      },
    }));
  });
});

describe("admin auth routes", () => {
  let server: Server;
  let baseUrl: string;

  after(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("protects the admin surface without affecting public routes", async () => {
    const passwordHash = hashPassword("admin-secret");
    const adminAuth = createAdminAuthService({
      config: {
        enabled: true,
        cookieName: "rag_admin_session",
        sessionTtlMs: 60_000,
        actionTokenTtlMs: 30_000,
        sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
        users: [
          { username: "viewer", passwordHash, role: "viewer", tenantId: "tenant-a" },
          { username: "operator", passwordHash, role: "operator", tenantId: "tenant-a" },
          { username: "admin", passwordHash, role: "admin", tenantId: "tenant-a" },
        ],
      },
      env: { RAG_ADMIN_SESSION_SECRET: "session-secret" },
    });

    const app = createApp({
      runtimeConfig: {
        ...config,
        adminAuth: {
          enabled: true,
          cookieName: "rag_admin_session",
          sessionTtlMs: 60_000,
          actionTokenTtlMs: 30_000,
          sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
          users: [
            { username: "viewer", passwordHash, role: "viewer", tenantId: "tenant-a" },
            { username: "operator", passwordHash, role: "operator", tenantId: "tenant-a" },
            { username: "admin", passwordHash, role: "admin", tenantId: "tenant-a" },
          ],
        },
      },
      adminAuth,
      registry: {
        listVisibleCollections: async () => [],
      } as any,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const sessionResponse = await fetch(`${baseUrl}/v1/admin/auth/session`);
    assert.equal(sessionResponse.status, 401);

    const badLoginResponse = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    assert.equal(badLoginResponse.status, 401);

    const loginResponse = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-secret" }),
    });
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json() as any;
    assert.equal(loginBody.session.role, "admin");

    const cookie = loginResponse.headers.get("set-cookie");
    assert.ok(cookie);

    const authedSessionResponse = await fetch(`${baseUrl}/v1/admin/auth/session`, {
      headers: { cookie },
    });
    assert.equal(authedSessionResponse.status, 200);

    const viewerLoginResponse = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "admin-secret" }),
    });
    assert.equal(viewerLoginResponse.status, 200);
    const viewerCookie = viewerLoginResponse.headers.get("set-cookie");
    assert.ok(viewerCookie);

    const operatorLoginResponse = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "admin-secret" }),
    });
    assert.equal(operatorLoginResponse.status, 200);
    const operatorCookie = operatorLoginResponse.headers.get("set-cookie");
    assert.ok(operatorCookie);

    const defaultsResponse = await fetch(`${baseUrl}/v1/admin/config/defaults`, {
      headers: { cookie: viewerCookie! },
    });
    assert.equal(defaultsResponse.status, 200);

    const viewerActionTokenResponse = await fetch(`${baseUrl}/v1/admin/auth/action-token`, {
      method: "POST",
      headers: {
        cookie: viewerCookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "POST", path: "/v1/admin/collections" }),
    });
    assert.equal(viewerActionTokenResponse.status, 403);

    const operatorActionTokenResponse = await fetch(`${baseUrl}/v1/admin/auth/action-token`, {
      method: "POST",
      headers: {
        cookie: operatorCookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "POST", path: "/v1/admin/collections" }),
    });
    assert.equal(operatorActionTokenResponse.status, 200);

    const operatorDeleteTokenResponse = await fetch(`${baseUrl}/v1/admin/auth/action-token`, {
      method: "POST",
      headers: {
        cookie: operatorCookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "DELETE", path: "/v1/admin/collections/demo" }),
    });
    assert.equal(operatorDeleteTokenResponse.status, 403);

    const adminDeleteTokenResponse = await fetch(`${baseUrl}/v1/admin/auth/action-token`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "DELETE", path: "/v1/admin/collections/demo" }),
    });
    assert.equal(adminDeleteTokenResponse.status, 200);

    const missingTokenMutationResponse = await fetch(`${baseUrl}/v1/admin/collections`, {
      method: "POST",
      headers: {
        cookie: operatorCookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Demo", sourcePath: "data" }),
    });
    assert.equal(missingTokenMutationResponse.status, 403);

    const adminIndexResponse = await fetch(`${baseUrl}/admin/`, { redirect: "manual" });
    assert.equal(adminIndexResponse.status, 302);
    assert.equal(adminIndexResponse.headers.get("location"), "/admin/login");

    const publicCollectionsResponse = await fetch(`${baseUrl}/v1/rag/collections`);
    assert.equal(publicCollectionsResponse.status, 200);

    const publicBody = await publicCollectionsResponse.json() as any;
    assert.deepEqual(publicBody.collections, []);

    const logoutResponse = await fetch(`${baseUrl}/v1/admin/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(logoutResponse.status, 204);

    const loggedOutSessionResponse = await fetch(`${baseUrl}/v1/admin/auth/session`, {
      headers: { cookie },
    });
    assert.equal(loggedOutSessionResponse.status, 401);
  });
});
