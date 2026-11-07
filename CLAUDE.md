# CLAUDE.md

Agent brief for the Vanilla RAG Backend. Read this first, then see [AGENTS.md](AGENTS.md) for the graphify knowledge-graph workflow and [docs/README.md](docs/README.md) for the API contract.

## What this is

A TypeScript / Express 5 (ESM) **multi-collection, multi-tenant LangChain RAG** backend over local documents (TXT, MD, PDF, DOC, DOCX). Local-first:

- **Ollama** for chat + embeddings (`localhost:11434`, default chat `gemma3:4b-cloud`, embeddings `bge-m3`).
- **Chroma** for the vector store (`localhost:8000`, via Docker).
- **SQLite** (`better-sqlite3`) for the collection/job registry (`data/registry.sqlite`).

The server listens on **port 3010** in the shipped config. APIs are strictly versioned under `/v1`; legacy routes 404 on purpose.

## Run / build / test

Prereqs: `docker compose up -d chroma`, then Ollama running with `gemma3:4b-cloud` and `bge-m3` pulled.

- `npm run dev` — start in watch mode (`tsx watch src/server.ts`).
- `npm run build` — compile TypeScript to `dist/` (`tsc`); `npm start` — run compiled server.
- `npm test` — unit + acceptance (`node:test` via tsx).
- `npm run test:integration` — integration tests (needs live Ollama + Chroma).
- `npm run typecheck` / `npm run typecheck:test` — type-check source / tests.
- CLI: `npm run onboard` (bootstrap runtime config + optional admin auth), `npm run index -- --collection-id <id>` (reindex), `npm run admin:hash-password -- "<password>"` (scrypt hash for config users).

## Architecture map

- **Entry points**: [src/server.ts](src/server.ts) (HTTP server + graceful shutdown), [src/app.ts](src/app.ts) (Express app assembly + `/`, `/health`, `/ready`), [src/index.ts](src/index.ts) (CLI indexer).
- **RAG pipeline**: ingestion [src/ingestion/pipeline.ts](src/ingestion/pipeline.ts) (loaders for PDF/DOC/DOCX/TXT/MD, recursive folder scan that skips the SQLite registry; SHA-256 source hashing; fault-tolerant per-file) → chunk + embed + index as a **blue/green physical build** [src/indexing/buildPhysicalCollection.ts](src/indexing/buildPhysicalCollection.ts) → retrieval + grounded generation [src/rag.ts](src/rag.ts) (distance-threshold filtering; `__NO_ANSWER_FROM_CONTEXT__` no-answer signal; context budgeted to `numCtx`).
- **Indexing jobs**: async job runner + lifecycle in [src/indexing/](src/indexing/) (`jobRunner.ts`, `jobs.ts`, `cleanup.ts`); one active job per collection enforced by a partial unique index; blue/green swap retires old physical collections with a retention TTL.
- **HTTP routers**: public `/v1/rag` [src/http/ragRouter.ts](src/http/ragRouter.ts) (list, get, ready, retrieve, query), admin `/v1/admin` [src/http/adminRouter.ts](src/http/adminRouter.ts) (auth, collections CRUD + validate + reindex, jobs, audit-log, config/defaults, models). Static admin panel at `/admin`, browser example at `/test-frontend`.
- **Data layer**: hand-written prepared statements in [src/collections/sqliteRegistry.ts](src/collections/sqliteRegistry.ts) behind the `CollectionRegistry` interface ([src/collections/types.ts](src/collections/types.ts)). No ORM. Migrations are code-driven at startup (`ensureColumn` / `PRAGMA table_info`), no migration files.

## Auth / RBAC / CSRF

Implemented in [src/http/adminAuth.ts](src/http/adminAuth.ts); config under `adminAuth` in the YAML (currently **enabled**).

- **Auth**: username/password with **scrypt** hashes; login sets an HMAC-signed, HttpOnly, `SameSite=Lax` session cookie (`rag_admin_session`, `Secure` in production). Session secret from `RAG_ADMIN_SESSION_SECRET` env var, else `.local/rag_admin_session.secret`.
- **RBAC**: roles `viewer` (read) < `operator` (+create/validate/update/reindex/cancel) < `admin` (+delete/bulk). Enforced per-route via `requireCapability`; sessions carry `tenantId`.
- **CSRF**: state-changing admin routes require a single-use, HMAC-signed `x-admin-action-token` bound to session/tenant/method/path, minted via `POST /v1/admin/auth/action-token`.
- Public `/v1/rag/**` is **not** behind admin auth — it uses `x-tenant-id` / `x-user-id` headers (plus `x-request-id`) via `RequestContext`. When `adminAuth.enabled` is false, all admin guards no-op.

## Conventions (the gotchas)

- **ESM + NodeNext**: relative imports **must use `.js` extensions** on TS source paths (e.g. `import { config } from "./config.js"`). `"type": "module"`, `strict: true`.
- **Dependency-injection factories**: `createApp(deps)`, `buildPhysicalCollection({ deps })`, `ragHandlers` / `healthChecks` overrides. Inject dependencies (don't import singletons) — this is the dominant pattern and how tests mock.
- **Validation**: zod `.strict()` schemas for all config and request bodies ([src/config.ts](src/config.ts), [src/http/collectionSchemas.ts](src/http/collectionSchemas.ts)). Parse failures become `HttpError(400, "INVALID_REQUEST_BODY", …)`.
- **Typed errors**: `HttpError` [src/http/errors.ts](src/http/errors.ts) and `RagQueryError` [src/rag.ts](src/rag.ts). Routes do `try { … } catch (e) { next(e) }`; a central `errorHandler` maps to `{ error, code, message, requestId, details }`. Add new codes to the `ApiErrorCode` union.
- **Tenancy**: every registry query is scoped by `context.tenantId` from `RequestContext`.
- **Backpressure**: `Semaphore` ([src/http/semaphore.ts](src/http/semaphore.ts)) caps concurrent embeddings/generations; in-memory rate limiter ([src/http/rateLimit.ts](src/http/rateLimit.ts)) returns 429 with `Retry-After` / `X-RateLimit-*`.
- **Observability**: structured `OperationalLogSink` ([src/observability/logger.ts](src/observability/logger.ts), never throws, mirrors to `operational_logs`); timeouts/aborts via `withTimeoutAndAbort` ([src/observability/timeout.ts](src/observability/timeout.ts)).
- Some log messages and domain strings are **Turkish** — match the surrounding style in a given file.

## Config & secrets

- Runtime config: [config/rag.config.yaml](config/rag.config.yaml), zod-validated with defaults resolved in [src/config.ts](src/config.ts). Key defaults: `chunkSize 500`, `chunkOverlap 200` (must be `< chunkSize`), `retrievalK 5`, `retrievalDistanceThreshold 1.2`, `distanceMetric l2`, `numCtx 4096`.
- `RAG_ADMIN_SESSION_SECRET` overrides the local secret file, keeping the runtime portable.
- Gitignored: `.env*`, `.local/`, `data/*.sqlite`, `chroma_data/`, `dist/`, `node_modules/`, `graphify-out/` (local only; rebuild with `graphify update .`).
- Note: `collectionDefaults.sourcePath` is a hardcoded absolute Windows path (`C:\Codes\Vanilla Rag Backend\data`) — environment-specific.

## Docs & knowledge graph

- API: [docs/README.md](docs/README.md), [docs/user_api_endpoints.md](docs/user_api_endpoints.md), [docs/admin_api_endpoints.md](docs/admin_api_endpoints.md), [docs/http_workflows.md](docs/http_workflows.md), [docs/openapi.yaml](docs/openapi.yaml).
- Architecture rationale (Turkish): [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md).
- **Knowledge graph**: see [AGENTS.md](AGENTS.md). For codebase questions run `graphify query "<question>"` (also `graphify path` / `graphify explain`) when `graphify-out/graph.json` exists, instead of broad grep.

## After changing code

1. `npm run typecheck` and `npm test` must pass (add `npm run test:integration` when Ollama + Chroma are up).
2. Keep `.js` import extensions on all new relative imports.
3. Run `graphify update .` to keep the knowledge graph current (AST-only, no API cost) — per [AGENTS.md](AGENTS.md).
