import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hashPassword } from "../src/admin/passwordHash.js";
import { createApp } from "../src/app.js";
import { createSqliteCollectionRegistry } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { config, type ResolvedConfig } from "../src/config.js";
import { DEFAULT_BUILTIN_EMBEDDING_MODEL } from "../src/embeddings/models.js";
import { createAdminAuthService } from "../src/http/adminAuth.js";
import { checkUploadName } from "../src/documents/collectionFiles.js";
import type { IndexJobRunner } from "../src/indexing/jobRunner.js";

const stubEmbeddingTarget = async () => ({
  provider: "builtin" as const,
  model: DEFAULT_BUILTIN_EMBEDDING_MODEL,
  configured: true,
  supported: true,
  downloaded: true,
  approxDownloadMb: 0,
  ok: true,
  latencyMs: 0,
});

const stubJobRunner = { start: () => {}, abort: () => false, drain: async () => {}, shutdown: async () => {} } as unknown as IndexJobRunner;

type Upload = { name: string; content: string };

function formWith(files: Upload[]): FormData {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([file.content]), file.name);
  return form;
}

describe("collection files API", () => {
  let projectRoot: string;
  let runtimeConfig: ResolvedConfig;
  let registry: CollectionRegistry;
  let server: Server | undefined;
  let baseUrl: string;

  async function start(overrides: Partial<ResolvedConfig> = {}, adminAuth?: ReturnType<typeof createAdminAuthService>) {
    const app = createApp({
      runtimeConfig: { ...runtimeConfig, ...overrides },
      registry,
      jobRunner: stubJobRunner,
      adminAuth,
      healthChecks: { checkEmbeddingTarget: stubEmbeddingTarget } as any,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  async function createCollection(body: Record<string, unknown> = { displayName: "My docs" }, headers: Record<string, string> = {}) {
    const response = await fetch(`${baseUrl}/v1/admin/collections`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as any).collection.id as string;
  }

  function upload(collectionId: string, files: Upload[], headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/v1/admin/collections/${collectionId}/files`, { method: "POST", headers, body: formWith(files) });
  }

  async function listFiles(collectionId: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${baseUrl}/v1/admin/collections/${collectionId}/files`, { headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "radar-rag-files-"));
    await mkdir(path.join(projectRoot, "data"), { recursive: true });
    runtimeConfig = {
      ...config,
      projectRoot,
      registryPath: path.join(projectRoot, "data", "registry.sqlite"),
      uploadsDir: path.join(projectRoot, "data", "collections"),
      uploadMaxFileSizeBytes: 1024,
      rateLimitEnabled: false,
      adminAuth: { ...config.adminAuth, enabled: false },
      embedding: { ...config.embedding, provider: "builtin", model: DEFAULT_BUILTIN_EMBEDDING_MODEL, baseUrl: "" },
    };
    registry = createSqliteCollectionRegistry({ dbPath: ":memory:", projectRoot });
  });

  afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("creates a collection, uploads, lists, replaces and deletes documents over the API", async () => {
    await start();
    const id = await createCollection();
    const folder = path.join(projectRoot, "data", "collections", id);

    const empty = await listFiles(id);
    assert.equal(empty.sourceKind, "uploads");
    assert.equal(empty.writable, true);
    assert.deepEqual(empty.files, []);

    const first = await upload(id, [
      { name: "guide.md", content: "# Guide\nFirst version." },
      { name: "Türkçe belge şğü.txt", content: "Merhaba dünya." },
    ]);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as any;
    assert.deepEqual(firstBody.uploaded.map((file: any) => [file.name, file.replaced]), [
      ["guide.md", false],
      ["Türkçe belge şğü.txt", false],
    ]);
    assert.deepEqual(firstBody.rejected, []);
    assert.equal(firstBody.indexState.documentsChanged, true);
    assert.equal(await readFile(path.join(folder, "Türkçe belge şğü.txt"), "utf8"), "Merhaba dünya.");

    const listed = await listFiles(id);
    assert.deepEqual(listed.files.map((file: any) => file.name), ["guide.md", "Türkçe belge şğü.txt"]);
    assert.equal(listed.fileCount, 2);
    assert.ok(listed.files.every((file: any) => file.supported && file.sizeBytes > 0));

    const replaced = await upload(id, [{ name: "guide.md", content: "# Guide\nSecond version." }]);
    assert.equal(replaced.status, 201);
    assert.equal((await replaced.json() as any).uploaded[0].replaced, true);
    assert.equal(await readFile(path.join(folder, "guide.md"), "utf8"), "# Guide\nSecond version.");

    const deleted = await fetch(`${baseUrl}/v1/admin/collections/${id}/files/${encodeURIComponent("Türkçe belge şğü.txt")}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);
    assert.deepEqual((await listFiles(id)).files.map((file: any) => file.name), ["guide.md"]);

    const missing = await fetch(`${baseUrl}/v1/admin/collections/${id}/files/nope.md`, { method: "DELETE" });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as any).code, "DOCUMENT_NOT_FOUND");

    // No temp files are left behind.
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(folder), ["guide.md"]);
  });

  it("rejects unsupported, hidden and path-like names, and files over the size limit", async () => {
    await start();
    const id = await createCollection();

    const mixed = await upload(id, [
      { name: "ok.md", content: "fine" },
      { name: "virus.exe", content: "x" },
      { name: ".hidden.md", content: "x" },
    ]);
    assert.equal(mixed.status, 201);
    const mixedBody = await mixed.json() as any;
    assert.deepEqual(mixedBody.uploaded.map((file: any) => file.name), ["ok.md"]);
    assert.deepEqual(mixedBody.rejected.map((file: any) => [file.name, file.code]), [
      ["virus.exe", "UNSUPPORTED_FILE"],
      [".hidden.md", "INVALID_FILE_NAME"],
    ]);

    const onlyBad = await upload(id, [{ name: "notes.xlsx", content: "x" }]);
    assert.equal(onlyBad.status, 400);
    assert.equal((await onlyBad.json() as any).code, "UNSUPPORTED_FILE");

    const tooLarge = await upload(id, [{ name: "big.txt", content: "x".repeat(2048) }]);
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json() as any).code, "FILE_TOO_LARGE");
    assert.deepEqual((await listFiles(id)).files.map((file: any) => file.name), ["ok.md"]);

    // Browsers send only the base name, but a hostile client may not.
    assert.equal(checkUploadName("../../etc/passwd.md").ok, false);
    assert.equal(checkUploadName("..\\secret.md").ok, false);
    assert.equal(checkUploadName("a<b>.md").ok, false);
    const traversal = await fetch(`${baseUrl}/v1/admin/collections/${id}/files/${encodeURIComponent("../registry.sqlite")}`, { method: "DELETE" });
    assert.equal(traversal.status, 404);
    await stat(path.join(projectRoot, "data")); // still there
  });

  it("keeps folder collections read-only and blocks changes while an index job is active", async () => {
    await mkdir(path.join(projectRoot, "data", "docs"), { recursive: true });
    await writeFile(path.join(projectRoot, "data", "docs", "server.md"), "# On the server");
    await start();
    const folderId = await createCollection({ displayName: "Server folder", sourcePath: path.join(projectRoot, "data", "docs") });

    const listed = await listFiles(folderId);
    assert.equal(listed.sourceKind, "folder");
    assert.equal(listed.writable, false);
    assert.deepEqual(listed.files.map((file: any) => file.name), ["server.md"]);

    const readOnly = await upload(folderId, [{ name: "x.md", content: "x" }]);
    assert.equal(readOnly.status, 409);
    assert.equal((await readOnly.json() as any).code, "COLLECTION_FILES_READ_ONLY");
    const readOnlyDelete = await fetch(`${baseUrl}/v1/admin/collections/${folderId}/files/server.md`, { method: "DELETE" });
    assert.equal(readOnlyDelete.status, 409);

    const id = await createCollection();
    const patch = await fetch(`${baseUrl}/v1/admin/collections/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: "data/docs" }),
    });
    assert.equal(patch.status, 400);

    await registry.beginIndexJob({ tenantId: "default", userId: "local-dev", requestId: "r" }, id);
    const during = await upload(id, [{ name: "a.md", content: "x" }]);
    assert.equal(during.status, 409);
    assert.equal((await during.json() as any).code, "COLLECTION_INDEX_ALREADY_RUNNING");

    const otherTenant = await fetch(`${baseUrl}/v1/admin/collections/${id}/files`, { headers: { "x-tenant-id": "other-tenant" } });
    assert.equal(otherTenant.status, 403);
  });

  it("deletes an uploads collection's folder with it, but never a folder collection's files", async () => {
    await mkdir(path.join(projectRoot, "data", "docs"), { recursive: true });
    await writeFile(path.join(projectRoot, "data", "docs", "server.md"), "# On the server");
    await start();
    const id = await createCollection();
    assert.equal((await upload(id, [{ name: "a.md", content: "x" }])).status, 201);
    const folderId = await createCollection({ displayName: "Server folder", sourcePath: path.join(projectRoot, "data", "docs") });

    assert.equal((await fetch(`${baseUrl}/v1/admin/collections/${id}`, { method: "DELETE" })).status, 204);
    await assert.rejects(stat(path.join(projectRoot, "data", "collections", id)), { code: "ENOENT" });

    assert.equal((await fetch(`${baseUrl}/v1/admin/collections/${folderId}`, { method: "DELETE" })).status, 204);
    await stat(path.join(projectRoot, "data", "docs", "server.md"));
  });

  it("requires the manageDocuments capability and an action token when admin auth is on", async () => {
    const passwordHash = hashPassword("secret");
    const authConfig = {
      enabled: true,
      cookieName: "rag_admin_session",
      sessionTtlMs: 60_000,
      actionTokenTtlMs: 30_000,
      sessionSecretEnvVar: "RAG_ADMIN_SESSION_SECRET",
      users: [
        { username: "viewer", passwordHash, role: "viewer" as const, tenantId: "default" },
        { username: "operator", passwordHash, role: "operator" as const, tenantId: "default" },
      ],
    };
    const adminAuth = createAdminAuthService({ config: authConfig, env: { RAG_ADMIN_SESSION_SECRET: "session-secret" } });
    await start({ adminAuth: authConfig }, adminAuth);

    async function login(username: string): Promise<string> {
      const response = await fetch(`${baseUrl}/v1/admin/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "secret" }),
      });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie")!.split(";")[0];
    }
    async function actionToken(cookie: string, method: string, requestPath: string) {
      const response = await fetch(`${baseUrl}/v1/admin/auth/action-token`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ method, path: requestPath }),
      });
      return { status: response.status, token: ((await response.json()) as any).actionToken as string | undefined };
    }

    const operator = await login("operator");
    const createToken = await actionToken(operator, "POST", "/v1/admin/collections");
    const id = await createCollection({ displayName: "Auth docs" }, { cookie: operator, "x-admin-action-token": createToken.token! });
    const filesPath = `/v1/admin/collections/${id}/files`;

    const viewer = await login("viewer");
    assert.equal((await actionToken(viewer, "POST", filesPath)).status, 403);
    assert.equal((await upload(id, [{ name: "a.md", content: "x" }], { cookie: viewer })).status, 403);
    assert.equal((await listFiles(id, { cookie: viewer })).sourceKind, "uploads");

    assert.equal((await upload(id, [{ name: "a.md", content: "x" }], { cookie: operator })).status, 403);
    const uploadToken = await actionToken(operator, "POST", filesPath);
    assert.equal(uploadToken.status, 200);
    const uploaded = await upload(id, [{ name: "a.md", content: "x" }], { cookie: operator, "x-admin-action-token": uploadToken.token! });
    assert.equal(uploaded.status, 201);

    const deleteToken = await actionToken(operator, "DELETE", `${filesPath}/a.md`);
    const deleted = await fetch(`${baseUrl}${filesPath}/a.md`, {
      method: "DELETE",
      headers: { cookie: operator, "x-admin-action-token": deleteToken.token! },
    });
    assert.equal(deleted.status, 204);
  });
});
