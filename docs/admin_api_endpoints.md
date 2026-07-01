# Admin API Reference

This file documents the collection-management and job-management endpoints under `/v1/admin`.

If the frontend only needs end-user question answering, this file is optional. For admin consoles, provisioning tools, and operational dashboards, it is required.

## Request Headers

| Header | Required | Default if omitted | Purpose |
| --- | --- | --- | --- |
| `x-tenant-id` | No | `default` | Tenant scoping |
| `x-user-id` | No | `local-dev` | Per-user tracking and rate limiting |
| `x-request-id` | No | Generated UUID | Traceability in logs and errors |

## Collection Configuration Fields

### `GET /v1/admin/config/defaults`

Returns the runtime defaults that the admin create form should show when fields are left empty.

Example response:

```json
{
  "collectionDefaults": {
    "sourcePath": "C:\\Codes\\Vanilla Rag Backend\\data",
    "ozelgeDataPath": "C:\\Codes\\Vanilla Rag Backend\\data\\ozelge_veri.json",
    "distanceMetric": "l2",
    "indexSampleSize": 0,
    "chunkSize": 500,
    "chunkOverlap": 200,
    "retrievalK": 5,
    "retrievalDistanceThreshold": 1.2
  },
  "modelDefaults": {
    "embeddingModel": "bge-m3",
    "chatModel": "gemma3:4b-cloud"
  }
}
```

Notes:

- `collectionDefaults.sourcePath` and `collectionDefaults.ozelgeDataPath` are resolved runtime paths, so they may appear absolute.
- This endpoint is intended for create-form visibility only; it does not expose the full config file.
- Use this together with `GET /v1/admin/models` so the create form can show both backend defaults and runtime model suggestions.

### `GET /v1/admin/models`

Returns the current Ollama model inventory for admin autocomplete and validation hints.

Example response:

```json
{
  "reachable": true,
  "models": [
    "gemma3:4b",
    "gemma3:4b-cloud",
    "gpt-oss:120b-cloud",
    "bge-m3:latest"
  ],
  "embeddingModels": [
    "bge-m3:latest"
  ],
  "chatModels": [
    "gemma3:4b",
    "gemma3:4b-cloud",
    "gpt-oss:120b-cloud"
  ],
  "defaults": {
    "embeddingModel": "bge-m3",
    "chatModel": "gemma3:4b-cloud"
  }
}
```

If Ollama discovery is unavailable, the endpoint still returns `200` with:

```json
{
  "reachable": false,
  "models": [],
  "embeddingModels": [],
  "chatModels": [],
  "defaults": {
    "embeddingModel": "bge-m3",
    "chatModel": "gemma3:4b-cloud"
  }
}
```

Notes:

- `models` is the full runtime-discovered Ollama inventory.
- `embeddingModels` and `chatModels` are role-specific subsets of that inventory for the two admin form fields.
- The inventory depends on the local Ollama runtime, so the visible list can change without a code deploy.
- Use this together with `GET /v1/admin/config/defaults` so the create form can show both autocomplete suggestions and backend defaults.

### Create request

`POST /v1/admin/collections`

Required:

- `displayName`

Optional:

- `description`
- `sourcePath`
- `ozelgeDataPath`
- `distanceMetric`: `l2`, `cosine`, or `ip`
- `chunkSize`
- `chunkOverlap`
- `retrievalK`
- `retrievalDistanceThreshold`
- `embeddingModel`
- `chatModel`

Behavior:

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
- `chatModel`

Reindex-bound fields:

- `sourcePath`
- `ozelgeDataPath`
- `distanceMetric`
- `chunkSize`
- `chunkOverlap`
- `embeddingModel`

If any reindex-bound field changes, the backend persists the configuration but expects a reindex before the indexed snapshot fully matches the desired settings.

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
  "ozelgeDataPath": "data/ozelge_veri.json",
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
    "ozelgeDataPath": "data/api-test-updated-ozelge.json",
    "embeddingModel": "embed-patched-http",
    "chatModel": "chat-patched-http",
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
        "ozelgeDataPath": "data/ozelge_veri.json",
        "distanceMetric": "cosine",
        "chunkSize": 1000,
        "chunkOverlap": 200,
        "embeddingModel": "bge-m3"
      },
      "desiredSnapshot": {
        "sourcePath": "data/api-test-updated",
        "ozelgeDataPath": "data/api-test-updated-ozelge.json",
        "distanceMetric": "ip",
        "chunkSize": 321,
        "chunkOverlap": 12,
        "embeddingModel": "embed-patched-http"
      },
      "changedFields": [
        "sourcePath",
        "ozelgeDataPath",
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

### `POST /v1/admin/collections/validate`

Validates a create draft without mutating state.

Example request:

```json
{
  "displayName": "Validation Draft",
  "sourcePath": "missing/source/path",
  "ozelgeDataPath": "missing/source/path/ozelge.json",
  "chunkSize": 64,
  "chunkOverlap": 64,
  "embeddingModel": "bge-m3",
  "chatModel": "gemma3:4b-cloud"
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
      "ozelgeDataPath",
      "chunkSize",
      "chunkOverlap",
      "embeddingModel",
      "chatModel"
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
  "ozelgeDataPath": "data/api-test-updated-ozelge.json",
  "embeddingModel": "embed-patched-http",
  "chatModel": "chat-patched-http",
  "distanceMetric": "ip",
  "chunkSize": 321,
  "chunkOverlap": 12,
  "retrievalK": 11,
  "retrievalDistanceThreshold": 0.33
}
```

Notes:

- Unknown body keys are rejected with `400 INVALID_REQUEST_BODY`.
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
- If a reindex is already active, the backend returns `409 COLLECTION_INDEX_ALREADY_RUNNING`.
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
        "targetEmbeddingModel": "bge-m3",
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
        "unsupportedFileCount": 1,
        "sampleLimited": false
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
| `COLLECTION_FORBIDDEN` | `403` | Another tenant owns the collection |
| `COLLECTION_NOT_FOUND` | `404` | Collection does not exist |
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active |
| `INVALID_JOB_STATUS` | `400` | Job action was attempted in the wrong job state |
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
