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
  Return the full readiness payload with checks, blockers, warnings, and dependency detail.
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
  }
}
```

Use `/ready` for deployment, operations, and environment diagnostics. For collection-specific frontend state, use `GET /v1/rag/collections/:collectionId/ready`.

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
    "activeSnapshot": null,
    "desiredSnapshot": {
      "sourcePath": "data",
      "ozelgeDataPath": "data/ozelge_veri.json",
      "distanceMetric": "cosine",
      "chunkSize": 1000,
      "chunkOverlap": 200,
      "embeddingModel": "bge-m3"
    },
    "changedFields": [],
    "note": "No indexed settings changed."
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
        "activeSnapshot": null,
        "desiredSnapshot": {
          "sourcePath": "data",
          "ozelgeDataPath": "data/ozelge_veri.json",
          "distanceMetric": "cosine",
          "chunkSize": 1000,
          "chunkOverlap": 200,
          "embeddingModel": "bge-m3"
        },
        "changedFields": [],
        "note": "No indexed settings changed."
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
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `k` is optional and defaults to the collection's configured `retrievalK`.
- `sourceCount` equals `sources.length`.
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
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `query` internally performs retrieval first.
- The backend may return `422` even when the request is syntactically valid, because the model could not produce a grounded answer.
- `debug.latency` appears only when server-side debug timings are enabled.

## Public Error Codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` | Bad JSON, payload too large, or schema mismatch |
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

- Query, retrieve, and reindex endpoints emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- When rate-limited, the backend returns `429 RATE_LIMIT_EXCEEDED` and a `Retry-After` header.
- JSON bodies larger than `1mb` are rejected with `413` and `code: INVALID_REQUEST_BODY`.
