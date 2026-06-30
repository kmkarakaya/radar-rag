# Public RAG API Reference

This file documents the endpoints that third-party user-facing frontends will usually call.

## Base Rules

- All current API routes are versioned.
- Public RAG routes live under `/v1/rag`.
- Health and root introspection routes live at `/`, `/health`, and `/ready`.
- Legacy `/rag/query` and `/rag/retrieve` endpoints intentionally return `404`.

## Request Headers

| Header | Required | Default if omitted | Purpose |
| --- | --- | --- | --- |
| `x-tenant-id` | No | `default` | Tenant scoping |
| `x-user-id` | No | `local-dev` | Per-user tracking and rate limiting |
| `x-request-id` | No | Generated UUID | Traceability in logs and error responses |

## System Endpoints

### `GET /`

Use this only for service introspection or local debugging.

Example response:

```json
{
  "name": "Vanilla RAG Backend",
  "status": "ok",
  "message": "Use the versioned multi-collection API under /v1/rag/collections.",
  "endpoints": {
    "health": "/health",
    "ready": "/ready",
    "adminCollections": "/v1/admin/collections",
    "collections": "/v1/rag/collections",
    "query": "/v1/rag/collections/:collectionId/query",
    "retrieve": "/v1/rag/collections/:collectionId/retrieve",
    "testFrontend": "/test-frontend/"
  }
}
```

### `GET /health`

Liveness probe. It does not validate downstream dependencies.

Example response:

```json
{
  "status": "ok",
  "alive": true,
  "port": 3000,
  "uptimeSec": 123.45,
  "timestamp": "2026-06-27T20:00:00.000Z"
}
```

### `GET /ready`

Readiness probe and high-level dependency summary.

Query params:

- `details=true`
  Return the full readiness payload with checks, blockers, warnings, dependency detail, and aggregate operations diagnostics.
- `strict=true`
  Return `503` instead of `200` when the system is not fully ready.

Default summary response shape:

```json
{
  "status": "ok",
  "ready": true,
  "systemReadyFor": "query-and-index",
  "overallSummary": "System is ready to serve RAG queries and to run indexing from the configured data source.",
  "queryReady": true,
  "indexReady": true,
  "querySummary": "Ready to serve RAG queries.",
  "indexSummary": "Ready to run indexing from the configured data source.",
  "blockerCodes": [],
  "warningCodes": [],
  "recommendedActions": [],
  "blockers": [],
  "warnings": [],
  "dependencies": {
    "registry": { "ok": true },
    "chroma": { "ok": true },
    "ollama": { "ok": true }
  },
  "config": {
    "port": 3000,
    "chatModel": "gemma3:4b-cloud",
    "embeddingModel": "bge-m3",
    "chromaUrl": "http://127.0.0.1:8000"
  },
  "diagnostics": {
    "full": "GET /ready?details=true",
    "strictHttpStatus": "GET /ready?strict=true",
    "fullStrict": "GET /ready?details=true&strict=true"
  },
  "operations": {
    "observedAt": "2026-06-30T12:00:00.000Z",
    "collections": {
      "total": 7,
      "creating": 1,
      "indexing": 2,
      "ready": 2,
      "failed": 1,
      "archived": 1
    },
    "jobs": {
      "total": 5,
      "active": 2,
      "queued": 1,
      "running": 1,
      "terminal": 3,
      "succeeded": 1,
      "failed": 1,
      "cancelled": 1,
      "oldestActiveUpdatedAt": "2026-06-30T11:55:00.000Z",
      "oldestActiveAgeSec": 300,
      "newestFailureAt": "2026-06-30T11:59:30.000Z"
    },
    "physicalCollections": {
      "total": 6,
      "building": 1,
      "active": 1,
      "failedBuild": 1,
      "deletePending": 1,
      "cleanupFailed": 1,
      "deleted": 1,
      "cleanupBacklog": 2,
      "oldestDueDeleteAt": "2026-06-30T11:00:00.000Z"
    },
    "runtime": {
      "rateLimit": {
        "enabled": true,
        "windowMs": 60000,
        "maxRequestsPerWindow": 60
      },
      "concurrency": {
        "maxConcurrentEmbeddings": 5,
        "maxConcurrentGenerations": 2
      },
      "timeouts": {
        "readinessMs": 5000,
        "ragMs": 30000
      }
    }
  },
  "operationalAlerts": [
    {
      "code": "FAILED_JOBS_PRESENT",
      "severity": "warn",
      "message": "1 jobs have failed. Latest failure was observed at 2026-06-30T11:59:30.000Z."
    }
  }
}
```

Use `/ready` for deployment, operations, and environment diagnostics. `blockers` and `warnings` describe capability readiness, while `operationalAlerts` and `operations` provide aggregate queue, cleanup, and runtime context. For collection-specific frontend state, use `GET /v1/rag/collections/:collectionId/ready`.

## Public Collection DTO

Public collection list and detail responses use a sanitized DTO:

```json
{
  "id": "col_123",
  "displayName": "Tax Rulings 2026",
  "description": "Indexed rulings for user-facing search",
  "status": "ready",
  "chunkCount": 1200,
  "activeVersion": "v-2026-06-27",
  "updatedAt": "2026-06-27T20:00:00.000Z",
  "indexState": {
    "status": "synced",
    "reindexRequired": false,
    "activeSnapshot": {
      "sourcePath": "data",
      "ozelgeDataPath": "data/ozelge_veri.json",
      "distanceMetric": "cosine",
      "chunkSize": 1000,
      "chunkOverlap": 200,
      "embeddingModel": "bge-m3"
    },
    "desiredSnapshot": {
      "sourcePath": "data",
      "ozelgeDataPath": "data/ozelge_veri.json",
      "distanceMetric": "cosine",
      "chunkSize": 1000,
      "chunkOverlap": 200,
      "embeddingModel": "bge-m3"
    },
    "changedFields": [],
    "note": "Saved settings are aligned with the active indexed snapshot."
  },
  "readyUrl": "/v1/rag/collections/col_123/ready",
  "queryUrl": "/v1/rag/collections/col_123/query",
  "retrieveUrl": "/v1/rag/collections/col_123/retrieve"
}
```

Notes:

- Public DTOs do not expose top-level `tenantId`, `sourcePath`, `embeddingModel`, `chatModel`, `activePhysicalCollection`, or `activeEmbeddingModel`.
- `description`, `chunkCount`, `activeVersion`, and `indexState` may be `null`.
- `status` can be `creating`, `indexing`, `ready`, `failed`, or `archived`.
- If a collection has a real active indexed snapshot, `indexState.activeSnapshot` is typically present and should not be assumed to be `null`.

## Public Endpoints

### `GET /v1/rag/collections`

Returns all collections visible to the current tenant.

Example response:

```json
{
  "collections": [
    {
      "id": "col_123",
      "displayName": "Tax Rulings 2026",
      "description": "Indexed rulings for user-facing search",
      "status": "ready",
      "chunkCount": 1200,
      "activeVersion": "v-2026-06-27",
      "updatedAt": "2026-06-27T20:00:00.000Z",
      "indexState": {
        "status": "synced",
        "reindexRequired": false,
        "activeSnapshot": {
          "sourcePath": "data",
          "ozelgeDataPath": "data/ozelge_veri.json",
          "distanceMetric": "cosine",
          "chunkSize": 1000,
          "chunkOverlap": 200,
          "embeddingModel": "bge-m3"
        },
        "desiredSnapshot": {
          "sourcePath": "data",
          "ozelgeDataPath": "data/ozelge_veri.json",
          "distanceMetric": "cosine",
          "chunkSize": 1000,
          "chunkOverlap": 200,
          "embeddingModel": "bge-m3"
        },
        "changedFields": [],
        "note": "Saved settings are aligned with the active indexed snapshot."
      },
      "readyUrl": "/v1/rag/collections/col_123/ready",
      "queryUrl": "/v1/rag/collections/col_123/query",
      "retrieveUrl": "/v1/rag/collections/col_123/retrieve"
    }
  ]
}
```

### `GET /v1/rag/collections/:collectionId`

Returns the same public DTO for a single collection.

Use this when you already know the collection ID and want a point lookup.

### `GET /v1/rag/collections/:collectionId/ready`

This is the most important endpoint for frontend behavior. It tells the client whether the selected collection can currently:

- answer questions,
- retrieve source chunks,
- accept a reindex request.

Important:

- This endpoint can return `200 OK` even when `query` and `retrieve` are blocked.
- Use `capabilities`, `blockers`, and `warnings`, not the HTTP status, to decide which UI actions to enable.
- The public payload intentionally does not expose `activePhysicalCollection`.

Example: collection has no active physical collection yet, but a job is queued:

```json
{
  "id": "col_123",
  "status": "indexing",
  "hasActivePhysicalCollection": false,
  "activeVersion": null,
  "activeJob": {
    "id": "job_001",
    "status": "queued"
  },
  "chromaReadable": false,
  "chromaCount": -1,
  "modelAvailability": {
    "embeddingModel": "bge-m3",
    "embeddingModelAvailable": true,
    "chatModel": "gemma3:4b-cloud",
    "chatModelAvailable": true
  },
  "capabilities": {
    "query": false,
    "retrieve": false,
    "reindex": true
  },
  "blockers": [
    {
      "code": "COLLECTION_NO_ACTIVE_PHYSICAL_COLLECTION",
      "message": "No active physical collection exists. Run re-index first.",
      "recommendedAction": "Run re-index for this collection."
    }
  ],
  "warnings": [
    {
      "code": "COLLECTION_INDEX_JOB_ACTIVE",
      "message": "Index job job_001 is queued.",
      "recommendedAction": "Wait for the current indexing job to finish before changing settings or starting another re-index."
    }
  ],
  "recommendedActions": [
    "Run re-index for this collection.",
    "Wait for the current indexing job to finish before changing settings or starting another re-index."
  ]
}
```

Example: collection is rebuilding, but the previous active snapshot is still readable:

```json
{
  "id": "col_123",
  "status": "indexing",
  "hasActivePhysicalCollection": true,
  "activeVersion": "v-active-1",
  "activeJob": {
    "id": "job_001",
    "status": "queued"
  },
  "chromaReadable": true,
  "chromaCount": 42,
  "modelAvailability": {
    "embeddingModel": "embed-collection-specific",
    "embeddingModelAvailable": true,
    "chatModel": "chat-collection-specific",
    "chatModelAvailable": true
  },
  "capabilities": {
    "query": true,
    "retrieve": true,
    "reindex": true
  },
  "blockers": [],
  "warnings": [
    {
      "code": "COLLECTION_INDEX_JOB_ACTIVE",
      "message": "Index job job_001 is queued.",
      "recommendedAction": "Wait for the current indexing job to finish before changing settings or starting another re-index."
    }
  ],
  "recommendedActions": [
    "Wait for the current indexing job to finish before changing settings or starting another re-index."
  ]
}
```

Embedding model nuance:

- `modelAvailability.embeddingModel` is the model used by live reads right now.
- If `modelAvailability.desiredEmbeddingModel` appears, the admin configuration was changed and a reindex is still needed before live reads switch to that future embedding model.
- This matters after an admin updates `embeddingModel` but before reindex completes.

Frontend rule:

- use `capabilities.query` and `capabilities.retrieve`,
- render `blockers`, `warnings`, and `recommendedActions`,
- do not guess based only on `status`.

### `POST /v1/rag/collections/:collectionId/retrieve`

Use this when the frontend should show raw retrieved evidence without generating an answer.

Request body:

```json
{
  "question": "Which rulings mention withholding tax?",
  "k": 5
}
```

Response body:

```json
{
  "question": "Which rulings mention withholding tax?",
  "k": 5,
  "sourceCount": 2,
  "distanceScoreThreshold": 0.42,
  "sources": [
    {
      "documentId": "doc-17",
      "sourcePath": "data/rulings/2026-01.json",
      "sourceType": "json",
      "chunkIndex": 0,
      "ozelgeId": "OZG-17",
      "sayi": "E-123",
      "tarih": "2026-01-12",
      "konu": "Withholding tax",
      "distanceScore": 0.18,
      "content": "Retrieved chunk text..."
    }
  ],
  "embeddingModel": "bge-m3",
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `k` is optional and defaults to the collection's configured `retrievalK`.
- `sourceCount` equals `sources.length`.
- `retrieve.sources` is the threshold-filtered retrieval result set returned by the backend for evidence browsing.
- `retrieve.embeddingModel` is the effective embedding model used for the retrieval request.
- `debug.latency` appears only when server-side debug timings are enabled.

### `POST /v1/rag/collections/:collectionId/query`

Use this when the frontend should return a grounded answer plus the supporting sources.

Request body:

```json
{
  "question": "What is the withholding tax treatment in this case?"
}
```

Response body:

```json
{
  "answer": "The ruling states that withholding tax applies under the cited conditions.",
  "distanceScoreThreshold": 0.42,
  "sources": [
    {
      "documentId": "doc-17",
      "sourcePath": "data/rulings/2026-01.json",
      "sourceType": "json",
      "chunkIndex": 0,
      "ozelgeId": "OZG-17",
      "sayi": "E-123",
      "tarih": "2026-01-12",
      "konu": "Withholding tax",
      "distanceScore": 0.18,
      "content": "Retrieved chunk text..."
    }
  ],
  "embeddingModel": "bge-m3",
  "chatModel": "gemma3:4b-cloud",
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `query` internally performs retrieval first.
- `query.sources` may be a subset of the broader retrieval result set because the backend trims context to fit generation limits.
- `query.embeddingModel` is the effective embedding model used to retrieve the grounding context.
- `query.chatModel` is the effective chat model that generated the answer.
- The backend may return `422` even when the request is syntactically valid, because the model could not produce a grounded answer.
- `debug.latency` appears only when server-side debug timings are enabled.

## Public Error Codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` or `413` | Bad JSON, payload too large, or schema mismatch |
| `COLLECTION_FORBIDDEN` | `403` | Collection exists but is not visible to the current tenant |
| `COLLECTION_NOT_FOUND` | `404` | Collection does not exist |
| `COLLECTION_NOT_READY` | `404` | Collection exists but has no active indexed version and is not indexing |
| `COLLECTION_INDEXING` | `503` | Collection is still indexing and has no active indexed version yet |
| `NO_RELEVANT_CONTEXT` | `422` | Retrieval did not find acceptable chunks |
| `ANSWER_NOT_IN_RETRIEVED_CONTEXT` | `422` | Chunks were retrieved but cannot support a grounded answer |
| `EMPTY_MODEL_RESPONSE` | `502` | Model returned an empty answer |
| `DISALLOWED_FALLBACK_ANSWER` | `502` | Model returned a blocked fallback string |
| `MODEL_BACKPRESSURE` | `503` | Timeout, overload, or aborted backend work |
| `COLLECTION_STORAGE_INCONSISTENT` | `503` | Metadata and physical storage disagree |
| `RATE_LIMIT_EXCEEDED` | `429` | Operation-specific rate limit hit |
| `ROUTE_NOT_FOUND` | `404` | Wrong URL or legacy endpoint |
| `INTERNAL_ERROR` | `500` | Required backend dependency is missing or another internal failure occurred |

Example error envelope:

```json
{
  "error": "Request failed",
  "code": "COLLECTION_FORBIDDEN",
  "message": "Collection access forbidden",
  "requestId": "req_123",
  "details": {
    "collectionId": "col_123"
  }
}
```

## Rate Limiting And Body Limits

- Successful and rejected query, retrieve, and reindex responses emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- When rate-limited, the backend returns `429 RATE_LIMIT_EXCEEDED` and a `Retry-After` header.
- JSON bodies larger than `1mb` are rejected with `413` and `code: INVALID_REQUEST_BODY`.

## Structured Validation Errors

- Error responses may include `requestId`. Preserve and log it.
- Schema-validation failures commonly include `details.issues`, especially on `INVALID_REQUEST_BODY`.
- Query/retrieve failures may also include the effective `embeddingModel` and `chatModel` in `details` for troubleshooting.
