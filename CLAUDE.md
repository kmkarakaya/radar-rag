# CLAUDE.md

Agent brief for Radar RAG (formerly Vanilla RAG Backend). Read this first, then see [AGENTS.md](AGENTS.md) for the graphify knowledge-graph workflow and [docs/README.md](docs/README.md) for the API contract.

## What this is

A TypeScript / Express 5 (ESM) **multi-collection, multi-tenant LangChain RAG** backend over local documents (TXT, MD, PDF, DOC, DOCX). Local-first:

- **Embeddings** per collection, two LangChain providers in [src/embeddings/](src/embeddings/): `builtin` (default; `onnx-community/embeddinggemma-2-ONNX` q8 in-process via transformers.js v4, own `BuiltinEmbeddings` class, downloaded on first use into `models/`) and `openai-compatible` (`OpenAIEmbeddings` against any `/v1/embeddings` API, e.g. Ollama). Each collection stores provider+model (desired + active); reads always use the active pair; `embedding.*` config is only the default for new collections. No Ollama dependency.
- **Optional chat LLM** for `/query` only: any OpenAI-compatible API (`chat.baseUrl` + `chat.model` + optional key), called via LangChain `ChatOpenAICompletions` in [src/chat.ts](src/chat.ts). Not configured by default (retrieve-only: `/query` → 503 `CHAT_NOT_CONFIGURED`). Global, not per collection.
- **Chroma** for the vector store (`localhost:8000`, via Docker).
- **SQLite** (`better-sqlite3`) for the collection/job registry (`data/registry.sqlite`).

The server listens on **port 3010** in the shipped config. APIs are strictly versioned under `/v1`; legacy routes 404 on purpose.

## Run / build / test

All-in-one: `docker compose up -d` (backend + Chroma 1.5.9). The compose file pulls the prebuilt `ghcr.io/kmkarakaya/radar-rag` image (published by [.github/workflows/ci.yml](.github/workflows/ci.yml) on main after the tests pass) and works on its own without a clone; `docker compose up -d --build` builds the working copy. `./data`, `./models` and an optional `./config` folder are mounted; on the very first start a "Sample documents" collection is created from `data/sample` (image: `/app/samples`) and indexed. See [Dockerfile](Dockerfile), which sets `ONNXRUNTIME_NODE_INSTALL=skip`, prunes non-Linux onnxruntime binaries and must stay glibc-based. Local dev prereqs: `docker compose up -d chroma`; nothing else for embeddings (Ollama only if you choose it as an external provider or chat LLM).

- `npm run dev` — start in watch mode (`tsx watch src/server.ts`).
- `npm run build` — compile TypeScript to `dist/` (`tsc`); `npm start` — run compiled server.
- `npm test` — unit + acceptance (`node:test` via tsx).
- `npm run test:integration` — integration tests (needs live Chroma; uses the configured default embedding, so with `builtin` the model downloads on first use). `RAG_TEST_BUILTIN=1` additionally runs the real built-in model test (opt-in, ~350 MB download).
- `npm run typecheck` / `npm run typecheck:test` — type-check source / tests.
- CLI: `npm run onboard` (asks only embedding, optional chat LLM and admin auth; `-- --advanced` asks every setting), `npm run index -- --collection-id <id>` (reindex), `npm run admin:hash-password -- "<password>"` (scrypt hash for config users).

## Architecture map

- **Entry points**: [src/server.ts](src/server.ts) (HTTP server + graceful shutdown), [src/app.ts](src/app.ts) (Express app assembly + `/`, `/health`, `/ready`), [src/index.ts](src/index.ts) (CLI indexer).
- **RAG pipeline**: ingestion [src/ingestion/pipeline.ts](src/ingestion/pipeline.ts) (loaders for PDF/DOC/DOCX/TXT/MD, recursive folder scan that skips the SQLite registry; SHA-256 source hashing; fault-tolerant per-file) → chunk + embed + index as a **blue/green physical build** [src/indexing/buildPhysicalCollection.ts](src/indexing/buildPhysicalCollection.ts) → retrieval + grounded generation [src/rag.ts](src/rag.ts) (distance-threshold filtering; `__NO_ANSWER_FROM_CONTEXT__` no-answer signal; domain-neutral prompt; optional context cap `chat.maxContextTokens`). Chat model creation, the free `GET /models` provider check (cached, used by `/ready`) and error classification live in [src/chat.ts](src/chat.ts).
- **Indexing jobs**: async job runner + lifecycle in [src/indexing/](src/indexing/) (`jobRunner.ts`, `jobs.ts`, `cleanup.ts`); one active job per collection enforced by a partial unique index; blue/green swap retires old physical collections with a retention TTL.
- **HTTP routers**: public `/v1/rag` [src/http/ragRouter.ts](src/http/ragRouter.ts) (list, get, ready, retrieve, query), admin `/v1/admin` [src/http/adminRouter.ts](src/http/adminRouter.ts) (auth, collections CRUD + validate + reindex, jobs, audit-log, config/defaults, models). Static admin panel at `/admin`, browser example at `/test-frontend`.
- **Data layer**: hand-written prepared statements in [src/collections/sqliteRegistry.ts](src/collections/sqliteRegistry.ts) behind the `CollectionRegistry` interface ([src/collections/types.ts](src/collections/types.ts)). No ORM. Migrations are code-driven at startup (`ensureColumn` / `PRAGMA table_info`), no migration files.

## Auth / RBAC / CSRF

Implemented in [src/http/adminAuth.ts](src/http/adminAuth.ts); config under `adminAuth` in the YAML (**disabled** in the shipped config).

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

- Runtime config: [config/rag.config.yaml](config/rag.config.yaml), zod-validated with defaults resolved in [src/config.ts](src/config.ts). Every setting has a schema default, so the file is optional (missing file = defaults); `sampleCollection.enabled` (default true) controls the first-run sample collection ([src/samples/sampleCollection.ts](src/samples/sampleCollection.ts), runs only when the registry has never had a collection). User-facing config docs: [docs/configuration.md](docs/configuration.md). Key defaults: `chunkSize 500`, `chunkOverlap 200` (must be `< chunkSize`), `retrievalK 5`, `retrievalDistanceThreshold 1.2`, `distanceMetric l2`. `chat` is empty (retrieve-only); model parameters (`temperature`, `maxTokens`) are only sent when set by hand, otherwise provider defaults apply.
- `RAG_ADMIN_SESSION_SECRET` overrides the local secret file, keeping the runtime portable.
- Chat API key: `RAG_CHAT_API_KEY`, else `.local/rag_chat_api_key.secret` (written by onboarding via [src/secrets.ts](src/secrets.ts)). Never in the YAML (the YAML and its `.bak` are tracked) and never returned by the API; redacted from errors.
- Embedding API key (openai-compatible provider): `RAG_EMBEDDING_API_KEY`, else `.local/rag_embedding_api_key.secret`; same rules. Chat and embedding share [src/providers/openaiCompatible.ts](src/providers/openaiCompatible.ts) (free `GET /models` check, error classification, redaction).
- Gitignored: `.env*`, `.local/`, `data/*.sqlite`, `chroma_data/`, `dist/`, `node_modules/`, `graphify-out/` (local only; rebuild with `graphify update .`).
- Portability: paths inside the repo are stored relative (`src/paths.ts` `toPortablePath`) in the config (onboarding) and in the registry (collection `sourcePath`, migrated at startup when `projectRoot` is passed). `RAG_PORT`, `RAG_REGISTRY_PATH`, `RAG_CHROMA_URL`, `RAG_EMBEDDING_PROVIDER`, `RAG_EMBEDDING_MODEL`, `RAG_EMBEDDING_BASE_URL`, `RAG_EMBEDDING_CACHE_DIR`, `RAG_CHAT_BASE_URL`, `RAG_CHAT_MODEL`, `RAG_SOURCE_PATH`, `RAG_SAMPLE_COLLECTION`, `RAG_CONFIG_PATH` override the YAML at runtime (`applyConfigEnvOverrides`).

## Docs & knowledge graph

- API: [docs/README.md](docs/README.md), [docs/user_api_endpoints.md](docs/user_api_endpoints.md), [docs/admin_api_endpoints.md](docs/admin_api_endpoints.md), [docs/http_workflows.md](docs/http_workflows.md), [docs/openapi.yaml](docs/openapi.yaml).
- Architecture rationale (Turkish): [radar_rag_mimarisi.md](radar_rag_mimarisi.md).
- **Knowledge graph**: see [AGENTS.md](AGENTS.md). For codebase questions run `graphify query "<question>"` (also `graphify path` / `graphify explain`) when `graphify-out/graph.json` exists, instead of broad grep.

## After changing code

1. `npm run typecheck` and `npm test` must pass (add `npm run test:integration` when Chroma is up).
2. Keep `.js` import extensions on all new relative imports.
3. Run `graphify update .` to keep the knowledge graph current (AST-only, no API cost) — per [AGENTS.md](AGENTS.md).
