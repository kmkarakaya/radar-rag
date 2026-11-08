# HTTP Workflows

This file provides end-to-end request examples for the most important backend workflows.

Set these environment variables first:

```powershell
$BASE_URL = "http://localhost:3000"
$TENANT_ID = "default"
$USER_ID = "frontend-user"
$REQUEST_ID = [guid]::NewGuid().ToString()
$COOKIE_JAR = Join-Path $env:TEMP "rag-admin-cookie.txt"
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

Answer generation is optional. Without a chat LLM (the shipped default) the summary reports `queryEnabled: false`, `queryReady: false`, `systemReadyFor: "retrieve-and-index"`, and still `ready: true`; `/retrieve` and indexing work, `/query` returns `503 CHAT_NOT_CONFIGURED`. With a chat LLM configured, `dependencies.chat` in `?details=true` shows the result of a cached `GET {chat.baseUrl}/models` check (never a generation).

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
- Without a chat LLM, `capabilities.query` is `false`, `modelAvailability.chatModel` is `null`, and `warnings` contains `CHAT_NOT_CONFIGURED`; `capabilities.retrieve` is unaffected.

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

The response JSON includes the effective `embeddingModel` used for retrieval and the global `chatModel` that generated the answer.

This endpoint needs the optional chat LLM (any OpenAI-compatible chat completions API, configured with `npm run onboard` or `RAG_CHAT_BASE_URL` / `RAG_CHAT_MODEL`, plus `RAG_CHAT_API_KEY` if the provider needs a key). Chat-specific failures:

- `503 CHAT_NOT_CONFIGURED`: no chat LLM is configured (retrieve-only). Returned before body validation and collection lookup, without `Retry-After`. Use `/retrieve` instead.
- `503 CHAT_PROVIDER_UNREACHABLE`: the chat API cannot be reached.
- `502 CHAT_PROVIDER_ERROR`: the chat API returned an HTTP error (bad key, unknown model, 429, 5xx); see `details.upstreamStatus` and `details.providerMessage`.

## 2. Admin Auth Flow

When `adminAuth.enabled=false`, the legacy header-based admin flow continues to work for local development. When `adminAuth.enabled=true`, the admin shell and `/v1/admin/**` routes require a session cookie, and protected mutations also require `x-admin-action-token`.

The admin examples below keep `x-tenant-id` and `x-user-id` visible because the same snippets also work in local fallback mode. When admin auth is enabled, `/v1/admin/**` ignores caller-supplied tenant/user headers and derives both values from the authenticated session.

### Log in

```powershell
curl.exe -i `
  -c "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d '{"username":"admin","password":"secret"}' `
  "$BASE_URL/v1/admin/auth/login"
```

### Inspect current admin session

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  "$BASE_URL/v1/admin/auth/session"
```

### Mint a signed action token for one mutating route

```powershell
$ACTION_TOKEN_RESPONSE = curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d '{"method":"POST","path":"/v1/admin/collections/example/reindex"}' `
  "$BASE_URL/v1/admin/auth/action-token"
```

### Log out

```powershell
curl.exe -i `
  -b "$COOKIE_JAR" `
  -X POST `
  "$BASE_URL/v1/admin/auth/logout"
```

## 3. Admin Collection Creation Flow

### Inspect backend defaults for the create form

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/config/defaults"
```

Use this response to show the backend defaults in the create form before the user saves anything. Its `chat` object (`enabled`, `baseUrl`, `model`, `apiKeyConfigured`) describes the global, optional chat LLM; it is read-only and not part of the collection form.

### Inspect model discovery for the create form

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/models"
```

Use this response to populate embedding model autocomplete or datalist suggestions while still allowing free text input. Ollama only serves embeddings; collections have no chat model field.

### Create a collection

```powershell
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d '{"method":"POST","path":"/v1/admin/collections"}' `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -H "x-admin-action-token: $ACTION_TOKEN" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"displayName":"Example Collection","sourcePath":"data"}' `
  "$BASE_URL/v1/admin/collections"
```

### Validate before saving or reindexing

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
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
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d "{""method"":""PATCH"",""path"":""/v1/admin/collections/$COLLECTION_ID""}" `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -s `
  -b "$COOKIE_JAR" `
  -X PATCH `
  -H "content-type: application/json" `
  -H "x-admin-action-token: $ACTION_TOKEN" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"retrievalK":8,"retrievalDistanceThreshold":0.35}' `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID"
```

### Inspect physical collection lifecycle visibility

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/collections/$COLLECTION_ID/physical-collections"
```

Use this response to inspect which physical collection is currently active, which older rebuilds are waiting for cleanup, and whether any target build failed before activation.

## 4. Reindex Flow

### Trigger reindex

```powershell
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d "{""method"":""POST"",""path"":""/v1/admin/collections/$COLLECTION_ID/reindex""}" `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -i `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "x-admin-action-token: $ACTION_TOKEN" `
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
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID"
```

### Poll job event timeline

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID/events"
```

Use this response for stage-aware progress UIs. `status` stays coarse; `stage`, `code`, and `details` explain what the job is doing now and what it has already completed.

### Poll job list

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
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

## 5. Audit History Flow

### List newest-first history for one collection

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/audit-log?collectionId=$COLLECTION_ID&limit=25"
```

### Filter audit history across multiple collections

```powershell
$COLLECTION_ID_2 = "another-collection-id"

curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/audit-log?collectionId=$COLLECTION_ID&collectionId=$COLLECTION_ID_2&limit=25"
```

### Filter audit history across multiple operations

```powershell
curl.exe -s `
  -b "$COOKIE_JAR" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/audit-log?collectionId=$COLLECTION_ID&operation=query&operation=retrieve&limit=25"
```

Notes:

- `collectionId` and `operation` are repeatable query params for multi-select filters.
- Results are newest-first.
- `nextCursor` is opaque; pass it back unchanged if you paginate.
- If any selected collection is outside the current tenant, expect `403 COLLECTION_FORBIDDEN`.
- If any selected collection does not exist, expect `404 COLLECTION_NOT_FOUND`.
- Use this endpoint for persisted operator history such as reindex, delete, query, retrieve, and related failures.

## 6. Job Cancel And Delete Flow

When `adminAuth.enabled=true`, these mutations require the session cookie **and** a freshly minted `x-admin-action-token` (bound to the exact method + path), exactly like the reindex flow. The snippets below mint the token just in time.

### Cancel a queued or running job

```powershell
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d "{""method"":""POST"",""path"":""/v1/admin/jobs/$JOB_ID/cancel""}" `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -i `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "x-admin-action-token: $ACTION_TOKEN" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID/cancel"
```

Expected result:

- `204 No Content`

### Delete a terminal job

```powershell
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d "{""method"":""DELETE"",""path"":""/v1/admin/jobs/$JOB_ID""}" `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -i `
  -b "$COOKIE_JAR" `
  -X DELETE `
  -H "x-admin-action-token: $ACTION_TOKEN" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  "$BASE_URL/v1/admin/jobs/$JOB_ID"
```

Expected result:

- `204 No Content`

### Bulk-delete terminal jobs

```powershell
$ACTION_TOKEN = ((curl.exe -s `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "content-type: application/json" `
  -d "{""method"":""POST"",""path"":""/v1/admin/jobs/bulk-delete""}" `
  "$BASE_URL/v1/admin/auth/action-token" | ConvertFrom-Json).actionToken)

curl.exe -i `
  -b "$COOKIE_JAR" `
  -X POST `
  -H "x-admin-action-token: $ACTION_TOKEN" `
  -H "content-type: application/json" `
  -H "x-tenant-id: $TENANT_ID" `
  -H "x-user-id: $USER_ID" `
  -H "x-request-id: $REQUEST_ID" `
  -d '{"jobIds":["job_001","job_002"]}' `
  "$BASE_URL/v1/admin/jobs/bulk-delete"
```

## 7. Rate Limit Failure Example

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

## 8. Invalid Request Example

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

## 9. Recommended Frontend Polling Strategy

- Poll `/v1/admin/jobs/:jobId` or `/v1/admin/jobs` every `2-5s` while reindex is queued or running.
- Poll `/v1/admin/jobs/:jobId/events` every `2-5s` when the current UI needs stage-level progress detail.
- Poll `/v1/rag/collections/:collectionId/ready` every `2-5s` while the selected collection has an active job.
- Refresh `/v1/admin/collections/:collectionId/physical-collections` and `/v1/admin/audit-log` when the current admin view depends on lifecycle or persisted history.
- Stop polling once the job is terminal or readiness no longer reports an active queued/running job.
- On `429`, wait for `Retry-After` before polling again.
