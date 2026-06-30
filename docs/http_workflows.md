# HTTP Workflows

This file provides end-to-end request examples for the most important backend workflows.

Set these environment variables first:

```powershell
$BASE_URL = "http://localhost:3000"
$TENANT_ID = "default"
$USER_ID = "frontend-user"
$REQUEST_ID = [guid]::NewGuid().ToString()
```

## 0. System Readiness Diagnostics

### Summary readiness

```powershell
curl.exe -s "$BASE_URL/ready"
```

### Full readiness details

```powershell
curl.exe -s "$BASE_URL/ready?details=true"
```

### Strict readiness for deployment checks

```powershell
curl.exe -i "$BASE_URL/ready?details=true&strict=true"
```

Use `/ready` for environment or deployment diagnostics. For collection-specific UI behavior, use `GET /v1/rag/collections/:collectionId/ready`.

## 1. Public RAG Flow

### List visible collections

```powershell
curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/rag/collections"
```

### Load one public collection

```powershell
$COLLECTION_ID = "your-collection-id"

curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID"
```

### Inspect one collection's readiness

```powershell
curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID/ready"
```

Important:

- A `200` response does not automatically mean query is enabled.
- Check `capabilities.query`, `capabilities.retrieve`, `blockers`, and `warnings`.

### Retrieve evidence only

```powershell
curl.exe -s `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"question":"What rulings exist on this topic?","k":5}' `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID/retrieve"
```

The response JSON includes the effective `embeddingModel` used for retrieval.

### Ask a grounded question

```powershell
curl.exe -s `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"question":"Does withholding tax apply in this case?"}' `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID/query"
```

The response JSON includes the effective `embeddingModel` used for retrieval and the `chatModel` that generated the answer.

## 2. Admin Collection Creation Flow

### Inspect backend defaults for the create form

```powershell
curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/config/defaults"
```

Use this response to show the backend defaults in the create form before the user saves anything.

### Create a collection

```powershell
curl.exe -s `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"displayName":"Example Collection","sourcePath":"data","ozelgeDataPath":"data/ozelge_veri.json"}' `
  "$BASE_URL/v1/admin/collections"
```

### Validate before saving or reindexing

```powershell
curl.exe -s `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"chunkSize":512,"chunkOverlap":64,"embeddingModel":"bge-m3"}' `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID/validate"
```

Interpretation:

- `impact.immediateFields` take effect without reindex.
- `impact.reindexFields` require reindex before the active index matches the saved config.

### Save a patch

```powershell
curl.exe -s `
  -X PATCH `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"retrievalK":8,"retrievalDistanceThreshold":0.35}' `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID"
```

## 3. Reindex Flow

### Trigger reindex

```powershell
curl.exe -i `
  -X POST `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID/reindex"
```

Notes:

- Success is `202 Accepted`.
- The response includes a `job.id`.
- If a reindex is already active, expect `409 COLLECTION_INDEX_ALREADY_RUNNING`.
- Rate-limit headers are present on success and on `429`.

### Poll job detail

```powershell
$JOB_ID = "your-job-id"

curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID"
```

### Poll job list

```powershell
curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs?collectionId=$COLLECTION_ID&status=queued,running&limit=10"
```

Notes:

- `status` can be repeated or comma-separated.
- `nextCursor` is opaque; pass it back unchanged if you paginate.

### Re-check public readiness after indexing

```powershell
curl.exe -s `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID/ready"
```

## 4. Job Cancel And Delete Flow

### Cancel a queued or running job

```powershell
curl.exe -i `
  -X POST `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID/cancel"
```

Expected result:

- `204 No Content`

### Delete a terminal job

```powershell
curl.exe -i `
  -X DELETE `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID"
```

Expected result:

- `204 No Content`

### Bulk-delete terminal jobs

```powershell
curl.exe -i `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"jobIds":["job_001","job_002"]}' `
  "$BASE_URL/v1/admin/jobs/bulk-delete"
```

## 5. Rate Limit Failure Example

```powershell
curl.exe -i `
  -X POST `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"question":"limited?"}' `
  "$BASE_URL/v1/rag/collections/$COLLECTION_ID/query"
```

If rate-limited, expect:

- `429 RATE_LIMIT_EXCEEDED`
- `Retry-After`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## 6. Invalid Request Example

```powershell
curl.exe -s `
  -X PATCH `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"unknownPatchKey":true}' `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID"
```

Expect:

- `400 INVALID_REQUEST_BODY`
- often `details.issues`

## 7. Recommended Frontend Polling Strategy

- Poll `/v1/admin/jobs/:jobId` or `/v1/admin/jobs` every `2-5s` while reindex is queued or running.
- Poll `/v1/rag/collections/:collectionId/ready` every `2-5s` while the selected collection has an active job.
- Stop polling once the job is terminal or readiness no longer reports an active queued/running job.
- On `429`, wait for `Retry-After` before polling again.
