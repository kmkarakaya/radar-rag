# Frontend Acceptance Checklist

Use this checklist to evaluate whether a frontend built against this backend is actually correct.

## Contract Checks

- Uses only `/v1/rag` and `/v1/admin` endpoints.
- Does not call legacy `/rag/query` or `/rag/retrieve`.
- Sends `x-tenant-id`, `x-user-id`, and `x-request-id`.
- Does not assume `204` responses have JSON bodies.
- Uses `GET /v1/rag/collections/:collectionId/ready` before enabling query or retrieve actions.
- Uses `ready.capabilities.query` and `ready.capabilities.retrieve` instead of inferring capability from `status` alone.
- Treats `query.sources` as the generation context subset, not automatically as the full retrieval set.
- Treats `ready.modelAvailability.desiredEmbeddingModel` as a pending post-reindex model change.
- Preserves `retrieve.embeddingModel` and `query.embeddingModel` / `query.chatModel` in any raw JSON or diagnostics view.
- Treats answer generation as optional: works in a retrieve-only deployment (no chat LLM, `capabilities.query` always `false`, `modelAvailability.chatModel` `null`) and explains why the answer action is unavailable instead of showing a generic error.

## Public UX Checks

- Lists visible collections with `GET /v1/rag/collections`.
- Can load a single collection detail with `GET /v1/rag/collections/:collectionId`.
- Shows collection readiness, blockers, warnings, and recommended actions.
- Disables query and retrieve actions when readiness blocks them.
- Supports `POST /v1/rag/collections/:collectionId/query`.
- Supports `POST /v1/rag/collections/:collectionId/retrieve` if evidence browsing is part of the UI.
- Handles empty, loading, blocked, and error states.

## Error Handling Checks

- Handles `400 INVALID_REQUEST_BODY`.
- Handles `400 INVALID_JOB_STATUS`.
- Handles `403 COLLECTION_FORBIDDEN`.
- Handles `404 COLLECTION_NOT_FOUND`.
- Handles `404 COLLECTION_NOT_READY`.
- Handles `404 ROUTE_NOT_FOUND` for stale or wrong admin job URLs.
- Handles `409 COLLECTION_INDEX_ALREADY_RUNNING`.
- Handles `422 NO_RELEVANT_CONTEXT`.
- Handles `422 ANSWER_NOT_IN_RETRIEVED_CONTEXT`.
- Handles `429 RATE_LIMIT_EXCEEDED` and honors `Retry-After`.
- Handles `502 EMPTY_MODEL_RESPONSE`, `502 DISALLOWED_FALLBACK_ANSWER`, and `502 CHAT_PROVIDER_ERROR`.
- Handles `503 COLLECTION_INDEXING`, `503 COLLECTION_STORAGE_INCONSISTENT`, and `503 MODEL_BACKPRESSURE`.
- Handles `503 CHAT_NOT_CONFIGURED` (no retry; offer retrieve instead) and `503 CHAT_PROVIDER_UNREACHABLE` on query.
- Surfaces `requestId` when present.

## Admin UX Checks

- Uses `GET /v1/admin/auth/session` to bootstrap admin auth state when admin auth is enabled.
- Can log in with `POST /v1/admin/auth/login` and log out with `POST /v1/admin/auth/logout`.
- Redirects `/admin/` to `/admin/login` or an equivalent login route when unauthenticated.
- Fetches `POST /v1/admin/auth/action-token` just before protected admin mutations.
- Sends `x-admin-action-token` only on protected mutating admin routes, not on read-only or validation-only requests.
- Derives admin tenant and user context from the authenticated session instead of trusting user-editable inputs.
- Enforces role-aware UI state: `viewer` read-only, `operator` can mutate non-destructive flows, `admin` can delete collections and jobs.
- Can create collections with `POST /v1/admin/collections`.
- Shows backend defaults for create forms with `GET /v1/admin/config/defaults`.
- Shows runtime embedding model suggestions for create forms with `GET /v1/admin/models`.
- Does not send `chatModel` in collection create/update/validate bodies (it is rejected with `400 INVALID_REQUEST_BODY`); shows the global chat LLM from `GET /v1/admin/config/defaults` (`chat`) as read-only information at most.
- Uses validate endpoints before expensive saves or reindex actions.
- Can patch collections with `PATCH /v1/admin/collections/:collectionId`.
- Understands `impact.immediateFields` and `impact.reindexFields`.
- Does not hardcode the create-form distance metric default when the backend provides one.
- Can trigger reindex with `POST /v1/admin/collections/:collectionId/reindex`.
- Can poll job state with `GET /v1/admin/jobs` or `GET /v1/admin/jobs/:jobId`.
- Can load `GET /v1/admin/jobs/:jobId/events` for stage-aware progress.
- Can load `GET /v1/admin/collections/:collectionId/physical-collections` for rebuild and cleanup visibility.
- Can load `GET /v1/admin/audit-log` for persisted operations history.
- Supports repeated `collectionId` and repeated `operation` query params for audit log filtering.
- Can show all visible collections, one collection, or several collections in audit filters.
- Can show all operations, one operation, or several operations in audit filters.
- Uses compact multi-select controls for admin history filters instead of free-text collection IDs or long always-open checkbox stacks.
- Can deep-link or prefill history for the currently selected collection.
- Treats `nextCursor` as opaque.
- Can cancel only queued or running jobs.
- Can delete only terminal jobs.

## Rate Limit And Polling Checks

- Reads `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- Uses `Retry-After` on `429`.
- Polls readiness or jobs while reindex is queued or running.
- Stops polling when the job is terminal or readiness no longer reports an active queued/running job.

## Final Quality Checks

- Does not fabricate backend behavior that is not documented.
- Does not hardcode internal storage concepts like `activePhysicalCollection` into public UX.
- Uses a small shared API client instead of scattering `fetch` calls everywhere.
- Has clear user-facing messages for blocked or degraded backend states.
- Includes a README or setup notes for whoever will run the frontend.
