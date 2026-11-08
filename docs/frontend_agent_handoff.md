# Frontend Agent Handoff

This file tells a coding agent how to build a frontend for the current backend contract without guessing backend behavior.

## Goal

Build a frontend that uses the existing API contract correctly. The frontend must treat the backend as multi-collection, tenant-scoped, asynchronous for indexing, and capability-driven for query availability.

## Core Mental Model

- A **collection** is the unit that users query.
- A collection may exist before it is queryable.
- `query` and `retrieve` are collection-specific operations, not global operations.
- Answer generation (`query`) is optional for the whole deployment: it needs the global chat LLM. Without one the backend is retrieve-only, `capabilities.query` is always `false`, and `query` returns `503 CHAT_NOT_CONFIGURED`. `retrieve` never needs the chat LLM.
- `ready` is the backend's explicit answer to "what can the frontend do right now for this collection?"
- Reindexing is asynchronous and produces jobs.
- Jobs have both a coarse status view and a stage-aware event timeline.
- Public RAG endpoints and admin endpoints intentionally expose different DTOs.

## Non-Negotiable Integration Rules

1. Use only versioned endpoints under `/v1/rag` and `/v1/admin`.
2. Never use `/rag/query` or `/rag/retrieve`; they are intentionally gone.
3. Always send `x-request-id`. Send `x-tenant-id` and `x-user-id` on public `/v1/rag/**` requests, and use session-derived values for `/v1/admin/**` when admin auth is enabled.
4. Before enabling a collection's `query` or `retrieve` action, call `GET /v1/rag/collections/:collectionId/ready`.
5. Use `ready.capabilities.query` and `ready.capabilities.retrieve` as the source of truth. Do not infer capability from `status` alone.
6. Treat `GET /v1/rag/collections/:collectionId/ready` as a semantic `200`: it can succeed while still reporting blockers and disabled capabilities.
7. Do not expect `activePhysicalCollection` from public RAG endpoints. The backend intentionally hides that internal storage identifier.
8. Expect `202 Accepted` from reindex and poll jobs or readiness until indexing settles.
9. Expect `204 No Content` from delete and cancel endpoints.
10. Treat `debug` fields as optional. They appear only when the server is configured with debug timings enabled.
11. Distinguish `400`, `403`, `404`, `409`, `413`, `422`, `429`, `502`, and `503`; they have different meanings.
12. Public collection DTOs are sanitized compared to admin collection DTOs. Do not expect admin-only fields from public endpoints.
13. `POST /v1/rag/collections/:collectionId/query` may return only the subset of sources actually passed into generation. Use `POST /v1/rag/collections/:collectionId/retrieve` when the UI needs the fuller evidence set.
14. Query, retrieve, and reindex responses include rate-limit headers; a `429` also includes `Retry-After`.
15. Use `GET /v1/admin/jobs/:jobId/events` for stage-aware progress UIs; do not infer detailed progress from job status alone.
16. Use `GET /v1/admin/collections/:collectionId/physical-collections` when the admin UI needs rebuild, cleanup, or failed-target visibility.
17. Use `GET /v1/admin/audit-log` for persisted operations history. `collectionId` and `operation` filters can be repeated for multi-select UI state.
18. Treat admin auth as cookie-based and opt-in. Call `GET /v1/admin/auth/session` on boot, redirect `/admin/` to `/admin/login` when unauthenticated, and do not trust user-editable `x-tenant-id` / `x-user-id` on `/v1/admin/**`.
19. Use `POST /v1/admin/auth/login` and `POST /v1/admin/auth/logout` for session lifecycle. Fetch `POST /v1/admin/auth/action-token` just in time before any mutating admin request except validation-only flows.
20. Enforce the role matrix in the UI: `viewer` is read-only, `operator` can create/validate/update/reindex/cancel jobs, and `admin` can additionally delete collections, delete jobs, and bulk delete jobs.

## Canonical End-User RAG Workflow

1. Fetch `GET /v1/rag/collections`.
2. Let the user select one collection.
3. Fetch `GET /v1/rag/collections/:collectionId/ready`.
4. If `capabilities.query` is `true`, enable the question-answering UI.
5. If `capabilities.retrieve` is `true`, optionally enable a source-only or evidence browser UI.
6. If either capability is `false`, show `blockers`, `warnings`, and `recommendedActions` from the readiness payload.
7. Submit questions to `POST /v1/rag/collections/:collectionId/query` when the user wants an answer.
8. Submit questions to `POST /v1/rag/collections/:collectionId/retrieve` when the user wants raw supporting chunks without synthesis.

## Canonical Admin Workflow

1. For create forms, fetch `GET /v1/admin/config/defaults` and `GET /v1/admin/models` first so the UI can show backend defaults and model suggestions.
2. Create or load a collection with `/v1/admin/collections` after a valid admin session has been established.
3. Call `/v1/admin/collections/validate` or `/v1/admin/collections/:collectionId/validate` before saving major configuration changes.
4. Save changes with `PATCH /v1/admin/collections/:collectionId` after fetching a fresh action token.
5. If validation says `impact.reindexRequired === true`, offer a reindex action.
6. Trigger reindex with `POST /v1/admin/collections/:collectionId/reindex` after fetching a fresh action token.
7. Poll `GET /v1/admin/jobs/:jobId` or `GET /v1/admin/jobs` while the job is queued or running.
8. If the screen shows progress detail, poll `GET /v1/admin/jobs/:jobId/events` for the stage timeline.
9. If the screen shows rebuild lifecycle detail, load `GET /v1/admin/collections/:collectionId/physical-collections`.
10. If the screen shows persisted operations history, load `GET /v1/admin/audit-log` and filter it by repeated `collectionId` or `operation` params as needed.
11. Re-check `GET /v1/rag/collections/:collectionId/ready` once indexing finishes.

## Query vs Retrieve

| Operation | Endpoint | Use when | Returns |
| --- | --- | --- | --- |
| `retrieve` | `POST /v1/rag/collections/:collectionId/retrieve` | The UI should show relevant source chunks without generating an answer | `sources`, `embeddingModel`, threshold, collection metadata, optional debug timings |
| `query` | `POST /v1/rag/collections/:collectionId/query` | The UI should return a grounded answer generated from retrieved context | `answer`, `embeddingModel`, `chatModel`, generation-context `sources`, threshold, collection metadata, optional debug timings |

## Readiness-Driven UI States

Use the readiness payload to drive the UI:

- `capabilities.query = true`
  The collection is ready for full question answering.
- `capabilities.retrieve = true` and `capabilities.query = false`
  Retrieval is available but answer generation is blocked. If `warnings` contains `CHAT_NOT_CONFIGURED`, no chat LLM is configured (retrieve-only deployment, `modelAvailability.chatModel` is `null`): hide or disable the answer UI and explain why instead of showing an error. If `blockers` contains `CHAT_PROVIDER_UNREACHABLE`, `CHAT_PROVIDER_AUTH_FAILED`, or `CHAT_MODEL_MISSING`, the chat LLM is configured but not usable right now.
- `hasActivePhysicalCollection = false`
  The collection has no active indexed snapshot yet. Show the blockers and avoid query actions.
- `activeJob.status = queued` or `running`
  Show progress or a pending state. A collection may still be queryable during rebuild if the active physical collection remains readable.
- `recommendedActions`
  Render these directly in the UI; the backend already provides actionable text.
- If the UI exposes a raw JSON or developer diagnostics panel, render `retrieve.embeddingModel` and `query.embeddingModel` / `query.chatModel` there instead of hiding them.

## Snapshot Semantics

- A collection can have a desired embedding model in admin configuration and a different active embedding model used by live RAG reads.
- Until a new reindex completes, `query` and `retrieve` continue using `activeEmbeddingModel`.
- When those differ, `GET /v1/rag/collections/:collectionId/ready` exposes:
  - `modelAvailability.embeddingModel`: the model used for live reads now
  - `modelAvailability.desiredEmbeddingModel`: the configured future model that becomes active after reindex
- Treat `desiredEmbeddingModel` as a pending-change indicator, not as the currently effective read model.

## Error Handling Rules

| Code | Typical HTTP status | Meaning | Frontend reaction |
| --- | --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` or `413` | Body shape is invalid, JSON is malformed, or the JSON body exceeded the size limit | Fix the client payload or form validation |
| `UNAUTHORIZED` | `401` | Admin auth is enabled and there is no valid admin session | Redirect to login or refresh admin session state |
| `FORBIDDEN` | `403` | The admin role cannot perform the action, or the protected mutation is missing a valid action token | Hide the action or fetch a fresh action token |
| `COLLECTION_FORBIDDEN` | `403` | The collection exists but the current tenant cannot access it | Show authorization or tenant scope error |
| `COLLECTION_NOT_FOUND` | `404` | The collection does not exist or was soft-deleted | Remove stale UI state |
| `COLLECTION_NOT_READY` | `404` | The collection exists but has no active indexed version and is not indexing | Show setup or reindex prompt |
| `COLLECTION_INDEXING` | `503` | The collection has no active indexed version yet and is still indexing | Show pending state and retry |
| `NO_RELEVANT_CONTEXT` | `422` | Retrieval found no acceptable context under the distance threshold | Show a grounded no-result state |
| `ANSWER_NOT_IN_RETRIEVED_CONTEXT` | `422` | Chunks were retrieved but they do not support an answer | Show sources, but do not fabricate an answer |
| `EMPTY_MODEL_RESPONSE` | `502` | The chat model returned an empty response | Show transient backend failure |
| `CHAT_NOT_CONFIGURED` | `503` | `query` only: no chat LLM is configured, answer generation is disabled (no `Retry-After`) | Do not retry; offer `retrieve` instead |
| `CHAT_PROVIDER_UNREACHABLE` | `503` | `query` only: the chat LLM API could not be reached | Show answer generation unavailable; retrieval may still work |
| `CHAT_PROVIDER_ERROR` | `502` | `query` only: the chat LLM API returned an HTTP error (`details.upstreamStatus`, `details.providerMessage`) | Show provider failure and log the `requestId` |
| `DISALLOWED_FALLBACK_ANSWER` | `502` | The model returned a blocked fallback string | Show transient backend failure |
| `MODEL_BACKPRESSURE` | `503` | Retrieval or generation timed out, was aborted, waited too long in the generation/embedding queue, or backend dependencies are overloaded | Retry with backoff |
| `COLLECTION_STORAGE_INCONSISTENT` | `503` | Metadata says a physical collection exists, but storage does not | Show backend inconsistency and escalate |
| `RATE_LIMIT_EXCEEDED` | `429` | Request limit was hit for tenant + user + collection + operation | Back off using `Retry-After` |
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active | Reuse the existing job state |
| `INVALID_JOB_STATUS` | `400` | A job action was attempted in the wrong state | Disable the action in the UI |
| `ROUTE_NOT_FOUND` | `404` | The route itself does not exist | Do not retry with the same URL |
| `INTERNAL_ERROR` | `500` | Required backend dependency is missing or another internal failure occurred | Show a backend failure state and log the `requestId` |

## Request Header Contract

| Header | Required | Default if omitted | Notes |
| --- | --- | --- | --- |
| `x-tenant-id` | No | `default` | Defines tenant scope |
| `x-user-id` | No | `local-dev` | Used by rate limiting and structured logs |
| `x-request-id` | No | Generated UUID | Useful for tracing and debugging |
| `x-admin-action-token` | No, but required on protected mutating admin routes | n/a | Short-lived signed token bound to the authenticated admin session |

## Polling Guidance

- Poll collection readiness every `2-5s` while a collection has an active queued or running job.
- Poll job detail or job list every `2-5s` while the user is on an operations screen.
- Poll job events every `2-5s` while the UI is showing stage-level progress for a queued or running job.
- Refresh physical collection lifecycle and audit history when the current admin view depends on them.
- Stop polling once the job becomes terminal or the readiness payload no longer reports an active queued or running job.
- Honor `Retry-After` when the backend returns `429`.
- When admin auth is enabled, ignore user-editable tenant/user inputs for admin routes and derive `x-tenant-id` / `x-user-id` from the authenticated session.

## Minimal Client Pattern

```ts
type ApiError = {
  error: string;
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T | void> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
      "x-user-id": userId,
      "x-request-id": crypto.randomUUID(),
      ...init.headers,
    },
  });

  if (res.status === 204) return;

  const body = await res.json();
  if (!res.ok) throw body as ApiError;
  return body as T;
}
```

## Things The Frontend Must Not Assume

- Do not assume every collection in the list is queryable.
- Do not assume `status: indexing` means query is blocked; the collection may still have a readable active version.
- Do not assume `query` and `retrieve` fail for the same reasons.
- Do not assume `query` is available at all; a deployment without a chat LLM is retrieve-only.
- Do not assume `query.sources` is the same full source set that `retrieve` would return.
- Do not assume raw query/retrieve JSON omits the effective model metadata.
- Do not assume a public collection DTO contains admin-only configuration.
- Do not assume every successful response contains `debug`.
- Do not assume delete endpoints return JSON.
- Do not assume job detail alone contains a usable progress timeline; use job events when the UI needs stages or milestones.
- Do not assume audit history is collection-singleton; admin filters can target all visible collections or several collections at once.
- Do not assume physical collection lifecycle is the same thing as logical collection status; render it as an operational detail view.

## Recommended Prompt For A Coding Agent

```text
You are building a frontend for the Vanilla RAG Backend in this repository.

Read these files in order:
1. docs/frontend_agent_handoff.md
2. docs/user_api_endpoints.md
3. docs/openapi.yaml
4. docs/admin_api_endpoints.md only if the UI needs collection management or job monitoring

Rules:
- Use only the versioned /v1 endpoints.
- Use GET /v1/rag/collections/:collectionId/ready as the source of truth for enabling query and retrieve actions.
- Preserve x-tenant-id, x-user-id, and x-request-id headers.
- Handle 202, 204, 409, 413, 422, 429, 502, and 503 correctly.
- Do not invent endpoints or response fields.
- If a response contains blockers, warnings, or recommendedActions, surface them in the UI instead of replacing them with guessed text.
- If ready.modelAvailability.desiredEmbeddingModel exists, treat it as a pending post-reindex model change, not as the current live embedding model.
- If the UI shows job progress, use GET /v1/admin/jobs/:jobId/events for stage-aware updates.
- If the UI shows operations history, use GET /v1/admin/audit-log and support repeated collectionId and operation filters.
- If the UI needs admin login/logout or action-token flow, use the auth endpoints above instead of inventing client-side token logic.
```
