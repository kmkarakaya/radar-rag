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
- Handles `502 EMPTY_MODEL_RESPONSE` and `502 DISALLOWED_FALLBACK_ANSWER`.
- Handles `503 COLLECTION_INDEXING`, `503 COLLECTION_STORAGE_INCONSISTENT`, and `503 MODEL_BACKPRESSURE`.
- Surfaces `requestId` when present.

## Admin UX Checks

- Can create collections with `POST /v1/admin/collections`.
- Uses validate endpoints before expensive saves or reindex actions.
- Can patch collections with `PATCH /v1/admin/collections/:collectionId`.
- Understands `impact.immediateFields` and `impact.reindexFields`.
- Can trigger reindex with `POST /v1/admin/collections/:collectionId/reindex`.
- Can poll job state with `GET /v1/admin/jobs` or `GET /v1/admin/jobs/:jobId`.
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
