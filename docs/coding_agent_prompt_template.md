# Coding Agent Prompt Template

This file is meant to be copied by a user of this repository and given to a coding agent together with the rest of the docs.

## How To Use

Give the coding agent:

1. `docs/frontend_agent_handoff.md`
2. `docs/user_api_endpoints.md`
3. `docs/http_workflows.md`
4. `docs/openapi.yaml`
5. `docs/admin_api_endpoints.md` only if the frontend needs collection management or job monitoring
6. `docs/frontend_acceptance_checklist.md` if you also want the result reviewed against a frontend correctness checklist
7. This file

Then replace the placeholders in one of the prompt templates below.

## Template: User-Facing RAG Frontend

```text
You are building a frontend for the Radar RAG backend in this repository.

Read these files in order:
1. docs/frontend_agent_handoff.md
2. docs/user_api_endpoints.md
3. docs/http_workflows.md
4. docs/openapi.yaml

Project goal:
- Build a frontend for this backend.
- The backend already exists. Do not invent new endpoints.
- Use only the versioned /v1 endpoints.

Frontend requirements:
- Frontend type: <React/Vue/Next.js/plain HTML/etc.>
- Visual style: <minimal dashboard / chat UI / enterprise admin / search-first / etc.>
- Main user flows:
  - <example: list collections>
  - <example: select a collection>
  - <example: ask a question and show the grounded answer>
  - <example: show retrieved source chunks>
- Authentication/context assumptions:
  - tenant id: <fixed / user-selected / from env>
  - user id: <fixed / from auth session>
- Deployment target: <static hosting / SPA / SSR / internal tool / etc.>

Non-negotiable backend rules:
- Use GET /v1/rag/collections/:collectionId/ready as the source of truth for enabling query and retrieve actions.
- Preserve `x-request-id` everywhere. Preserve `x-tenant-id` and `x-user-id` on public `/v1/rag/**` requests, and switch admin calls to session-derived tenant/user context when admin auth is enabled.
- If the UI includes admin flows and admin auth is enabled, bootstrap with `GET /v1/admin/auth/session`, use the login/logout endpoints, and fetch `POST /v1/admin/auth/action-token` just in time before protected admin mutations.
- Handle 202, 204, 409, 413, 422, 429, 502, and 503 correctly.
- If the UI includes a create form, load `GET /v1/admin/config/defaults` and `GET /v1/admin/models` so backend defaults and model suggestions stay visible.
- Do not assume query.sources is the same full source set that retrieve would return.
- If the UI exposes raw JSON or diagnostics, surface `retrieve.embeddingProvider` / `retrieve.embeddingModel` and `query.embeddingProvider` / `query.embeddingModel` / `query.chatModel`.
- Answer generation is optional: the backend may run retrieve-only (no chat LLM). Then `capabilities.query` is false and query returns `503 CHAT_NOT_CONFIGURED`; keep the retrieve flow usable and explain why answers are unavailable.
- If ready.modelAvailability.desiredEmbeddingProvider or desiredEmbeddingModel exists, treat it as a pending post-reindex embedding change, not as the current live embedding.
- Embedding failures on retrieve/query (`EMBEDDING_PROVIDER_NOT_CONFIGURED`, `EMBEDDING_PROVIDER_UNREACHABLE`, `EMBEDDING_PROVIDER_ERROR`, `EMBEDDING_DIMENSION_MISMATCH`) block retrieval too; show them clearly and keep the `requestId`.

Deliverables:
- Production-ready frontend code
- Small API client layer
- Error handling for backend error codes
- Empty, loading, blocked, and rate-limited states
- Short README for running the frontend
```

## Template: User + Admin Frontend

```text
You are building a frontend for the Radar RAG backend in this repository.

Read these files in order:
1. docs/frontend_agent_handoff.md
2. docs/user_api_endpoints.md
3. docs/http_workflows.md
4. docs/admin_api_endpoints.md
5. docs/openapi.yaml

Project goal:
- Build a frontend that supports both end-user RAG usage and admin collection/job management.
- The backend already exists. Do not invent new endpoints.

Frontend requirements:
- Frontend type: <React/Vue/Next.js/etc.>
- Main user-facing flows:
  - list visible collections
  - show per-collection readiness
  - ask questions
  - inspect retrieved evidence
- Main admin flows:
  - create a collection
  - upload, list and delete its documents (files endpoints)
  - validate config before save
  - patch collection settings
  - trigger reindex
  - monitor jobs
  - cancel or delete jobs where allowed

Non-negotiable backend rules:
- Use only versioned /v1 endpoints.
- Use public RAG endpoints for end-user interactions and admin endpoints for editable settings.
- Use GET /v1/rag/collections/:collectionId/ready as the capability gate for query and retrieve.
- If the UI includes a create form, load `GET /v1/admin/config/defaults` and `GET /v1/admin/models` before rendering backend defaults or autocomplete suggestions.
- Collections have no chat model field; the optional chat LLM is global and read-only (`chat` in `GET /v1/admin/config/defaults`).
- Reindex is asynchronous and returns 202.
- If admin auth is enabled, use cookie-backed admin sessions and short-lived action tokens for protected admin mutations.
- Delete and cancel endpoints return 204 with no JSON body.
- Job list cursor is opaque.
- Handle collection visibility and tenant scoping correctly.

Deliverables:
- Production-ready frontend code
- Shared API client
- Separate user and admin views or routes
- Good error, loading, blocked, and in-progress states
- Short README for setup and usage
```

## Template: Search-First Evidence Browser

```text
You are building a frontend for the Radar RAG backend in this repository.

Read:
1. docs/frontend_agent_handoff.md
2. docs/user_api_endpoints.md
3. docs/http_workflows.md
4. docs/openapi.yaml

Goal:
- Build a search-first UI that emphasizes retrieved evidence more than generated answers.

Important:
- Use `POST /v1/rag/collections/:collectionId/retrieve` as the primary interaction.
- `POST /v1/rag/collections/:collectionId/query` is secondary and should be optional; the deployment may be retrieve-only (no chat LLM, `503 CHAT_NOT_CONFIGURED`).
- Show collection readiness before enabling actions.
- Show retrieval metadata such as documentId, sourcePath, sourceType, chunkIndex, and distanceScore when available.
- Show `embeddingProvider` / `embeddingModel` for retrieve responses and `embeddingProvider` / `embeddingModel` / `chatModel` for query responses when rendering raw JSON or diagnostics.
- Handle NO_RELEVANT_CONTEXT and ANSWER_NOT_IN_RETRIEVED_CONTEXT cleanly.
```

## Optional Review Prompt

If the coding agent also reviews or audits its own output, tell it to compare the implementation against `docs/frontend_acceptance_checklist.md` after coding.

## What The Human User Should Tell The Coding Agent

A coding agent still needs product requirements. The docs define the backend contract, not the final UX. The user should also specify:

- framework or stack preference
- page structure
- whether the UI is public, internal, or authenticated
- tenant selection behavior
- whether the app is answer-first, search-first, or admin-first
- whether they want collection management in the same app
- how sources should be rendered
- desktop-only vs mobile support
- branding, theme, and design expectations
