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
| `operator` | Viewer access plus create, validate, update, reindex, job cancel, and document upload/delete (`manageDocuments`) |
| `admin` | Operator access plus collection delete, job delete, bulk delete, and embedding services (`manageEmbeddingServices`) |

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
    "embeddingProvider": "builtin",
    "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
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
- `modelDefaults.embeddingServerConfigured` tells whether the `server` embedding service (`RAG_EMBEDDING_BASE_URL` / `embedding.baseUrl`) is set; more services come from the embedding services endpoints.
- `modelDefaults` is the configured default embedding (`embedding.provider` / `embedding.model`). It applies to **new** collections only; every existing collection keeps its own stored provider and model, so changing this default never changes an existing collection.
- `chat` describes the global, optional chat LLM used only by `/query`. It is not a collection setting. `enabled: false` means the backend is retrieve-only (`/query` returns `503 CHAT_NOT_CONFIGURED`). When enabled, `baseUrl` and `model` show the OpenAI-compatible endpoint and model (for example `http://localhost:11434/v1` and `gemma3:4b`). The API key itself is never returned; `apiKeyConfigured` only tells whether one is set (`RAG_CHAT_API_KEY` or `.local/rag_chat_api_key.secret`). The chat LLM is configured with `npm run onboard` or `RAG_CHAT_BASE_URL` / `RAG_CHAT_MODEL`, not through the admin API. The bundled admin panel (`/admin`) shows it as a read-only "Chat LLM (global, optional)" line in the collection form, which has no chat model field.
- This endpoint is intended for create-form visibility only; it does not expose the full config file.
- Use this together with `GET /v1/admin/models` so the create form can show both backend defaults and runtime model suggestions.

### `GET /v1/admin/models`

Returns embedding model suggestions per embedding provider, for the collection `embeddingProvider` / `embeddingModel` fields. The chat LLM is not discovered here.

There are two embedding providers:

- `builtin` (default): an ONNX model that runs inside the backend process on CPU (transformers.js). Models come from a fixed built-in catalog (currently `onnx-community/embeddinggemma-2-ONNX`, q8, about 346 MB) and are downloaded once on first use into `embedding.cacheDir` (default `models/`). No external service is needed.
- `openai-compatible`: any OpenAI-compatible `/v1/embeddings` API (Ollama `http://localhost:11434/v1`, OpenAI, LM Studio, vLLM, ...), reached through an **embedding service**: one managed with the [embedding services endpoints](#embedding-services), or the read-only `server` service from `.env` / config (`embedding.baseUrl`; its API key comes from `RAG_EMBEDDING_API_KEY` or `.local/rag_embedding_api_key.secret`). Keys are never returned.

Example response:

```json
{
  "default": {
    "provider": "builtin",
    "model": "onnx-community/embeddinggemma-2-ONNX"
  },
  "providers": {
    "builtin": {
      "models": ["onnx-community/embeddinggemma-2-ONNX"],
      "cacheDir": "models"
    },
    "openai-compatible": {
      "configured": true,
      "baseUrl": "http://localhost:11434/v1",
      "reachable": true,
      "models": ["embeddinggemma-2:270m", "bge-m3"]
    }
  },
  "embeddingServices": [
    { "id": "server", "name": "Server (.env / config)", "reachable": true, "authOk": true, "models": ["embeddinggemma-2:270m", "bge-m3"] },
    { "id": "openai-4f2a9c1b7e", "name": "OpenAI", "reachable": true, "authOk": true, "models": ["text-embedding-3-small"] }
  ]
}
```

`embeddingServices` lists every embedding service the tenant can use with its models (`server` first, when configured); a collection picks one with `embeddingServiceId`. `providers["openai-compatible"]` describes only the `server` service and is kept for older clients.

If no `embedding.baseUrl` is configured, the `openai-compatible` entry is `{ "configured": false, "baseUrl": null, "reachable": false, "models": [] }`. If the service is configured but unreachable or rejects the API key, the endpoint still returns `200` with `reachable: false`, `models: []`, and an `error` string.

Notes:

- `default` is the configured default embedding for new collections (same as `GET /v1/admin/config/defaults` `modelDefaults`).
- The bundled admin panel (`/admin`) uses this for the Embedding Provider select and the model suggestions in the collection form; its collection health view shows the active embedding (`modelAvailability.embeddingProvider` / `embeddingModel`) from the collection readiness endpoint.
- `providers.builtin.models` is the full built-in catalog; any other built-in model name is rejected with `422 UNAVAILABLE_MODEL`.
- Each service's `models` come from a free, cached `GET {baseUrl}/models`. It lists every model the service offers (it cannot tell embedding models from chat models), so it can change without a code deploy.
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
- `sourcePath`: omit it to get an uploads collection (see below); give it to index a folder on the server
- `distanceMetric`: `l2`, `cosine`, or `ip`
- `chunkSize`
- `chunkOverlap`
- `retrievalK`
- `retrievalDistanceThreshold`
- `embeddingProvider`: `builtin` or `openai-compatible`
- `embeddingServiceId`: `openai-compatible` only; an embedding service id, or `server`
- `embeddingModel`

Behavior:

- Returns `201 Created` on success.
- Documents (`sourceKind`):
  - Without `sourcePath` the collection is an **uploads** collection (`sourceKind: "uploads"`): it gets its own folder, `data/collections/<collection id>`, and its documents are managed with the [files endpoints](#documents-of-a-collection). This is what the admin panel creates by default.
  - With `sourcePath` it is a **folder** collection (`sourceKind: "folder"`): it indexes that file or folder on the server (relative to the project root, for example `data/handbook`; with Docker, inside the `./data` mount). The files endpoints list its files read-only. Before this release, an omitted `sourcePath` meant the whole `collectionDefaults.sourcePath` folder; send `"sourcePath": "data"` for that behavior.
  - Folder collections never see the `data/collections` folder, so a folder collection on `data` does not pick up other collections' uploads.
  - The `sourcePath` of an uploads collection cannot be changed (`PATCH` returns `400 INVALID_REQUEST_BODY`; validation reports `COLLECTION_SOURCE_FIXED`).
- Embedding service (`openai-compatible` only): `embeddingServiceId` must be one of the tenant's services or `server` (`404 EMBEDDING_SERVICE_NOT_FOUND` otherwise; `400` with the `builtin` provider). Left out, the server picks `server` when it is configured, otherwise the tenant's only service; with several services and no `server`, it asks for `embeddingServiceId` (`400`). The response's `collection.embeddingServiceId` shows the choice. Changing it later (PATCH) is a re-index field, like the model.
- Embedding: omitted `embeddingProvider` / `embeddingModel` come from the configured default (`modelDefaults`). If you pick a provider other than the default without a model, `builtin` gets its default built-in model, while `openai-compatible` needs an explicit `embeddingModel` (otherwise `422 UNAVAILABLE_MODEL`). The stored provider and model belong to the collection; later changes of the configured default never affect it.
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
- `embeddingProvider`
- `embeddingModel`

If any reindex-bound field changes, the backend persists the configuration but expects a reindex before the indexed snapshot fully matches the desired settings.

This classification applies to `PATCH` (update). On **create**, only `displayName` and `description` are treated as immediate; every other field (including `retrievalK`, `retrievalDistanceThreshold`, and `distanceMetric`) is reported under `impact.reindexFields`, because a new collection must be indexed before any indexed setting takes effect.

## Live Read Model vs Desired Model

- A collection stores the desired `embeddingProvider` / `embeddingModel` and the `activeEmbeddingProvider` / `activeEmbeddingModel` its active index was built with.
- Updating `embeddingProvider` or `embeddingModel` does not immediately change the embedding used by public RAG reads.
- Until the next successful reindex completes, `query` and `retrieve` keep using the collection's snapshotted `activeEmbeddingProvider` / `activeEmbeddingModel`. Reads never fall back to the configured default embedding.
- This means an admin save can succeed while the public query path still runs on the previous embedding.
- The public readiness payload reflects this with `modelAvailability.embeddingProvider` / `embeddingModel` for the live read embedding and `modelAvailability.desiredEmbeddingProvider` / `desiredEmbeddingModel` for the future post-reindex embedding when they differ.

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

- Before saving, the backend runs a cheap embedding preflight on the resolved `embeddingProvider` / `embeddingModel`. It never downloads a model or runs an embedding. The optional chat LLM is not checked: collections can be created and indexed without it.
  - `builtin`: the model must be in the built-in catalog. A model that is not downloaded yet is fine; it is downloaded at the start of the first indexing.
  - `openai-compatible`: `embedding.baseUrl` must be configured, and a free `GET {embedding.baseUrl}/models` must succeed and (when the service lists models) include the model.
- On failure nothing is created:
  - `422 UNAVAILABLE_MODEL`: no model for `openai-compatible`, a built-in model outside the catalog (`details.availableModels` is the catalog), or a model the embedding service does not offer (`details.availableModels` from its `GET /models`).
  - `422 EMBEDDING_PROVIDER_NOT_CONFIGURED`: `openai-compatible` was chosen but `embedding.baseUrl` is not set.
  - `503 EMBEDDING_PROVIDER_UNREACHABLE`: the embedding service cannot be reached or rejects the API key (`details.embeddingBaseUrl`, optional `details.httpStatus`).

Example `422` response:

```json
{
  "error": "Request failed",
  "code": "UNAVAILABLE_MODEL",
  "message": "Collection cannot be created. Embedding model 'bge-m3' is not offered by the embedding service.",
  "requestId": "req_123",
  "details": {
    "embeddingProvider": "openai-compatible",
    "embeddingModel": "bge-m3",
    "availableModels": ["embeddinggemma-2:270m", "gemma3:4b"],
    "recommendedActions": ["Pick one of the available models, or pull it there (for Ollama: ollama pull bge-m3)."]
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
    "sourceKind": "folder",
    "sourcePath": "data/api-test-updated",
    "embeddingProvider": "openai-compatible",
    "embeddingModel": "embed-patched-http",
    "activeEmbeddingProvider": "builtin",
    "activeEmbeddingModel": "onnx-community/embeddinggemma-2-ONNX",
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
    "documentsChanged": false,
    "indexState": {
      "status": "reindex_required",
      "reindexRequired": true,
      "activeSnapshot": {
        "sourcePath": "data/api-test",
        "distanceMetric": "cosine",
        "chunkSize": 1000,
        "chunkOverlap": 200,
        "embeddingProvider": "builtin",
        "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
      },
      "desiredSnapshot": {
        "sourcePath": "data/api-test-updated",
        "distanceMetric": "ip",
        "chunkSize": 321,
        "chunkOverlap": 12,
        "embeddingProvider": "openai-compatible",
        "embeddingModel": "embed-patched-http"
      },
      "changedFields": [
        "sourcePath",
        "distanceMetric",
        "chunkSize",
        "chunkOverlap",
        "embeddingProvider",
        "embeddingModel"
      ],
      "documentsChanged": false,
      "note": "Saved indexing settings differ from the active indexed snapshot. Re-index required to apply them."
    }
  }
}
```

Notes:

- This DTO is richer than the public RAG collection DTO.
- `embeddingProvider` / `embeddingModel` are the saved (desired) embedding used by the next reindex; `activeEmbeddingProvider` / `activeEmbeddingModel` are what the active index was built with and what reads use. The active pair is absent until the first successful reindex.
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
- Recorded operations include `query`, `retrieve`, `reindex`, `delete` (collection), `document_upload`, `document_delete`, `job`, `job_events`, `job_delete` and `job_delete_batch`, plus index job events.
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
  "embeddingProvider": "builtin",
  "embeddingModel": "onnx-community/embeddinggemma-2-ONNX"
}
```

Example response:

```json
{
  "blockers": [
    {
      "code": "INDEXING_SOURCE_UNREADABLE",
      "message": "Indexing source cannot be read at missing/source/path. ...",
      "recommendedAction": "Use a folder the server can read, for example data/my-docs (with Docker: ./data/my-docs next to docker-compose.yml), and put supported files (.txt, .md, .pdf, .doc, .docx) in it. Or create the collection without a source path and upload the documents."
    },
    {
      "code": "COLLECTION_CHUNK_OVERLAP_INVALID",
      "message": "chunkOverlap (64) must be smaller than chunkSize (64).",
      "recommendedAction": "Reduce chunkOverlap so it stays smaller than chunkSize before saving or re-indexing."
    }
  ],
  "warnings": [
    {
      "code": "EMBEDDING_MODEL_NOT_DOWNLOADED",
      "message": "Built-in embedding model onnx-community/embeddinggemma-2-ONNX is not downloaded yet; it is downloaded on the first indexing (~346 MB).",
      "recommendedAction": "No action needed: the built-in embedding model is downloaded automatically on the first indexing (one time)."
    }
  ],
  "recommendedActions": [
    "Use a folder the server can read, for example data/my-docs (with Docker: ./data/my-docs next to docker-compose.yml), and put supported files (.txt, .md, .pdf, .doc, .docx) in it. Or create the collection without a source path and upload the documents.",
    "Reduce chunkOverlap so it stays smaller than chunkSize before saving or re-indexing.",
    "No action needed: the built-in embedding model is downloaded automatically on the first indexing (one time)."
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
      "embeddingProvider",
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
  "embeddingProvider": "openai-compatible",
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
- After patching `embeddingProvider` or `embeddingModel`, public RAG reads keep using the snapshotted active embedding (`activeEmbeddingProvider` / `activeEmbeddingModel`) until reindex succeeds.
- `PATCH` itself does not run the embedding preflight; use the validate endpoint to check a new embedding first (embedding readiness codes such as `EMBEDDING_MODEL_UNSUPPORTED`, `EMBEDDING_PROVIDER_NOT_CONFIGURED`, `EMBEDDING_PROVIDER_UNREACHABLE`, `EMBEDDING_MODEL_MISSING` appear as blockers, `EMBEDDING_MODEL_NOT_DOWNLOADED` / `EMBEDDING_MODEL_UNVERIFIED` as warnings). The reindex preflight checks it again before a job starts.

### `DELETE /v1/admin/collections/:collectionId`

Soft-deletes the collection and returns `204 No Content`.

Behavior:

- The collection disappears from subsequent public and admin lookups.
- Any running jobs associated with the collection are aborted.
- An uploads collection's folder (`data/collections/<collection id>`) and its documents are deleted. A folder collection's files are never touched.

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
- Before queueing, the backend runs the same cheap embedding preflight as create on the collection's saved `embeddingProvider` / `embeddingModel` (the job builds with that pair). It never downloads or embeds: a built-in model only has to be in the catalog (if it is not downloaded yet, the job downloads it once before embedding), and an `openai-compatible` model is checked with a free `GET {embedding.baseUrl}/models`. On failure no job starts: `422 UNAVAILABLE_MODEL`, `422 EMBEDDING_PROVIDER_NOT_CONFIGURED`, or `503 EMBEDDING_PROVIDER_UNREACHABLE`. The chat LLM is never involved in indexing, so a retrieve-only deployment can still index.
- When the job succeeds, the collection's `activeEmbeddingProvider` / `activeEmbeddingModel` become the job's `targetEmbeddingProvider` / `targetEmbeddingModel`.
- Reindex is one of the rate-limited operations.

## Embedding services

Connections to OpenAI-compatible embedding APIs, per tenant. A collection with the `openai-compatible` provider uses one (`embeddingServiceId`). Changes take effect immediately: clients and checks are cached per service and are rebuilt when its URL or key changes, so no restart is needed. The admin panel's **Embedding services** view uses exactly these endpoints.

- The `server` service is the one from `.env` / config (`RAG_EMBEDDING_BASE_URL`, `RAG_EMBEDDING_API_KEY`, `embedding.baseUrl`). It is listed read-only (`PATCH`/`DELETE` return `409 EMBEDDING_SERVICE_READ_ONLY`). Collections created before embedding services existed use it.
- API keys are stored in plain text in the registry (`data/registry.sqlite`) and never returned: responses only say `apiKeyConfigured`. They are redacted from error messages and job errors.
- Managing services needs the `manageEmbeddingServices` capability (admin role) when admin auth is on. While admin auth is off, anyone who can reach the server can manage them; responses then carry a `warnings` entry saying so.
- Whoever manages a service decides where document text is sent for embedding, and the server makes requests to the URL given (`http`/`https` only; redirects are not followed in checks). Do not expose the server without admin auth.

### `GET /v1/admin/embedding-services`

```json
{
  "services": [
    { "id": "server", "name": "Server (.env / config)", "baseUrl": "http://host.docker.internal:11434/v1", "apiKeyConfigured": false, "source": "server", "readOnly": true, "configured": true, "collectionCount": 2 },
    { "id": "openai-4f2a9c1b7e", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKeyConfigured": true, "source": "panel", "readOnly": false, "configured": true, "collectionCount": 1, "createdAt": "2026-11-19T10:00:00.000Z", "updatedAt": "2026-11-19T10:05:00.000Z" }
  ],
  "warnings": ["Admin auth is off: anyone who can reach this server can change where documents are sent for embedding. Turn on admin auth before other people can reach it."]
}
```

`collectionCount` counts the collections whose saved or active embedding uses the service. When `RAG_EMBEDDING_BASE_URL` is not set, the `server` entry has `configured: false` and `baseUrl: null`.

### `POST /v1/admin/embedding-services`

`{ "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-..." }` → `201 { "service": {...}, "warnings": [...] }`. `apiKey` is optional; `baseUrl` must be `http(s)` (a trailing `/` is removed); names are unique per tenant (`400` otherwise).

### `PATCH /v1/admin/embedding-services/:serviceId`

Any of `name`, `baseUrl`, `apiKey` (`null` removes the stored key; leaving it out keeps it). Collections that use the service pick up the change on their next request; no re-index is needed (the model is unchanged).

### `DELETE /v1/admin/embedding-services/:serviceId`

`204`, or `409 EMBEDDING_SERVICE_IN_USE` with `details.collections` (`[{ id, displayName }]`) while any collection still uses it; switch those collections to another service and re-index, or delete them, first.

### `POST /v1/admin/embedding-services/test`

`{ "serviceId": "openai-4f2a9c1b7e" }` (a saved service, or `server`) or `{ "baseUrl": "...", "apiKey": "..." }` (before saving). A free `GET {baseUrl}/models`; nothing is embedded and nothing is stored. Response: `{ "id", "name", "reachable", "authOk", "models": [...], "error"?, "ok" }`. Needs `manageEmbeddingServices` but no action token (like validate).

## Documents of a collection

Upload, list, replace and delete the documents of an **uploads** collection (created without `sourcePath`). The admin panel's Documents tab uses exactly these endpoints.

- After an upload (new or replaced document), the collection's `indexState` becomes `reindex_required` with `documentsChanged: true` until the next successful reindex (`POST /v1/admin/collections/:collectionId/reindex`). Until then, searches use the previous content.
- A delete takes effect in search right away: the document's chunks are removed from the active index, so no reindex is needed (and the last document of a collection can be removed too).

Rules for every upload and delete:

- Only uploads collections are writable; a folder collection returns `409 COLLECTION_FILES_READ_ONLY`.
- While a reindex job of the collection is queued or running, uploads and deletes return `409 COLLECTION_INDEX_ALREADY_RUNNING` (`details.jobId`, `details.status`).
- Supported types: `.txt`, `.md`, `.pdf`, `.doc`, `.docx`. File names are plain names (no paths), may not start with a dot, and may not contain `< > : " | ? *` or control characters. UTF-8 names (for example Turkish characters) are kept.
- Each file may be at most `uploads.maxFileSizeMb` (default 50 MB; larger files return `413 FILE_TOO_LARGE`), at most 20 files per request (`400 TOO_MANY_FILES`).
- With admin auth on, uploads and deletes need the `manageDocuments` capability (operator, admin) and an action token for the exact path, like other mutations.
- Files are written next to a temporary name and then renamed, so an interrupted upload never replaces an existing document.

### `GET /v1/admin/collections/:collectionId/files`

Lists the documents of any collection (read capability).

Example response:

```json
{
  "collectionId": "my-docs-1a2b3c4d5e",
  "sourceKind": "uploads",
  "writable": true,
  "files": [
    { "name": "handbook.pdf", "sizeBytes": 248331, "modifiedAt": "2026-11-18T10:12:03.000Z", "supported": true }
  ],
  "fileCount": 1,
  "totalBytes": 248331,
  "indexState": { "status": "reindex_required", "reindexRequired": true, "documentsChanged": true, "note": "Documents were uploaded since the last index. Re-index to search them." }
}
```

`indexState` is abbreviated here; it has the same shape as in `GET /v1/admin/collections/:collectionId`. For a folder collection, `name` is the path relative to the folder and `supported: false` marks files the indexer skips.

### `POST /v1/admin/collections/:collectionId/files`

Uploads one or more documents as `multipart/form-data`, each in a part named `files`. A file with the name of an existing document replaces it.

```bash
curl -F "files=@handbook.pdf" -F "files=@notes.md" \
  http://localhost:3010/v1/admin/collections/my-docs-1a2b3c4d5e/files
```

Example response (`201 Created`):

```json
{
  "collectionId": "my-docs-1a2b3c4d5e",
  "uploaded": [
    { "name": "handbook.pdf", "sizeBytes": 248331, "replaced": false },
    { "name": "notes.md", "sizeBytes": 1520, "replaced": true }
  ],
  "rejected": [
    { "name": "budget.xlsx", "code": "UNSUPPORTED_FILE", "reason": "Unsupported file type. Supported: .txt, .md, .pdf, .doc, .docx." }
  ],
  "indexState": { "status": "reindex_required", "reindexRequired": true, "documentsChanged": true }
}
```

Files that cannot be accepted are listed in `rejected` (`UNSUPPORTED_FILE` or `INVALID_FILE_NAME`) while the others are stored. If no file can be accepted, the response is `400 UNSUPPORTED_FILE` with the list in `details.rejected`. A request without files returns `400 INVALID_REQUEST_BODY`.

### `DELETE /v1/admin/collections/:collectionId/files/:fileName`

Deletes one document and returns `204 No Content`. URL-encode the name (for example `my%20notes.md`). An unknown name returns `404 DOCUMENT_NOT_FOUND`.

If the collection has an active index, the document's chunks are removed from it first, and the collection's `chunkCount` and `documentCount` are lowered accordingly; the document no longer appears in search results. If Chroma cannot be reached, the response is `503 COLLECTION_STORAGE_INCONSISTENT` and nothing is deleted, so the request can be retried.

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
        "targetEmbeddingProvider": "builtin",
        "targetEmbeddingModel": "onnx-community/embeddinggemma-2-ONNX",
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
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active (also returned by document uploads and deletes while it runs) |
| `COLLECTION_FILES_READ_ONLY` | `409` | Document upload or delete on a folder collection; manage its files on the server |
| `FILE_TOO_LARGE` | `413` | An uploaded file is larger than `uploads.maxFileSizeMb` |
| `TOO_MANY_FILES` | `400` | More than 20 files in one upload request |
| `UNSUPPORTED_FILE` | `400` | None of the uploaded files has a supported type and a valid name; see `details.rejected` |
| `DOCUMENT_NOT_FOUND` | `404` | The document to delete does not exist in the collection |
| `EMBEDDING_SERVICE_NOT_FOUND` | `404` | The embedding service does not exist for this tenant (also when a collection names an unknown `embeddingServiceId`) |
| `EMBEDDING_SERVICE_IN_USE` | `409` | The embedding service is still used by collections (`details.collections`) |
| `EMBEDDING_SERVICE_READ_ONLY` | `409` | The `server` service comes from `.env` / config and cannot be changed through the API |
| `COLLECTION_STORAGE_INCONSISTENT` | `503` | Document delete: the document's chunks could not be removed from the search index (Chroma unreachable); nothing was deleted, retry later |
| `INVALID_JOB_STATUS` | `400` | Job action was attempted in the wrong job state |
| `UNAVAILABLE_MODEL` | `422` | Create or reindex preflight: no embedding model for `openai-compatible`, a built-in model outside the catalog, or a model the embedding service does not offer; see `details.availableModels` and `details.recommendedActions` |
| `EMBEDDING_PROVIDER_NOT_CONFIGURED` | `422` | Create or reindex preflight: `openai-compatible` was chosen but `embedding.baseUrl` is not configured |
| `EMBEDDING_PROVIDER_UNREACHABLE` | `503` | Create or reindex preflight could not reach the embedding service or the API key was rejected; see `details.embeddingBaseUrl` |
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
