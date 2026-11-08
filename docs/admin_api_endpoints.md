# Admin API Reference

This file documents the collection-management, job-management, and audit-log endpoints under `/v1/admin`.

If the frontend only needs end-user question answering, this file is optional. For admin consoles, provisioning tools, and operational dashboards, it is required.

## Admin Authentication

Admin auth is opt-in. When `adminAuth.enabled=true`, the admin shell and every `/v1/admin/**` route use a cookie-backed session instead of trusting user-editable request headers.

Session flow:

1. `POST /v1/admin/auth/login` with `{ username, password }`.
2. The backend verifies the stored `passwordHash` with `node:crypto` scrypt checks.
3. The backend returns a session summary and sets an `HttpOnly` `SameSite=Lax` cookie.
4. The frontend calls `GET /v1/admin/auth/session` on boot to hydrate the dashboard.
5. Mutating admin requests fetch a short-lived token from `POST /v1/admin/auth/action-token` and send it as `x-admin-action-token`.
6. `POST /v1/admin/auth/logout` clears the cookie and invalidates the in-memory session.

Role matrix:

| Role | Allowed admin surface |
| --- | --- |
| `viewer` | Read-only `GET /v1/admin/**` plus auth session endpoints |
| `operator` | Viewer access plus create, validate, update, reindex, and job cancel |
| `admin` | Operator access plus collection delete, job delete, and bulk delete |

Operational notes:

- Session cookies are in-memory and die on server restart.
- When admin auth is enabled, `/v1/admin/**` ignores incoming `x-tenant-id` and `x-user-id`; tenant and user are derived from the active session.
- Mutating admin routes reject missing, expired, replayed, wrong-route, wrong-method, or wrong-tenant action tokens.
- Use `npm run admin:hash-password` to generate `passwordHash` values safely.
- Onboarding stores the session secret in `.local/rag_admin_session.secret` when admin auth is enabled, and the runtime falls back to that file when `RAG_ADMIN_SESSION_SECRET` is not present in the environment.

Admin auth config surface:

- `adminAuth.enabled`: turns cookie auth and RBAC on for `/admin` and `/v1/admin`.
- `adminAuth.cookieName`: session cookie name. The shipped default is `rag_admin_session`.
- `adminAuth.sessionTtlMs`: session lifetime in milliseconds.
- `adminAuth.actionTokenTtlMs`: single-use action-token lifetime in milliseconds.
- `adminAuth.sessionSecretEnvVar`: env var that can override the HMAC signing secret. The shipped default is `RAG_ADMIN_SESSION_SECRET`, and onboarding also supports a local secret file for portable setup.
- `adminAuth.users[]`: configured admin principals with `{ username, passwordHash, role, tenantId }`.

Password hash format:

- Passwords are never stored in plaintext.
- `passwordHash` must use the built-in scrypt format:
  `scrypt$<cost>$<blockSize>$<parallelization>$<keyLength>$<saltBase64url>$<derivedKeyBase64url>`
- Generate hashes with `npm run admin:hash-password`.

## Request Headers

| Header | Required | Default if omitted | Purpose |
| --- | --- | --- | --- |
| `x-tenant-id` | No | `default` | Tenant scoping |
| `x-user-id` | No | `local-dev` | Per-user tracking and rate limiting |
| `x-request-id` | No | Generated UUID | Traceability in logs and errors |
| `x-admin-action-token` | No, but required on protected mutating admin routes | n/a | Short-lived signed token bound to session, tenant, route, and method |

Notes:

- When admin auth is disabled, the legacy header/default behavior above is still used.
- When admin auth is enabled, `/v1/admin/**` derives tenant and user from the authenticated session and ignores incoming `x-tenant-id` and `x-user-id`.
- Validation endpoints stay exempt from action-token checks because they do not mutate persistent state.

## Collection Configuration Fields

### `GET /v1/admin/config/defaults`

Returns the runtime defaults that the admin create form should show when fields are left empty.

Example response:

```json
{
  "collectionDefaults": {
    "sourcePath": "data",
    "distanceMetric": "l2",
    "chunkSize": 500,
    "chunkOverlap": 200,
    "retrievalK": 5,
    "retrievalDistanceThreshold": 1.2
  },
  "modelDefaults": {
    "embeddingModel": "embeddinggemma-2:270m"
  },
  "chat": {
    "enabled": false,
    "baseUrl": null,
    "model": null,
    "apiKeyConfigured": false
  }
}
```

Notes:

- `collectionDefaults.sourcePath` is a resolved runtime path, so it may appear absolute.
- `chat` describes the global, optional chat LLM used only by `/query`. It is not a collection setting. `enabled: false` means the backend is retrieve-only (`/query` returns `503 CHAT_NOT_CONFIGURED`). When enabled, `baseUrl` and `model` show the OpenAI-compatible endpoint and model (for example `http://localhost:11434/v1` and `gemma3:4b`). The API key itself is never returned; `apiKeyConfigured` only tells whether one is set (`RAG_CHAT_API_KEY` or `.local/rag_chat_api_key.secret`). The chat LLM is configured with `npm run onboard` or `RAG_CHAT_BASE_URL` / `RAG_CHAT_MODEL`, not through the admin API. The bundled admin panel (`/admin`) shows it as a read-only "Chat LLM (global, optional)" line in the collection form, which has no chat model field.
- This endpoint is intended for create-form visibility only; it does not expose the full config file.
- Use this together with `GET /v1/admin/models` so the create form can show both backend defaults and runtime model suggestions.

### `GET /v1/admin/models`

Returns the current Ollama model inventory for the embedding model autocomplete and validation hints. Ollama is only used for embeddings; the chat LLM is not discovered here.

Example response:

```json
{
  "reachable": true,
  "models": [
    "gemma3:4b",
    "embeddinggemma-2:270m"
  ],
  "embeddingModels": [
    "embeddinggemma-2:270m"
  ],
  "defaults": {
    "embeddingModel": "embeddinggemma-2:270m"
  }
}
```

If Ollama discovery is unavailable, the endpoint still returns `200` with:

```json
{
  "reachable": false,
  "models": [],
  "embeddingModels": [],
  "defaults": {
    "embeddingModel": "embeddinggemma-2:270m"
  }
}
```

Notes:

- `models` is the full runtime-discovered Ollama inventory.
- `embeddingModels` is the subset of that inventory with the `embedding` capability, for the collection `embeddingModel` field.
- The inventory depends on the local Ollama runtime, so the visible list can change without a code deploy.
- Use this together with `GET /v1/admin/config/defaults` so the create form can show both autocomplete suggestions and backend defaults.

### `GET /v1/admin/auth/session`

Always returns `{ enabled, authenticated, session }`:

- Auth disabled: `200` with `{ "enabled": false, "authenticated": false, "session": null }`.
- Auth enabled with a valid cookie: `200` with `{ "enabled": true, "authenticated": true, "session": { "username", "role", "tenantId", "expiresAt" } }`.
- Auth enabled with no/invalid cookie: `401 UNAUTHORIZED`.

### `POST /v1/admin/auth/login`

Authenticates a configured admin user and sets the session cookie.

Request body:

```json
{
  "username": "admin",
  "password": "secret"
}
```

### `POST /v1/admin/auth/action-token`

Mints a short-lived signed token for a specific mutating admin route. The frontend should call this just in time before `POST`, `PATCH`, or `DELETE` admin mutations.

Request body:

```json
{
  "method": "POST",
  "path": "/v1/admin/collections/demo/reindex"
}
```

Response:

```json
{
  "actionToken": "...",
  "expiresAt": "2026-01-01T00:05:00.000Z"
}
```

Send the returned `actionToken` as the `x-admin-action-token` header on the matching mutation. Returns `403 FORBIDDEN` when the session's role lacks the capability for the requested route.

### `POST /v1/admin/auth/logout`

Clears the session cookie and invalidates the in-memory session.

### Create request

`POST /v1/admin/collections`

Required:

- `displayName`

Optional:

- `description`
- `sourcePath`
- `distanceMetric`: `l2`, `cosine`, or `ip`
- `chunkSize`
- `chunkOverlap`
- `retrievalK`
- `retrievalDistanceThreshold`
- `embeddingModel`

Behavior:

- Returns `201 Created` on success.
- Collections have no chat model. Sending `chatModel` (or any other unknown field) returns `400 INVALID_REQUEST_BODY`. The chat LLM used by `/query` is global and optional (see `GET /v1/admin/config/defaults`).
- Omitted create fields are filled from runtime configuration defaults and model defaults.
- A newly created collection starts as a logical record; it is not queryable until indexing produces an active version.
- Use `GET /v1/admin/config/defaults` to show backend defaults in the create form before save.
- Use `GET /v1/admin/models` to populate model autocomplete or datalist suggestions while still allowing free text.

### Update request

`PATCH /v1/admin/collections/:collectionId`

All fields above are optional on update.

Special cases:

- `description: null` clears the description.
- Some changes take effect immediately.
- Some changes are stored but only become active after reindex.

## Immediate vs Reindex-Bound Fields

Validation classifies changed fields into two groups:

Immediate fields:

- `displayName`
- `description`
- `retrievalK`
- `retrievalDistanceThreshold`

Reindex-bound fields:

- `sourcePath`
- `distanceMetric`
- `chunkSize`
- `chunkOverlap`
- `embeddingModel`

If any reindex-bound field changes, the backend persists the configuration but expects a reindex before the indexed snapshot fully matches the desired settings.

This classification applies to `PATCH` (update). On **create**, only `displayName` and `description` are treated as immediate; every other field (including `retrievalK`, `retrievalDistanceThreshold`, and `distanceMetric`) is reported under `impact.reindexFields`, because a new collection must be indexed before any indexed setting takes effect.

## Live Read Model vs Desired Model

- Updating `embeddingModel` does not immediately change the model used by public RAG reads.
- Until the next successful reindex completes, `query` and `retrieve` keep using the collection's snapshotted `activeEmbeddingModel`.
- This means an admin save can succeed while the public query path still runs on the previous embedding model.
- The public readiness payload reflects this with `modelAvailability.embeddingModel` for the live read model and `modelAvailability.desiredEmbeddingModel` for the future post-reindex model when they differ.

## Collection Endpoints

### `POST /v1/admin/collections`

Creates a new collection.

Example request:

```json
{
  "displayName": "API Test Collection",
  "description": "Test description",
  "sourcePath": "data/api-test",
  "distanceMetric": "cosine"
}
```

Example response:

```json
{
  "collection": {
    "id": "col_123",
    "displayName": "API Test Collection",
    "status": "creating"
  }
}
```

Notes:

- Before saving, the backend asks Ollama (`/api/tags`) whether the resolved `embeddingModel` is pulled. A `:latest` tag matches an untagged name. The optional chat LLM is not checked: collections can be created and indexed without it.
- If the embedding model is missing it returns `422 UNAVAILABLE_MODEL` and creates nothing (`details.missingModels` entries only have role `embedding`). If Ollama cannot be reached it returns `503 OLLAMA_UNREACHABLE`.

Example `422` response:

```json
{
  "error": "Request failed",
  "code": "UNAVAILABLE_MODEL",
  "message": "Collection cannot be created. Embedding model 'embeddinggemma-2:270m' is not available in Ollama. Run: ollama pull embeddinggemma-2:270m",
  "requestId": "req_123",
  "details": {
    "missingModels": [{ "role": "embedding", "name": "embeddinggemma-2:270m" }],
    "availableModels": ["gemma3:4b"],
    "recommendedActions": ["ollama pull embeddinggemma-2:270m"]
  }
}
```

### `GET /v1/admin/collections/:collectionId`

Returns the full editable collection DTO.

Example response:

```json
{
  "collection": {
    "id": "col_123",
    "tenantId": "default",
    "displayName": "API Patched Collection",
    "status": "ready",
    "activePhysicalCollection": "api-test-active-physical",
    "activeVersion": "v-active-1",
    "sourcePath": "data/api-test-updated",
    "embeddingModel": "embed-patched-http",
    "distanceMetric": "ip",
    "chromaCollectionConfiguration": {
      "hnsw": {
        "space": "ip"
      }
    },
    "chunkSize": 321,
    "chunkOverlap": 12,
    "retrievalK": 11,
    "retrievalDistanceThreshold": 0.33,
    "createdBy": "local-dev",
    "createdAt": "2026-06-27T20:00:00.000Z",
    "updatedAt": "2026-06-27T20:10:00.000Z",
    "indexState": {
      "status": "reindex_required",
      "reindexRequired": true,
      "activeSnapshot": {
        "sourcePath": "data/api-test",
        "distanceMetric": "cosine",
        "chunkSize": 1000,
        "chunkOverlap": 200,
        "embeddingModel": "embeddinggemma-2:270m"
      },
      "desiredSnapshot": {
        "sourcePath": "data/api-test-updated",
        "distanceMetric": "ip",
        "chunkSize": 321,
        "chunkOverlap": 12,
        "embeddingModel": "embed-patched-http"
      },
      "changedFields": [
        "sourcePath",
        "distanceMetric",
        "chunkSize",
        "chunkOverlap",
        "embeddingModel"
      ],
      "note": "Saved indexing settings differ from the active indexed snapshot. Re-index required to apply them."
    }
  }
}
```

Notes:

- This DTO is richer than the public RAG collection DTO.
- Collection detail is tenant-scoped; another tenant receives `403 COLLECTION_FORBIDDEN`.

### `GET /v1/admin/collections/:collectionId/physical-collections`

Returns the physical collection lifecycle records behind one logical collection.

Example response:

```json
{
  "collectionId": "col_123",
  "physicalCollections": [
    {
      "name": "rag_default_col-123_20260701t112000_000z",
      "tenantId": "default",
      "collectionId": "col_123",
      "version": "20260701t112000_000z",
      "status": "failed_build",
      "chromaConfiguration": {
        "hnsw": {
          "space": "cosine"
        }
      },
      "createdAt": "2026-07-01T11:20:00.000Z",
      "cleanupError": "Injected failed build"
    },
    {
      "name": "rag_default_col-123_20260701t111000_000z",
      "tenantId": "default",
      "collectionId": "col_123",
      "version": "20260701t111000_000z",
      "status": "active",
      "chromaConfiguration": {
        "hnsw": {
          "space": "cosine"
        }
      },
      "documentCount": 12,
      "chunkCount": 48,
      "createdAt": "2026-07-01T11:10:00.000Z",
      "activatedAt": "2026-07-01T11:12:00.000Z"
    },
    {
      "name": "rag_default_col-123_20260701t110000_000z",
      "tenantId": "default",
      "collectionId": "col_123",
      "version": "20260701t110000_000z",
      "status": "delete_pending",
      "chromaConfiguration": {
        "hnsw": {
          "space": "cosine"
        }
      },
      "createdAt": "2026-07-01T11:00:00.000Z",
      "activatedAt": "2026-07-01T11:03:00.000Z",
      "retiredAt": "2026-07-01T11:12:00.000Z",
      "deleteAfter": "2026-07-01T11:12:00.000Z"
    }
  ]
}
```

Notes:

- Records are returned newest-first by creation time.
- This endpoint is intended for operator visibility into zero-downtime rebuilds and retention cleanup, not for public clients.
- The response can include `building`, `active`, `retired`, `failed_build`, `delete_pending`, `cleanup_failed`, and `deleted` records.
- `retired` is a previously active physical collection that has been superseded by a newer active version and is awaiting the retention window before it moves to `delete_pending`.
- `delete_pending` and `cleanup_failed` indicate retention/cleanup work that is still pending or needs retry.
- `failed_build` indicates a target physical collection that never became active.
- Response includes `Cache-Control: no-store`.

### `GET /v1/admin/audit-log`

Returns the persisted operational audit log in newest-first order.

Supported query params:

- `collectionId`
- `operation`
- `limit`
- `cursor`

`collectionId` ve `operation` tekrar eden query param olarak gönderilebilir; backend bunları çoklu seçim filtreleri olarak işler.

Example response:

```json
{
  "auditLog": [
    {
      "timestamp": "2026-07-01T11:20:00.000Z",
      "collectionId": "col_123",
      "operation": "query",
      "status": "succeeded",
      "requestId": "audit-query-ok",
      "userId": "local-dev",
      "physicalCollection": "rag_default_col-123_20260701t112000_000z",
      "message": "Query completed.",
      "details": {
        "method": "POST",
        "path": "/v1/rag/collections/col_123/query",
        "statusCode": 200
      }
    }
  ],
  "nextCursor": "opaque-cursor"
}
```

Notes:

- `collectionId` and `operation` are optional filters; both can be supplied multiple times for an OR filter over exact matches.
- When `collectionId` is provided, the route applies the same tenant visibility checks as other collection-scoped admin endpoints, one collection at a time.
- Another tenant's collection returns `403 COLLECTION_FORBIDDEN`; an unknown collection returns `404 COLLECTION_NOT_FOUND`.
- `limit` is capped by the backend, and `nextCursor` is opaque.
- The endpoint is tenant-scoped and returns `Cache-Control: no-store`.
- `details` is safe JSON metadata for operator troubleshooting; render it with escaped text, not raw HTML.

### `POST /v1/admin/collections/validate`

Validates a create draft without mutating state.

Example request:

```json
{
  "displayName": "Validation Draft",
  "sourcePath": "missing/source/path",
  "chunkSize": 64,
  "chunkOverlap": 64,
  "embeddingModel": "embeddinggemma-2:270m"
}
```

Example response:

```json
{
  "blockers": [
    {
      "code": "INDEXING_SOURCE_UNREADABLE",
      "message": "Indexing source cannot be read at missing/source/path. ...",
      "recommendedAction": "Verify config/rag.config.yaml collectionDefaults.sourcePath points to a readable file or directory."
    },
    {
      "code": "COLLECTION_CHUNK_OVERLAP_INVALID",
      "message": "chunkOverlap (64) must be smaller than chunkSize (64).",
      "recommendedAction": "Reduce chunkOverlap so it stays smaller than chunkSize before saving or re-indexing."
    }
  ],
  "warnings": [],
  "recommendedActions": [
    "Verify config/rag.config.yaml collectionDefaults.sourcePath points to a readable file or directory.",
    "Reduce chunkOverlap so it stays smaller than chunkSize before saving or re-indexing."
  ],
  "impact": {
    "reindexRequired": true,
    "immediateFields": [
      "displayName"
    ],
    "reindexFields": [
      "sourcePath",
      "chunkSize",
      "chunkOverlap",
      "embeddingModel"
    ],
    "note": "New collections must be re-indexed before indexed settings become active."
  }
}
```

### `POST /v1/admin/collections/:collectionId/validate`

Validates an update draft by overlaying the patch on the persisted collection.

Key behaviors:

- Accepts an empty object.
- Respects tenant scope.
- Does not mutate collection or job state.
- Returns `impact.immediateFields` and `impact.reindexFields`.

### `PATCH /v1/admin/collections/:collectionId`

Persists a collection patch and returns the updated collection DTO.

Example request:

```json
{
  "displayName": "API Patched Collection",
  "description": null,
  "sourcePath": "data/api-test-updated",
  "embeddingModel": "embed-patched-http",
  "distanceMetric": "ip",
  "chunkSize": 321,
  "chunkOverlap": 12,
  "retrievalK": 11,
  "retrievalDistanceThreshold": 0.33
}
```

Notes:

- Unknown body keys are rejected with `400 INVALID_REQUEST_BODY`. This includes `chatModel`: collections no longer have a chat model (the optional chat LLM is global).
- Patching reindex-bound fields usually changes `collection.indexState` to `reindex_required`.
- After patching `embeddingModel`, public RAG reads keep using the snapshotted active embedding model until reindex succeeds.

### `DELETE /v1/admin/collections/:collectionId`

Soft-deletes the collection and returns `204 No Content`.

Behavior:

- The collection disappears from subsequent public and admin lookups.
- Any running jobs associated with the collection are aborted.

### `POST /v1/admin/collections/:collectionId/reindex`

Starts an asynchronous indexing job.

Example response:

```json
{
  "job": {
    "id": "job_001",
    "collectionId": "col_123",
    "status": "queued",
    "targetPhysicalCollection": "col_123_v2"
  }
}
```

Notes:

- Returns `202 Accepted`.
- If a reindex is already active, the backend returns `409 COLLECTION_INDEX_ALREADY_RUNNING` (`details.jobId`, `details.status`). This is checked before the model preflight.
- Before queueing, the backend checks that the collection's `embeddingModel` is pulled in Ollama. If it is missing it returns `422 UNAVAILABLE_MODEL` and starts no job. If Ollama cannot be reached it returns `503 OLLAMA_UNREACHABLE`. The chat LLM is never involved in indexing, so a retrieve-only deployment can still index.
- Reindex is one of the rate-limited operations.

## Job Endpoints

Job statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

### `GET /v1/admin/jobs`

Lists tenant-visible jobs.

Supported query params:

- `collectionId`
- `status`
- `limit`
- `cursor`

Notes:

- `status` may be repeated or comma-separated.
- Valid status filter values are `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- Response includes `Cache-Control: no-store`.
- `nextCursor` is opaque and may be `null`.
- `collection` can be `null` for a job row if the collection snapshot is no longer available.

Example response:

```json
{
  "jobs": [
    {
      "job": {
        "id": "job_001",
        "collectionId": "col_123",
        "tenantId": "default",
        "status": "running",
        "targetPhysicalCollection": "col_123_v2",
        "targetVersion": "v2",
        "targetEmbeddingModel": "embeddinggemma-2:270m",
        "targetChromaConfiguration": {
          "hnsw": {
            "space": "cosine"
          }
        },
        "createdAt": "2026-06-27T20:00:00.000Z",
        "updatedAt": "2026-06-27T20:02:00.000Z"
      },
      "collection": {
        "id": "col_123",
        "displayName": "Tax Rulings 2026",
        "status": "indexing"
      }
    }
  ],
  "nextCursor": "opaque-cursor"
}
```

### `GET /v1/admin/jobs/:jobId`

Returns one job.

Notes:

- Job lookup is tenant-scoped.
- A different tenant receives `404 ROUTE_NOT_FOUND`, not `403`.
- Response includes the `targetPhysicalCollection`, which is useful for operational troubleshooting.

### `GET /v1/admin/jobs/:jobId/events`

Returns the persisted event timeline for one job.

Example response:

```json
{
  "jobId": "job_001",
  "events": [
    {
      "id": "job_001:evt:1",
      "jobId": "job_001",
      "tenantId": "default",
      "collectionId": "col_123",
      "sequence": 1,
      "status": "queued",
      "stage": "queued",
      "code": "JOB_QUEUED",
      "level": "info",
      "message": "Job queued for execution.",
      "progress": {
        "phase": 1,
        "phaseCount": 6
      },
      "createdAt": "2026-06-30T10:00:00.000Z"
    },
    {
      "id": "job_001:evt:4",
      "jobId": "job_001",
      "tenantId": "default",
      "collectionId": "col_123",
      "sequence": 4,
      "status": "running",
      "stage": "loading_source",
      "code": "SOURCE_ANALYSIS_COMPLETED",
      "level": "info",
      "message": "Indexing source analysis completed.",
      "details": {
        "fileCount": 12,
        "parsedSourceDocumentCount": 87,
        "unsupportedFileCount": 1
      },
      "progress": {
        "phase": 3,
        "phaseCount": 6,
        "itemsCompleted": 87,
        "unit": "documents"
      },
      "createdAt": "2026-06-30T10:00:04.000Z"
    }
  ]
}
```

Notes:

- Events are returned in ascending `sequence` order.
- `status` remains one of `queued`, `running`, `succeeded`, `failed`, `cancelled`; use `stage` and `code` for the finer-grained timeline.
- `progress.phase` / `progress.phaseCount` describe stage progress, not a fake byte-level percentage.
- `details` contains stage-specific metrics such as parsed document count, chunk count, unsupported file count, and the target physical collection name.
- Response includes `Cache-Control: no-store`.

### `DELETE /v1/admin/jobs/:jobId`

Deletes a terminal job and returns `204 No Content`.

Rules:

- Allowed only for `succeeded`, `failed`, or `cancelled` jobs.
- For `queued` or `running`, the backend returns `400 INVALID_JOB_STATUS`.

### `POST /v1/admin/jobs/bulk-delete`

Deletes multiple terminal jobs.

Request body:

```json
{
  "jobIds": [
    "job_001",
    "job_002"
  ]
}
```

Rules:

- Every provided job must exist for the current tenant.
- Every provided job must already be terminal.
- If any job is queued or running, the whole request fails with `400 INVALID_JOB_STATUS`.
- Success returns `204 No Content`.

### `POST /v1/admin/jobs/:jobId/cancel`

Cancels a queued or running job and returns `204 No Content`.

Rules:

- Allowed only for `queued` or `running`.
- If the job is already terminal, the backend returns `400 INVALID_JOB_STATUS`.
- After cancellation, refetch collection detail and public readiness because collection status can change immediately.

## Admin Error Codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` or `413` | Invalid create, update, validate, cursor, or bulk-delete payload, or JSON body too large |
| `UNAUTHORIZED` | `401` | Admin auth is enabled and the request has no valid session |
| `FORBIDDEN` | `403` | The current admin role cannot perform this action, or the action token is missing/invalid for a protected mutation |
| `COLLECTION_FORBIDDEN` | `403` | Another tenant owns the collection |
| `COLLECTION_NOT_FOUND` | `404` | Collection does not exist |
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active |
| `INVALID_JOB_STATUS` | `400` | Job action was attempted in the wrong job state |
| `UNAVAILABLE_MODEL` | `422` | Create or reindex needs an Ollama embedding model that is not pulled; see `details.missingModels` and `details.recommendedActions` |
| `OLLAMA_UNREACHABLE` | `503` | Create or reindex could not reach Ollama to check its models |
| `ROUTE_NOT_FOUND` | `404` | Job lookup failed tenant scoping or the route is wrong |
| `RATE_LIMIT_EXCEEDED` | `429` | Reindex limit was hit |
| `INTERNAL_ERROR` | `500` | Required backend dependency is missing or another internal failure occurred |

## Structured Validation Errors

- Zod-backed payload validation failures usually include `details.issues`.
- Error responses may include `requestId`; log it and surface it in troubleshooting screens.

## Practical Frontend Rules

- Use validate endpoints before saving expensive changes.
- Use `impact.reindexRequired` to decide whether to offer an immediate reindex CTA.
- After a successful patch, trust the returned collection DTO rather than reconstructing state locally.
- Treat `nextCursor` as opaque.
- Never parse JSON from `204` responses.
