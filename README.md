# Vanilla RAG Backend

TypeScript Express backend for multi-collection LangChain RAG over documents in `data/`, with optional admin auth, background indexing, a browser-ready public API, and a built-in admin panel for collection management.

## What it ships

- Multi-collection RAG with per-collection embedding models, chat models, distance metrics, chunk sizes, overlaps, retrieval `k`, and distance thresholds.
- Public read APIs for listing collections, loading collection details, checking readiness, retrieving evidence, and generating grounded answers.
- Optional cookie-backed admin auth with role-based access control and short-lived action tokens for protected mutations.
- Asynchronous indexing and rebuild jobs so active queries keep working while a collection is being refreshed.
- Operational guardrails including request IDs, tenant/user scoping, rate limiting, concurrency limits, 1 MB JSON bodies, and structured errors.
- Full admin visibility for defaults, model discovery, job progress, physical collection lifecycle, and audit history.
- Frontend-facing docs, OpenAPI, HTTP workflow examples, a runnable browser example, and a static admin panel in this repo.

## Feature Map

### Public RAG

- `GET /v1/rag/collections` to list collections visible to the current tenant.
- `GET /v1/rag/collections/:collectionId` to inspect one collection.
- `GET /v1/rag/collections/:collectionId/ready` to gate query and retrieve UI state before enabling actions.
- `POST /v1/rag/collections/:collectionId/retrieve` to fetch evidence chunks and the effective embedding model.
- `POST /v1/rag/collections/:collectionId/query` to retrieve context, generate an answer, and return sources plus model metadata.
- Public responses include the effective model names actually used for the request.

### Admin and Operations

- A built-in admin panel at [admin/index.html](admin/index.html) for day-to-day collection management.
- Optional admin auth with `viewer`, `operator`, and `admin` roles.
- Login, session hydration, logout, and action-token minting under `/v1/admin/auth/*`.
- Collection and job management live under `/v1/admin/collections` and `/v1/admin/jobs/`.
- Collection create, update, validate, reindex, delete, and bulk delete flows.
- Create-form defaults and model discovery so the panel can show backend defaults and model suggestions.
- Index job status, stage events, cancel, delete, and recovery visibility.
- Audit log for persisted operational history.
- Physical collection visibility for rebuild, retention, cleanup, and failed target states.

### Reliability and Safety

- System endpoints for introspection, liveness, and readiness checks: `/`, `/health`, and `/ready`.
- Zero-downtime rebuilds and stale job recovery on startup.
- Cleanup of retired physical collections.
- Concurrency protection and request rate limiting with `Retry-After` headers.
- Request tracing via `x-request-id`.
- Collection-level capability checks instead of blind UI enablement.
- Strict versioned APIs; legacy routes intentionally return `404`.

### Frontend and Integration Assets

- Working public RAG example at [test_frontend/README.md](test_frontend/README.md).
- Human-oriented docs index at [docs/README.md](docs/README.md).
- Endpoint reference, HTTP workflows, OpenAPI spec, frontend handoff, and acceptance checklist.

### Data and Indexing

- Document ingestion for TXT, MD, PDF, DOC, and DOCX files, scanning the source folder recursively.
- Chunking controls, retrieval thresholds, and distance-metric selection per collection.
- Configurable source path and auxiliary data path for collection provisioning.

## Start here

- [CLAUDE.md](CLAUDE.md) for the agent/contributor brief: stack, commands, architecture map, and conventions.
- [docs/README.md](docs/README.md) for the documentation index and reading order.
- [docs/admin_api_endpoints.md](docs/admin_api_endpoints.md) for admin auth, roles, and collection management.
- [docs/http_workflows.md](docs/http_workflows.md) for end-to-end curl examples.
- [test_frontend/README.md](test_frontend/README.md) for the runnable public RAG example.
- [vanilla_rag_backend_mimarisi.md](vanilla_rag_backend_mimarisi.md) for architecture and design rationale.

## Quick start

```powershell
cd "C:\Codes\Vanilla Rag Backend"
docker compose up -d chroma
npm.cmd install
ollama pull gemma3:4b-cloud
ollama pull bge-m3
npm.cmd run onboard
npm.cmd run dev
```

What each command does:

- `cd "C:\Codes\Vanilla Rag Backend"` changes the shell into the project root so the rest of the commands resolve the right files and config.
- `docker compose up -d chroma` starts the Chroma vector database in the background. You need this before indexing or querying collections. Docker Desktop must be running first; see [Troubleshooting](#troubleshooting) if this command fails.
- `npm.cmd install` installs the Node.js dependencies listed in `package.json`.
- `ollama pull gemma3:4b-cloud` downloads the default chat model used by the backend.
- `ollama pull bge-m3` downloads the default embedding model used for chunk indexing and retrieval.
- `npm.cmd run onboard` creates or refreshes runtime config and registry state for local development. It does not create or edit collections.
- `npm.cmd run dev` starts the backend in watch mode.

How to extend it:

- Pull more chat models with `ollama pull <chat-model-name>` and then point `ollama.chatModel` or a collection-specific chat model setting at that model in [config/rag.config.yaml](config/rag.config.yaml).
- Pull more embedding models with `ollama pull <embedding-model-name>` and then update `ollama.embeddingModel` or a collection-specific embedding model setting.
- If you want to test a different vector store or service layout, adjust the Compose stack first, then update the config to match the new runtime target.
- If you add more collection templates or data sources, re-run `npm.cmd run onboard` so the registry and runtime defaults stay in sync.
- If you want a different local workflow, keep `ollama pull` commands for the models you actually use and remove the rest.

## What onboarding is for

Onboarding is the local bootstrap step. It prepares the runtime environment so the backend and admin panel can work correctly, and it can also bootstrap admin auth on first setup.

What `npm run onboard` does:

- creates or refreshes the runtime config for this machine
- writes a backup copy of the previous config before changes are saved
- resolves local defaults such as ports, paths, model names, and registry state
- optionally prompts whether admin auth is being used
- if admin auth is enabled, asks for the session secret, asks for the first admin password, hashes that password, and stores the session secret in `.local/rag_admin_session.secret`
- checks whether Chroma, Ollama, and the configured models are reachable
- verifies that indexing can run against the current source data

What it does not do:

- create, edit, validate, reindex, or monitor collections
- replace the admin panel for daily collection management

Use onboarding again when you change machines, reset the config, add new source data, switch local models, or want to re-bootstrap admin auth. If the runtime is already healthy and you are only working in the admin panel, you usually do not need to rerun it.

## Troubleshooting

| Symptom                                                                                                                          | Cause                                                | Fix                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up -d chroma` fails with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | Docker Desktop is not running                        | Start Docker Desktop, wait until it shows "Engine running", then run `docker compose up -d chroma` again                                                                                     |
| Onboarding prints `Chroma: fail - Failed to connect to chromadb` under "Config saved; fix these before indexing"               | The Chroma container is not running                  | Start Chroma as above. Onboarding already saved the config and still prints the next steps, so you do not need to rerun it; start the server with `npm.cmd run dev` and check `GET /ready` |
| Creating a collection or starting a reindex returns `422 UNAVAILABLE_MODEL`                                                    | The embedding or chat model is not pulled in Ollama  | Run the `ollama pull …` command listed in `details.recommendedActions`, or pick a model from `details.availableModels`                                                                  |
| Creating a collection or starting a reindex returns `503 OLLAMA_UNREACHABLE`                                                   | Ollama is not running or `ollama.baseUrl` is wrong | Start Ollama (`ollama serve` or the desktop app) and check `ollama.baseUrl` in [config/rag.config.yaml](config/rag.config.yaml)                                                             |

Quick health check: `GET http://localhost:3010/ready?details=true` reports Chroma, Ollama, model, and data source status with blockers and recommended actions.

## Güvenli admin quickstart

Admin auth is opt-in. During onboarding, answer yes when asked whether admin auth is used. Onboarding will ask for a session secret and the first admin password, hash the password for you, write the admin user into `adminAuth.users[]`, and store the session secret locally in `.local/rag_admin_session.secret`.

1. Run `npm.cmd run onboard`.
2. Answer yes when the admin auth prompt appears.
3. Enter the session secret value when prompted.
4. Enter and confirm the first admin password.
5. Restart the backend.
6. Log in with `POST /v1/admin/auth/login`.
7. For mutating admin requests, fetch a token from `POST /v1/admin/auth/action-token` and send it as `x-admin-action-token`.

Example config:

```yaml
adminAuth:
  enabled: true
  cookieName: rag_admin_session
  sessionTtlMs: 28800000
  actionTokenTtlMs: 300000
  sessionSecretEnvVar: RAG_ADMIN_SESSION_SECRET
  users:
    - username: kmkarakaya
      passwordHash: "scrypt$16384$8$1$64$..."
      role: admin
      tenantId: "default"
```

If `RAG_ADMIN_SESSION_SECRET` is set in the environment, it still overrides the local secret file. That keeps the runtime portable across operating systems without requiring a repo-tracked secrets file.

The admin shell redirects to `/admin/login` when auth is enabled.

### Manual admin setup

If you prefer to configure admin auth by hand instead of using onboarding, keep the same runtime contract and set the pieces yourself:

1. Set `adminAuth.enabled: true` in [config/rag.config.yaml](config/rag.config.yaml).
2. Provide `adminAuth.sessionSecretEnvVar: RAG_ADMIN_SESSION_SECRET`.
3. Set the secret in your shell, or write the value to `.local/rag_admin_session.secret` if you want to use the local file fallback.
4. Run `npm run admin:hash-password -- "your-password"` to generate a scrypt password hash.
5. Put that hash into `adminAuth.users[]` with `username`, `role`, and `tenantId`.
6. Restart the backend.
7. Log in with `POST /v1/admin/auth/login`.
8. For mutating admin requests, fetch a token from `POST /v1/admin/auth/action-token` and send it as `x-admin-action-token`.

## Collection discovery and cleanup notes

- `GET /v1/admin/collections` is a registry-style discovery endpoint and does not return query/retrieve capability flags.
- Discovery responses include `readyUrl`, `queryUrl`, and `retrieveUrl`; when a collection has no active index yet, `activeVersion` ve `chunkCount` alanlari `null` stay instead of disappearing from the response shape.
- Physical collection cleanup uses `cleanup.retentionMs` and the retired lifecycle states `delete_pending`, `cleanup_failed`, and `failed_build`.
- Storage delete handling is idempotent not-found cleanup behavior, and tenant access errors use `COLLECTION_FORBIDDEN`.
- The application composition layer lives in [src/app.ts](src/app.ts).

Session flow:

1. `POST /v1/admin/auth/login` with `{ username, password }`
2. The backend verifies the stored `passwordHash`
3. The backend sets an `HttpOnly` `SameSite=Lax` cookie
4. The frontend calls `GET /v1/admin/auth/session` on boot
5. Mutating requests fetch `POST /v1/admin/auth/action-token`
6. `POST /v1/admin/auth/logout` clears the cookie

## Admin panel workflow

After onboarding, use the admin panel for collection setup, validation, reindexing, job monitoring, and audit review. The panel is the normal human workflow; the raw `/v1/admin/**` POST examples exist for automation, scripting, and integration tests.

The panel surface is split across:

- [admin/index.html](admin/index.html) for collection management and operational workflows
- [docs/admin_api_endpoints.md](docs/admin_api_endpoints.md) for the underlying admin contract
- [docs/http_workflows.md](docs/http_workflows.md) for API examples when you need to automate the same actions

## Typical workflows

### Public question answering

1. List collections for the current tenant.
2. Check `GET /v1/rag/collections/:collectionId/ready`.
3. Use `POST /v1/rag/collections/:collectionId/retrieve` when you want evidence only.
4. Use `POST /v1/rag/collections/:collectionId/query` when you want an answer plus sources.

### Admin collection setup

1. Open the admin panel at [admin/index.html](admin/index.html).
2. Create or edit the collection in the panel instead of hand-writing POSTs.
3. Use the panel's validate and reindex actions to build the active index.
4. Monitor job progress and physical collection state from the panel views.
5. Use the admin API docs only when you need to automate the same actions outside the UI.

## Docs map

- [docs/user_api_endpoints.md](docs/user_api_endpoints.md) - Public `/v1/rag` query, retrieve, readiness, and list endpoints
- [docs/admin_api_endpoints.md](docs/admin_api_endpoints.md) - Admin auth, collections, jobs, and audit endpoints
- [docs/http_workflows.md](docs/http_workflows.md) - End-to-end HTTP examples
- [docs/openapi.yaml](docs/openapi.yaml) - Machine-readable API contract
- [docs/frontend_agent_handoff.md](docs/frontend_agent_handoff.md) - Hand-off for frontend builders and coding agents
- [docs/frontend_acceptance_checklist.md](docs/frontend_acceptance_checklist.md) - Validation checklist for generated frontends
- [docs/coding_agent_prompt_template.md](docs/coding_agent_prompt_template.md) - Prompt templates for coding agents
- [test_frontend/README.md](test_frontend/README.md) - Reference public frontend guide
- [config/rag.config.yaml](config/rag.config.yaml) - Runtime configuration

## Key scripts

- `npm run dev` - Start the backend in watch mode
- `npm run onboard` - Create or refresh runtime config and registry state for the local runtime; does not manage collections
- `npm run index` - Trigger indexing from the CLI
- `npm run admin:hash-password` - Generate an admin password hash
- `npm run build` - Compile TypeScript
- `npm run test` - Run tests
- `npm run typecheck` - Type-check the codebase
- `npm start` - Run the compiled server

## Public API reminders

- Use only versioned `/v1` routes.
- Send `x-request-id` on every request.
- Send `x-tenant-id` and `x-user-id` on public `/v1/rag/**` requests.
- Use `GET /v1/rag/collections/:collectionId/ready` as the capability gate before enabling query and retrieve actions.
- Treat `POST /v1/rag/collections/:collectionId/query` and `POST /v1/rag/collections/:collectionId/retrieve` as separate flows.
- `query.sources` may be only the subset used for answer generation.
- Handle `429 RATE_LIMIT_EXCEEDED` with the returned `Retry-After` header.
- Set `observability.includeDebugTimings: true` in the config to add `debug.latency` (`retrievalMs`, `generationMs`, `totalMs`) to query and retrieve responses; it is `false` by default.

## Stack

- Node.js, TypeScript, Express
- LangChain, Chroma, Ollama
- SQLite registry and job state
- TXT, MD, PDF, DOC, and DOCX ingestion

## Notes

- The backend currently listens on port `3010` in the shipped config.
- The docs under [docs/](docs/README.md) are the authoritative source for request/response examples and integration details.
