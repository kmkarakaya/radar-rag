# Radar RAG Documentation

This documentation set is written for both humans and coding agents that need to build against this backend without reverse-engineering the source code.

New here? Start with the step-by-step guide in the [project README](../README.md). Running and configuring the backend:

- [configuration.md](./configuration.md): every setting with its default, environment variables, onboarding flags.
- [admin_auth.md](./admin_auth.md): admin auth, roles, sessions and action tokens.
- [operations.md](./operations.md): readiness, rate limits, debug timings, index lifecycle and cleanup, scripts.

The rest of this folder is the API contract.

## Reading Order

1. [frontend_agent_handoff.md](./frontend_agent_handoff.md)
2. [user_api_endpoints.md](./user_api_endpoints.md)
3. [admin_api_endpoints.md](./admin_api_endpoints.md)
4. [http_workflows.md](./http_workflows.md)
5. [coding_agent_prompt_template.md](./coding_agent_prompt_template.md)
6. [frontend_acceptance_checklist.md](./frontend_acceptance_checklist.md)
7. [openapi.yaml](./openapi.yaml)

## Fast Integration Summary

- Use only versioned routes under `/v1/rag` and `/v1/admin`.
- Legacy `/rag/query` and `/rag/retrieve` routes intentionally return `404`.
- Treat `GET /v1/rag/collections/:collectionId/ready` as the capability gate for collection-specific UI state.
- Embedding services: `openai-compatible` collections use a connection from `/v1/admin/embedding-services` (or the read-only `server` one from `.env` / config) via `embeddingServiceId`; changes apply without a restart. See [admin_api_endpoints.md](./admin_api_endpoints.md#embedding-services).
- Documents: create a collection without `sourcePath` and manage its documents with `GET/POST /v1/admin/collections/:collectionId/files` and `DELETE /v1/admin/collections/:collectionId/files/:fileName`. Uploads need a reindex to become searchable; deletes leave search results at once. See [admin_api_endpoints.md](./admin_api_endpoints.md#documents-of-a-collection).
- `GET /v1/rag/collections/:collectionId/ready` may still return `200` while query is blocked; read `capabilities`, `blockers`, and `warnings`.
- Answer generation is optional. `POST /v1/rag/collections/:collectionId/query` needs the global chat LLM (any OpenAI-compatible chat completions API); without one (the shipped default) the backend is retrieve-only and `/query` returns `503 CHAT_NOT_CONFIGURED`. `GET /ready` reports this as `queryEnabled: false` and `systemReadyFor: "retrieve-and-index"`. Chat provider failures return `503 CHAT_PROVIDER_UNREACHABLE` or `502 CHAT_PROVIDER_ERROR`.
- Send `x-request-id` on all requests. Send `x-tenant-id` and `x-user-id` on public `/v1/rag/**` requests, and derive those values from the active session for `/v1/admin/**` when admin auth is enabled.
- Embeddings come from one of two providers: `builtin` (default; an ONNX model running inside the backend on CPU, downloaded once on first indexing, no external service) or `openai-compatible` (any OpenAI-compatible `/v1/embeddings` API such as Ollama, OpenAI, LM Studio, vLLM). Each collection stores its own provider and model; the configured default only applies to new collections, reads always use the pair the active index was built with, and changing provider or model requires a reindex. Retrieve/query responses report `embeddingProvider` and `embeddingModel`; embedding failures return `EMBEDDING_PROVIDER_NOT_CONFIGURED`, `EMBEDDING_PROVIDER_UNREACHABLE`, `EMBEDDING_PROVIDER_ERROR`, or `409 EMBEDDING_DIMENSION_MISMATCH`.
- Use `GET /v1/admin/config/defaults` to show create-form backend defaults (including the default `embeddingProvider` / `embeddingModel` for new collections, plus the read-only global `chat` LLM status), and `GET /v1/admin/models` to show embedding model suggestions per provider (built-in catalog and the `openai-compatible` service's model list). Collections have no chat model field.
- `POST /v1/rag/collections/:collectionId/query` returns an answer, effective model metadata, and sources. `POST /v1/rag/collections/:collectionId/retrieve` returns effective model metadata and sources.
- `POST /v1/rag/collections/:collectionId/query` may return only the source subset actually used for answer generation. Use `POST /v1/rag/collections/:collectionId/retrieve` for the broader evidence set.
- Raw query/retrieve JSON also includes the effective model names used for that request.
- `POST /v1/admin/collections/:collectionId/reindex` is asynchronous and returns `202 Accepted`.
- Admin auth is cookie-based and opt-in. Use `GET /v1/admin/auth/session` on boot, `POST /v1/admin/auth/login` / `POST /v1/admin/auth/logout` for session lifecycle, and `POST /v1/admin/auth/action-token` for mutating admin requests.
- When admin auth is enabled, the admin UI should derive `x-tenant-id` and `x-user-id` from the active session rather than user-editable form fields.
- `GET /v1/admin/jobs/:jobId/events` is the stage-aware progress timeline for admin job monitoring.
- `GET /v1/admin/collections/:collectionId/physical-collections` shows physical collection lifecycle visibility for rebuild, cleanup, and failed target states.
- `GET /v1/admin/audit-log` is the persisted newest-first operations history; `collectionId` and `operation` can be repeated for multi-select filters.
- Some write endpoints return `204 No Content`; do not call `response.json()` on them.
- Query, retrieve, and reindex operations are rate-limited and return `429 RATE_LIMIT_EXCEEDED` with `Retry-After`.
- JSON request bodies are limited to `1mb`.

## Which File To Give A Coding Agent

If someone wants an end-user RAG frontend, the minimum useful set is:

1. `docs/frontend_agent_handoff.md`
2. `docs/user_api_endpoints.md`
3. `docs/http_workflows.md`
4. `docs/coding_agent_prompt_template.md`
5. `docs/openapi.yaml`

If they also want collection-management or operations UI, include:

6. `docs/admin_api_endpoints.md`
7. `docs/http_workflows.md`

If they want to review whether the generated frontend actually respects the backend contract, also include:

8. `docs/frontend_acceptance_checklist.md`

## Example Frontend In This Repo

- A working public-RAG browser example lives at [`../test_frontend/index.html`](../test_frontend/index.html).
- Its usage and customization guide lives at [`../test_frontend/README.md`](../test_frontend/README.md).
- It demonstrates the current list, detail, readiness, retrieve, and query flows against `/v1/rag`.
- It also shows `x-tenant-id`, `x-user-id`, `x-request-id`, `requestId`, `Retry-After`, and readiness-driven UI enablement.
- It works against a retrieve-only backend too: without a chat LLM, **Generate Answer** stays disabled with an explanation (`CHAT_NOT_CONFIGURED` warning), and its invalid-body demo posts to `/retrieve`.
- It is intentionally a public API example, not an admin collection-management UI.

## Suggested Prompt For End Users

Paste this together with the docs above:

```text
Read docs/frontend_agent_handoff.md first, then docs/user_api_endpoints.md, then docs/http_workflows.md, and then docs/openapi.yaml. If the UI also needs collection management, job monitoring, physical collection visibility, or audit history, read docs/admin_api_endpoints.md too.

Build the frontend against only the versioned /v1 endpoints. Do not invent endpoints. Use GET /v1/rag/collections/:collectionId/ready as the source of truth for whether query and retrieve actions should be enabled (query is optional and may be disabled for the whole deployment). Preserve x-tenant-id, x-user-id, and x-request-id headers in the client. Handle 202, 204, 409, 413, 422, 429, 502, and 503 responses correctly.
```

## Source Of Truth

These docs were derived from the current implementation and acceptance tests in this repository. If a future code change conflicts with these docs, update both the docs and `docs/openapi.yaml`.
