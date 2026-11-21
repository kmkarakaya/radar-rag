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
  "name": "RAGStation",
  "version": "0.1.0",
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

Liveness probe. It does not validate downstream dependencies. `version` is the running RAGStation version (also on `GET /`).

Example response:

```json
{
  "status": "ok",
  "alive": true,
  "version": "0.1.0",
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
  "retrieveReady": true,
  "queryEnabled": true,
  "queryReady": true,
  "indexReady": true,
  "retrieveSummary": "Ready to retrieve evidence.",
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
    "embedding": { "ok": true },
    "chat": { "ok": true, "configured": true }
  },
  "config": {
    "port": 3000,
    "chatModel": "gemma3:4b",
    "chatServiceId": "server",
    "chatSource": "server",
    "embeddingProvider": "builtin",
    "embeddingModel": "onnx-community/embeddinggemma-2-ONNX",
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
  ]
}
```

The example above has the optional chat LLM configured. The chat part of `/ready` is per tenant (the `x-tenant-id` header, `default` when it is missing), because each tenant can choose its chat LLM (`PUT /v1/admin/chat-settings`): `config.chatSource` is `tenant` (its choice), `server` (no choice: `.env` / config) or `none`, and `config.chatServiceId` / `config.chatModel` name the chat LLM that answers `/query`. If the tenant chose a chat service that no longer exists, `queryEnabled` is `true`, `queryReady` is `false` and the blocker is `CHAT_SERVICE_NOT_FOUND`.

Answer generation is optional: without a chat LLM (the shipped default) the backend is retrieve-only, and `/ready` reports it like this:

- `queryEnabled: false`, `queryReady: false`, `dependencies.chat: { "ok": false, "configured": false }`, `config.chatModel: null`, `config.chatServiceId: null`, `config.chatSource: "none"`.
- `querySummary` explains that `/query` is disabled because no chat LLM is configured.
- `systemReadyFor` is `retrieve-and-index` and `ready` is still `true`: `ready = retrieveReady && indexReady && (!queryEnabled || queryReady)`.
- The `CHAT_NOT_CONFIGURED` check in `GET /ready?details=true` has status `skip` and is non-blocking, so it appears in neither `blockerCodes` nor `warningCodes`.

`systemReadyFor` values: `query-and-index`, `retrieve-and-index`, `query`, `retrieve`, `index`, `neither`. The configured default embedding is only used to index new collections, so its failures (`EMBEDDING_PROVIDER_*`, `EMBEDDING_MODEL_MISSING`, `EMBEDDING_MODEL_UNSUPPORTED`) block `index` only; retrieval from existing collections stays available (each collection's own embedding is checked by `GET /v1/rag/collections/:collectionId/ready`). A retrieve-only deployment whose default embedding service is down reports `retrieve`. With a chat LLM configured but unreachable or misconfigured, `systemReadyFor` is `retrieve-and-index`, `queryReady` is `false`, and `ready` is `false`.

The chat LLM check is a free, cached (30 s per service) `GET {baseUrl}/models` request to the tenant's chat service, never a generation. Its readiness codes (capability `query` only) are `CHAT_NOT_CONFIGURED` (skip), `CHAT_PROVIDER_UNREACHABLE`, `CHAT_PROVIDER_AUTH_FAILED`, `CHAT_MODEL_MISSING` (blocking failures for `query` only), `CHAT_MODEL_UNVERIFIED` (warning: the provider has no `GET /models` listing), and `CHAT_MODEL_AVAILABLE` (pass). `GET /ready?details=true` returns `capabilities: { retrieve: { ready, message }, query: { enabled, ready, message }, index: { ready, message } }` and `dependencies.chat: { configured, baseUrl, model, reachable, authOk, modelListed, ok, latencyMs, httpStatus?, availableModels?, error? }` (`modelListed` is `true`, `false`, or `"unknown"`; the API key is never returned).

The embedding check covers the configured **default** embedding (`embedding.provider` / `embedding.model`, used for new collections); existing collections are checked individually by their collection `/ready`. It is cheap and never runs an embedding: for the `builtin` provider it checks the built-in model catalog and whether the model is already in `embedding.cacheDir`; for `openai-compatible` it is a free, cached `GET {embedding.baseUrl}/models`. Its readiness codes (capability `index` only: the default is used when indexing new collections, so a failure never blocks retrieval from existing collections) are `EMBEDDING_MODEL_READY` (pass), `EMBEDDING_MODEL_NOT_DOWNLOADED` (warning, non-blocking: the built-in model is downloaded once on the first indexing), `EMBEDDING_MODEL_UNVERIFIED` (warning: the service has no `GET /models` listing), and the blocking failures `EMBEDDING_MODEL_UNSUPPORTED` (built-in model not in the catalog), `EMBEDDING_PROVIDER_NOT_CONFIGURED`, `EMBEDDING_PROVIDER_UNREACHABLE`, `EMBEDDING_PROVIDER_AUTH_FAILED`, `EMBEDDING_MODEL_MISSING`. `GET /ready?details=true` returns `dependencies.embedding: { provider, model, configured, supported, ok, latencyMs, downloaded?, approxDownloadMb?, reachable?, authOk?, modelListed?, availableModels?, httpStatus?, error? }` (`downloaded` / `approxDownloadMb` for `builtin`, the rest for `openai-compatible`; the API key is never returned).

Use `/ready` for deployment, operations, and environment diagnostics. `blockers` and `warnings` describe capability readiness, while `operationalAlerts` and `operations` provide aggregate queue, cleanup, and runtime context. For collection-specific frontend state, use `GET /v1/rag/collections/:collectionId/ready`.

## Public Collection DTO

Public collection list and detail responses use a sanitized DTO:

```json
{
  "id": "col_123",
  "displayName": "Tax Rulings 2026",
  "description": "Indexed rulings for user-facing search",
  "status": "ready",
  "indexedFileCount": 40,
  "chunkCount": 1200,
  "activeVersion": "v-2026-06-27",
  "updatedAt": "2026-06-27T20:00:00.000Z",
  "indexState": {
    "status": "synced",
    "reindexRequired": false,
    "activeSnapshot": {
      "sourcePath": "data",
      "distanceMetric": "cosine",
      "chunkSize": 1000,
      "chunkOverlap": 200,
      "embeddingProvider": "builtin",
      "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
    },
    "desiredSnapshot": {
      "sourcePath": "data",
      "distanceMetric": "cosine",
      "chunkSize": 1000,
      "chunkOverlap": 200,
      "embeddingProvider": "builtin",
      "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
    },
    "changedFields": [],
    "note": "The index matches the saved settings."
  },
  "readyUrl": "/v1/rag/collections/col_123/ready",
  "queryUrl": "/v1/rag/collections/col_123/query",
  "retrieveUrl": "/v1/rag/collections/col_123/retrieve"
}
```

Notes:

- Public DTOs do not expose top-level `tenantId`, `sourcePath`, `embeddingProvider`, `embeddingModel`, `activePhysicalCollection`, `activeEmbeddingProvider`, or `activeEmbeddingModel`.
- `indexState` snapshots include `embeddingProvider` and `embeddingModel`: changing either one in the admin configuration makes `indexState.status` `reindex_required` until a reindex completes.
- Collections have no chat model of their own: the optional chat LLM used by `/query` is chosen per tenant (see `GET /ready` and the admin chat settings).
- `description`, `indexedFileCount`, `chunkCount`, `activeVersion`, and `indexState` may be `null`.
- `indexedFileCount` is the number of files whose content is searchable (unsupported or unreadable files are not counted); it is `null` before the first index and for indexes built before the field existed, until the next reindex.
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
      "indexedFileCount": 40,
      "chunkCount": 1200,
      "activeVersion": "v-2026-06-27",
      "updatedAt": "2026-06-27T20:00:00.000Z",
      "indexState": {
        "status": "synced",
        "reindexRequired": false,
        "activeSnapshot": {
          "sourcePath": "data",
          "distanceMetric": "cosine",
          "chunkSize": 1000,
          "chunkOverlap": 200,
          "embeddingProvider": "builtin",
          "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
        },
        "desiredSnapshot": {
          "sourcePath": "data",
          "distanceMetric": "cosine",
          "chunkSize": 1000,
          "chunkOverlap": 200,
          "embeddingProvider": "builtin",
          "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
        },
        "changedFields": [],
        "note": "The index matches the saved settings."
      },
      "readyUrl": "/v1/rag/collections/col_123/ready",
      "queryUrl": "/v1/rag/collections/col_123/query",
      "retrieveUrl": "/v1/rag/collections/col_123/retrieve"
    }
  ]
}
```

### `GET /v1/rag/collections/:collectionId`

Returns the same public DTO for a single collection, wrapped in a `collection` field:

```json
{
  "collection": {
    "id": "col_123",
    "displayName": "..."
  }
}
```

Read the DTO from `body.collection`, not the top level. (The list endpoint uses `body.collections[]`.)

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
    "embeddingProvider": "builtin",
    "embeddingModel": "onnx-community/embeddinggemma-2-ONNX",
    "embeddingModelAvailable": true,
    "chatModel": "gemma3:4b",
    "chatServiceId": "server",
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
    "embeddingProvider": "openai-compatible",
    "embeddingModel": "embed-collection-specific",
    "embeddingModelAvailable": true,
    "chatModel": "gemma3:4b",
    "chatServiceId": "server",
    "chatModelAvailable": true,
    "desiredEmbeddingProvider": "builtin",
    "desiredEmbeddingModel": "onnx-community/embeddinggemma-2-ONNX"
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

- `modelAvailability.embeddingProvider` / `modelAvailability.embeddingModel` are the embedding the active index was built with, which is what live reads use right now. The configured default embedding (`embedding.*` in the server config) only applies to new collections and never changes an existing collection.
- If `modelAvailability.desiredEmbeddingProvider` / `desiredEmbeddingModel` appear, the admin configuration was changed and a reindex is still needed before live reads switch to that future embedding. Both fields appear together whenever the saved provider or model differs from the active pair.
- This matters after an admin updates `embeddingProvider` or `embeddingModel` but before reindex completes.
- `embeddingModelAvailable` comes from a cheap check of the active pair that never runs an embedding: the built-in catalog for `builtin` (a not-yet-downloaded built-in model still counts as available; it downloads on first use), or the service's `GET /models` for `openai-compatible`.

Chat model nuance:

- `modelAvailability.chatModel` / `chatServiceId` are the tenant's chat LLM (its choice, else the server's from `.env` / config), or `null` when there is none (retrieve-only). `chatModelAvailable` comes from the chat service check (`GET {baseUrl}/models`).
- `capabilities.query` is `true` only when `capabilities.retrieve` is `true`, a chat LLM is configured, and the provider check is ok. `capabilities.retrieve` never depends on the chat LLM.

Possible readiness codes (inside the `200 OK` payload — these are distinct from the HTTP error codes below):

- Blockers: `COLLECTION_NO_ACTIVE_PHYSICAL_COLLECTION`, `COLLECTION_ACTIVE_PHYSICAL_UNREADABLE`, `EMBEDDING_MODEL_UNSUPPORTED`, `EMBEDDING_PROVIDER_NOT_CONFIGURED`, `EMBEDDING_PROVIDER_UNREACHABLE`, `EMBEDDING_PROVIDER_AUTH_FAILED`, `EMBEDDING_MODEL_MISSING`, `CHAT_PROVIDER_UNREACHABLE`, `CHAT_PROVIDER_AUTH_FAILED`, `CHAT_MODEL_MISSING`, `CHAT_SERVICE_NOT_FOUND` (the chosen chat service is gone; the `CHAT_*` blockers only block `query`; `retrieve` stays available).
- Warnings: `COLLECTION_INDEX_JOB_ACTIVE`, `EMBEDDING_MODEL_NOT_DOWNLOADED` (the built-in model downloads on first use), `EMBEDDING_MODEL_UNVERIFIED` (the embedding service does not list its models), `CHAT_NOT_CONFIGURED` (retrieve-only; `/query` is disabled), `CHAT_MODEL_UNVERIFIED` (the provider does not list its models).

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
      "sourcePath": "data/dataset1/Canakkale.txt",
      "sourceType": "text",
      "chunkIndex": 0,
      "distanceScore": 0.18,
      "content": "Retrieved chunk text..."
    }
  ],
  "embeddingProvider": "builtin",
  "embeddingModel": "onnx-community/embeddinggemma-2-ONNX",
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `k` is optional and defaults to the collection's configured `retrievalK`.
- `sourceCount` equals `sources.length`.
- `retrieve.sources` is the threshold-filtered retrieval result set returned by the backend for evidence browsing.
- `retrieve.embeddingProvider` / `retrieve.embeddingModel` are the effective embedding used for the retrieval request: always the pair the collection's active index was built with, never the configured default.
- `debug.latency` appears only when server-side debug timings are enabled.

### `POST /v1/rag/collections/:collectionId/query`

Use this when the frontend should return a grounded answer plus the supporting sources.

Answer generation is optional. It needs a chat LLM (any OpenAI-compatible chat completions API: Ollama `/v1`, LM Studio, vLLM, OpenAI, OpenRouter, ...): the tenant's choice (`PUT /v1/admin/chat-settings`, see the [admin API](./admin_api_endpoints.md#chat-services-and-the-chat-choice)), else the server's from `.env` / config. When there is none (the shipped default), this endpoint returns `503 CHAT_NOT_CONFIGURED` before the body is validated and before the collection is looked up; use `/retrieve` instead. Check `GET /ready` (`queryEnabled`) or `capabilities.query` in collection readiness before enabling a Query action.

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
      "sourcePath": "data/dataset1/Canakkale.txt",
      "sourceType": "text",
      "chunkIndex": 0,
      "distanceScore": 0.18,
      "content": "Retrieved chunk text..."
    }
  ],
  "embeddingProvider": "builtin",
  "embeddingModel": "onnx-community/embeddinggemma-2-ONNX",
  "chatModel": "gemma3:4b",
  "chatServiceId": "server",
  "collectionId": "col_123",
  "collectionDisplayName": "Tax Rulings 2026",
  "activeVersion": "v-2026-06-27"
}
```

Notes:

- `query` internally performs retrieval first.
- `query.sources` may be a subset of the broader retrieval result set because the backend trims context to fit generation limits.
- `query.embeddingProvider` / `query.embeddingModel` are the effective embedding (the collection's active pair) used to retrieve the grounding context.
- `query.chatModel` / `query.chatServiceId` are the chat LLM that generated the answer (`server` = the one from `.env` / config).
- The answer is written in the language of the question and grounded only in the retrieved context.
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
| `MODEL_BACKPRESSURE` | `503` | Timeout, overload (including a generation/embedding queue timeout), aborted work, or a network/connection error reaching Chroma |
| `EMBEDDING_PROVIDER_NOT_CONFIGURED` | `503` | The collection was indexed with the `openai-compatible` embedding provider, but no `embedding.baseUrl` is configured on this server |
| `EMBEDDING_PROVIDER_UNREACHABLE` | `503` | The embedding service could not be reached, or the built-in embedding model could not be downloaded or loaded |
| `EMBEDDING_PROVIDER_ERROR` | `502` | The embedding service returned an HTTP error (for example 401 bad API key, 404 unknown model, 429, 5xx). `details` includes `upstreamStatus`, `providerMessage` (API key redacted), `embeddingProvider`, `embeddingModel` |
| `EMBEDDING_DIMENSION_MISMATCH` | `409` | The query embedding has a different vector size than the collection's index. `details` includes `expectedDimensions` and `gotDimensions`; reindex the collection |
| `CHAT_NOT_CONFIGURED` | `503` | `/query` only: the tenant has no chat LLM (retrieve-only), or the chat service it chose no longer exists (the message says which). No `Retry-After` header: this is a configuration state, not a transient error |
| `CHAT_PROVIDER_UNREACHABLE` | `503` | `/query` only: the chat LLM API could not be reached |
| `CHAT_PROVIDER_ERROR` | `502` | `/query` only: the chat LLM API returned an HTTP error (for example 401 bad API key, 404 unknown model, 429, 5xx). `details` includes `upstreamStatus`, `providerMessage` (API key redacted), `chatModel`, `embeddingModel` |
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
- Query/retrieve failures may also include the effective `embeddingProvider` / `embeddingModel` and (for query) the `chatModel` / `chatServiceId` in `details` for troubleshooting. The chat and embedding API keys are never included.
