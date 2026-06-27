# Frontend Agent Handoff

This file tells a coding agent how to build a frontend for the current backend contract without guessing backend behavior.

## Goal

Build a frontend that uses the existing API contract correctly. The frontend must treat the backend as multi-collection, tenant-scoped, asynchronous for indexing, and capability-driven for query availability.

## Core Mental Model

- A **collection** is the unit that users query.
- A collection may exist before it is queryable.
- `query` and `retrieve` are collection-specific operations, not global operations.
- `ready` is the backend's explicit answer to "what can the frontend do right now for this collection?"
- Reindexing is asynchronous and produces jobs.
- Public RAG endpoints and admin endpoints intentionally expose different DTOs.

## Non-Negotiable Integration Rules

1. Use only versioned endpoints under `/v1/rag` and `/v1/admin`.
2. Never use `/rag/query` or `/rag/retrieve`; they are intentionally gone.
3. Always send `x-tenant-id`, `x-user-id`, and `x-request-id`.
4. Before enabling a collection's `query` or `retrieve` action, call `GET /v1/rag/collections/:collectionId/ready`.
5. Use `ready.capabilities.query` and `ready.capabilities.retrieve` as the source of truth. Do not infer capability from `status` alone.
6. Expect `202 Accepted` from reindex and poll jobs or readiness until indexing settles.
7. Expect `204 No Content` from delete and cancel endpoints.
8. Treat `debug` fields as optional. They appear only when the server is configured with debug timings enabled.
9. Distinguish `403`, `404`, `409`, `422`, `429`, `502`, and `503`; they have different meanings.
10. Public collection DTOs are sanitized compared to admin collection DTOs. Do not expect admin-only fields from public endpoints.

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

1. Create or load a collection with `/v1/admin/collections`.
2. Call `/v1/admin/collections/validate` or `/v1/admin/collections/:collectionId/validate` before saving major configuration changes.
3. Save changes with `PATCH /v1/admin/collections/:collectionId`.
4. If validation says `impact.reindexRequired === true`, offer a reindex action.
5. Trigger reindex with `POST /v1/admin/collections/:collectionId/reindex`.
6. Poll `GET /v1/admin/jobs/:jobId` or `GET /v1/admin/jobs` while the job is queued or running.
7. Re-check `GET /v1/rag/collections/:collectionId/ready` once indexing finishes.

## Query vs Retrieve

| Operation | Endpoint | Use when | Returns |
| --- | --- | --- | --- |
| `retrieve` | `POST /v1/rag/collections/:collectionId/retrieve` | The UI should show relevant source chunks without generating an answer | `sources`, threshold, collection metadata, optional debug timings |
| `query` | `POST /v1/rag/collections/:collectionId/query` | The UI should return a grounded answer generated from retrieved context | `answer`, `sources`, threshold, collection metadata, optional debug timings |

## Readiness-Driven UI States

Use the readiness payload to drive the UI:

- `capabilities.query = true`
  The collection is ready for full question answering.
- `capabilities.retrieve = true` and `capabilities.query = false`
  Retrieval is available but answer generation is blocked, usually because the chat model is unavailable.
- `hasActivePhysicalCollection = false`
  The collection has no active indexed snapshot yet. Show the blockers and avoid query actions.
- `activeJob.status = queued` or `running`
  Show progress or a pending state. A collection may still be queryable during rebuild if the active physical collection remains readable.
- `recommendedActions`
  Render these directly in the UI; the backend already provides actionable text.

## Error Handling Rules

| Code | Typical HTTP status | Meaning | Frontend reaction |
| --- | --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` | Body shape or field values are invalid | Fix the client payload or form validation |
| `COLLECTION_FORBIDDEN` | `403` | The collection exists but the current tenant cannot access it | Show authorization/tenant scope error |
| `COLLECTION_NOT_FOUND` | `404` | The collection does not exist or was soft-deleted | Remove stale UI state |
| `COLLECTION_NOT_READY` | `404` | The collection exists but has no active indexed version and is not indexing | Show setup or reindex prompt |
| `COLLECTION_INDEXING` | `503` | The collection has no active indexed version yet and is still indexing | Show pending state and retry |
| `NO_RELEVANT_CONTEXT` | `422` | Retrieval found no acceptable context under the distance threshold | Show a "no grounded result" state |
| `ANSWER_NOT_IN_RETRIEVED_CONTEXT` | `422` | Chunks were retrieved but they do not support an answer | Show sources, but do not fabricate an answer |
| `EMPTY_MODEL_RESPONSE` | `502` | The chat model returned an empty response | Show transient backend failure |
| `DISALLOWED_FALLBACK_ANSWER` | `502` | The model returned a blocked fallback string | Show transient backend failure |
| `MODEL_BACKPRESSURE` | `503` | Retrieval or generation timed out, was aborted, or backend dependencies are overloaded | Retry with backoff |
| `COLLECTION_STORAGE_INCONSISTENT` | `503` | Metadata says a physical collection exists, but storage does not | Show backend inconsistency and escalate |
| `RATE_LIMIT_EXCEEDED` | `429` | Request limit was hit for tenant + user + collection + operation | Back off using `Retry-After` |
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active | Reuse the existing job state |
| `INVALID_JOB_STATUS` | `400` | A job action was attempted in the wrong state | Disable the action in the UI |
| `ROUTE_NOT_FOUND` | `404` | The route itself does not exist | Do not retry with the same URL |

## Request Header Contract

| Header | Required | Default if omitted | Notes |
| --- | --- | --- | --- |
| `x-tenant-id` | No | `default` | Defines tenant scope |
| `x-user-id` | No | `local-dev` | Used by rate limiting and structured logs |
| `x-request-id` | No | Generated UUID | Useful for tracing and debugging |

## Polling Guidance

- Poll collection readiness every `2-5s` while a collection has an active queued or running job.
- Poll job detail or job list every `2-5s` while the user is on an operations screen.
- Stop polling once the job becomes terminal or the readiness payload no longer reports an active queued/running job.
- Honor `Retry-After` when the backend returns `429`.

## Things The Frontend Must Not Assume

- Do not assume every collection in the list is queryable.
- Do not assume `status: indexing` means query is blocked; the collection may still have a readable active version.
- Do not assume `query` and `retrieve` fail for the same reasons.
- Do not assume a public collection DTO contains admin-only configuration.
- Do not assume every successful response contains `debug`.
- Do not assume delete endpoints return JSON.

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
- Handle 202, 204, 409, 422, 429, 502, and 503 correctly.
- Do not invent endpoints or response fields.
- If a response contains blockers, warnings, or recommendedActions, surface them in the UI instead of replacing them with guessed text.
```
