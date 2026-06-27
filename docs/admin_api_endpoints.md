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

- Omitted create fields are filled from runtime configuration defaults.
- A newly created collection starts as a logical record; it is not queryable until indexing produces an active version.

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
      "activeSnapshot": null,
      "desiredSnapshot": {
        "sourcePath": "data/api-test-updated",
        "ozelgeDataPath": "data/api-test-updated-ozelge.json",
        "distanceMetric": "ip",
        "chunkSize": 321,
        "chunkOverlap": 12,
        "embeddingModel": "embed-patched-http"
      },
      "changedFields": [
        "chunkOverlap"
      ],
      "note": "These settings are saved, but they only take effect after re-index completes."
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

## Admin Error Codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST_BODY` | `400` | Invalid create, update, validate, cursor, or bulk-delete payload |
| `COLLECTION_FORBIDDEN` | `403` | Another tenant owns the collection |
| `COLLECTION_NOT_FOUND` | `404` | Collection does not exist |
| `COLLECTION_INDEX_ALREADY_RUNNING` | `409` | A reindex job is already active |
| `INVALID_JOB_STATUS` | `400` | Job action was attempted on the wrong job state |
| `ROUTE_NOT_FOUND` | `404` | Job lookup failed tenant scoping or the route is wrong |
| `RATE_LIMIT_EXCEEDED` | `429` | Reindex limit was hit |
| `INTERNAL_ERROR` | `500` | Required backend dependency is missing or another internal failure occurred |

## Practical Frontend Rules

- Use validate endpoints before saving expensive changes.
- Use `impact.reindexRequired` to decide whether to offer an immediate reindex CTA.
- After a successful patch, trust the returned collection DTO rather than reconstructing state locally.
- Treat `nextCursor` as opaque.
- Never parse JSON from `204` responses.
