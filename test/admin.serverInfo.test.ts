import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { hashPassword } from "../src/admin/passwordHash.js";
import { createApp } from "../src/app.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import { MAX_FILES_PER_UPLOAD } from "../src/documents/collectionFiles.js";
import { allAdminCapabilities, createAdminAuthService } from "../src/http/adminAuth.js";
import { SUPPORTED_EXTENSIONS } from "../src/ingestion/pipeline.js";
import type { IndexJobRunner } from "../src/indexing/jobRunner.js";

const stubJobRunner = { start: () => {}, abort: () => false, drain: async () => {}, shutdown: async () => {} } as unknown as IndexJobRunner;
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const authConfig = (passwordHash: string): ResolvedConfig["adminAuth"] => ({
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
});

describe("server facts for API clients", () => {
  let server: Server | undefined;
  let registry: CollectionRegistry | undefined;
  let baseUrl = "";

  afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    registry?.close?.();
    registry = undefined;
  });

  async function start(options: { adminAuth?: ResolvedConfig["adminAuth"]; overrides?: Partial<ResolvedConfig> } = {}) {
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:" });
    const runtimeConfig: ResolvedConfig = {
      ...config,
      ...(options.adminAuth ? { adminAuth: options.adminAuth } : {}),
      ...(options.overrides ?? {}),
    };
    const adminAuth = options.adminAuth
      ? createAdminAuthService({ config: options.adminAuth, env: { RAG_ADMIN_SESSION_SECRET: "session-secret" } })
      : undefined;
    const app = createApp({ runtimeConfig, registry, jobRunner: stubJobRunner, adminAuth });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    return runtimeConfig;
  }

  async function login(username: string): Promise<{ cookie: string; body: any }> {
    const response = await fetch(`${baseUrl}/v1/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "secret" }),
    });
    assert.equal(response.status, 200);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    return { cookie, body: await response.json() };
  }

  it("returns the version from package.json on / and /health", async () => {
    await start();
    const health = await (await fetch(`${baseUrl}/health`)).json() as any;
    assert.equal(health.version, packageVersion);
    const root = await (await fetch(`${baseUrl}/`)).json() as any;
    assert.equal(root.version, packageVersion);
  });

  it("GET /v1/admin/server-info returns limits, allowed values and presets", async () => {
    const runtimeConfig = await start();
    const response = await fetch(`${baseUrl}/v1/admin/server-info`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.version, packageVersion);
    assert.deepEqual(body.uploads, {
      extensions: [...SUPPORTED_EXTENSIONS],
      maxFileSizeBytes: runtimeConfig.uploadMaxFileSizeBytes,
      maxFilesPerRequest: MAX_FILES_PER_UPLOAD,
    });
    assert.deepEqual(body.jobStatuses, ["queued", "running", "succeeded", "failed", "cancelled"]);
    assert.deepEqual(body.embeddingProviders, ["builtin", "openai-compatible"]);
    assert.deepEqual(body.distanceMetrics, ["l2", "cosine", "ip"]);
    const ollama = body.servicePresets.find((preset: any) => preset.id === "ollama");
    assert.deepEqual(ollama.kinds, ["embedding", "chat"]);
    assert.equal(ollama.apiKeyRequired, false);
    assert.match(ollama.baseUrl, /\/v1$/);
    const openrouter = body.servicePresets.find((preset: any) => preset.id === "openrouter");
    assert.deepEqual(openrouter.kinds, ["chat"]);
  });

  it("reports the configured upload size limit and complete service presets", async () => {
    await start({ overrides: { uploadMaxFileSizeBytes: 5 * 1024 * 1024 } });
    const body = await (await fetch(`${baseUrl}/v1/admin/server-info`)).json() as any;
    assert.equal(body.uploads.maxFileSizeBytes, 5 * 1024 * 1024);
    assert.deepEqual(body.servicePresets.map((preset: any) => preset.id), ["ollama", "lmstudio", "openai", "openrouter"]);
    for (const preset of body.servicePresets) {
      assert.equal(typeof preset.label, "string");
      assert.equal(typeof preset.name, "string");
      assert.match(preset.baseUrl, /^https?:\/\//);
      assert.equal(typeof preset.apiKeyRequired, "boolean");
      assert.ok(preset.kinds.length > 0 && preset.kinds.every((kind: string) => kind === "embedding" || kind === "chat"));
    }
  });

  it("returns every capability in the session when admin auth is off", async () => {
    await start();
    const body = await (await fetch(`${baseUrl}/v1/admin/auth/session`)).json() as any;
    assert.equal(body.enabled, false);
    assert.equal(body.session, null);
    assert.deepEqual(body.capabilities, allAdminCapabilities());
  });

  it("returns the role's capabilities with login and session", async () => {
    await start({ adminAuth: authConfig(hashPassword("secret")) });

    const viewer = await login("viewer");
    assert.deepEqual(viewer.body.capabilities, ["read"]);
    const viewerSession = await (await fetch(`${baseUrl}/v1/admin/auth/session`, { headers: { cookie: viewer.cookie } })).json() as any;
    assert.deepEqual(viewerSession.capabilities, ["read"]);
    // A viewer may read the server facts and the audit operations.
    assert.equal((await fetch(`${baseUrl}/v1/admin/server-info`, { headers: { cookie: viewer.cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { cookie: viewer.cookie } })).status, 200);

    const operator = await login("operator");
    assert.deepEqual(operator.body.capabilities, [
      "read", "createCollection", "validateCollection", "updateCollection", "reindexCollection", "cancelJob", "manageDocuments",
    ]);

    const admin = await login("admin");
    assert.deepEqual(admin.body.capabilities, allAdminCapabilities());

    // Without a session both new routes are protected like the rest of the admin API.
    assert.equal((await fetch(`${baseUrl}/v1/admin/server-info`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/v1/admin/audit-log/operations`)).status, 401);
  });

  it("audit operations are empty for a new log and follow the session's tenant when auth is on", async () => {
    await start({ adminAuth: authConfig(hashPassword("secret")) });
    const admin = await login("admin");
    const empty = await (await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { cookie: admin.cookie } })).json() as any;
    // Signing in may itself be logged; nothing from another tenant may appear.
    assert.ok(Array.isArray(empty.operations));
    await registry!.appendOperationalLog!({ tenantId: "tenant-b", operation: "chat_service_create", status: "succeeded" });
    await registry!.appendOperationalLog!({ tenantId: "tenant-a", operation: "document_upload", status: "succeeded" });
    // A tenant header cannot widen a signed-in session to another tenant.
    const body = await (await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { cookie: admin.cookie, "x-tenant-id": "tenant-b" } })).json() as any;
    assert.ok(body.operations.includes("document_upload"));
    assert.ok(!body.operations.includes("chat_service_create"));
  });

  it("audit operations are an empty list for an empty log", async () => {
    await start();
    const body = await (await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { "x-tenant-id": "nobody" } })).json() as any;
    assert.deepEqual(body.operations, []);
  });

  it("GET /v1/admin/audit-log/operations lists the tenant's distinct operations, sorted", async () => {
    await start();
    for (const event of [
      { tenantId: "tenant-a", operation: "reindex" },
      { tenantId: "tenant-a", operation: "document_upload" },
      { tenantId: "tenant-a", operation: "reindex" },
      { tenantId: "tenant-b", operation: "chat_service_create" },
    ]) {
      await registry!.appendOperationalLog!({ ...event, status: "succeeded" });
    }

    const tenantA = await (await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { "x-tenant-id": "tenant-a" } })).json() as any;
    assert.ok(tenantA.operations.includes("reindex"));
    assert.ok(tenantA.operations.includes("document_upload"));
    assert.ok(!tenantA.operations.includes("chat_service_create"), "another tenant's operations stay hidden");
    assert.equal(new Set(tenantA.operations).size, tenantA.operations.length, "no duplicates");
    assert.deepEqual(tenantA.operations, [...tenantA.operations].sort());

    const tenantB = await (await fetch(`${baseUrl}/v1/admin/audit-log/operations`, { headers: { "x-tenant-id": "tenant-b" } })).json() as any;
    assert.ok(tenantB.operations.includes("chat_service_create"));
    assert.ok(!tenantB.operations.includes("document_upload"));
  });
});
