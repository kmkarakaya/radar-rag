# Operations

Running the backend day to day: health checks, limits, logs, index lifecycle and scripts. API details are in [user_api_endpoints.md](./user_api_endpoints.md) and [admin_api_endpoints.md](./admin_api_endpoints.md).

## Health and readiness

- `GET /health`: liveness (the process is up).
- `GET /ready`: system readiness. Always `200`; read `ready`, `retrieveReady`, `queryReady`, `indexReady` and `systemReadyFor` in the body. `?strict=true` returns `503` when the system is not ready; `?details=true` adds every check with blockers, warnings and recommended actions.
- `GET /v1/rag/collections/:collectionId/ready`: whether one collection can serve retrieval and answers right now. Use it as the gate before enabling search in a UI.
- The checks are cheap: they never run an embedding or a generation. The built-in model is checked against its catalog and download cache; external services with a free, cached `GET /models`.

## Limits

- Rate limiting (on by default): `rateLimit.windowMs` / `rateLimit.maxRequestsPerWindow` per tenant, user, collection and operation, for query, retrieve and re-index. Over the limit the API returns `429 RATE_LIMIT_EXCEEDED` with `Retry-After` and `X-RateLimit-*` headers.
- Concurrency: `limits.maxConcurrentEmbeddings` and `limits.maxConcurrentGenerations` cap parallel embedding and chat calls; requests that wait too long return `503 MODEL_BACKPRESSURE`.
- JSON request bodies are limited to 1 MB. Document uploads (`POST /v1/admin/collections/:id/files`) are multipart: each file up to `uploads.maxFileSizeMb` (default 50 MB), at most 20 files per request; files are streamed to disk, not held in memory.
- Rate limits and admin sessions are kept in memory, so they assume a single backend instance.

## Logs and debug timings

- Every request gets a request id (`x-request-id`, generated if missing), returned in errors and written to the structured operational log, which is also stored in the registry (`operational_logs`). The admin panel's audit log shows the persisted history.
- Set `observability.includeDebugTimings: true` to add `debug.latency` (`retrievalMs`, `generationMs`, `totalMs`) to query and retrieve responses; it is `false` by default.

## Embedding and chat services and their keys

- Embedding services added through the admin panel or `/v1/admin/embedding-services` are stored in the registry (`data/registry.sqlite`), with their API keys in **plain text**. The API never returns a key, and keys are redacted from errors and job errors. Treat the registry file and its backups as secret.
- Whoever can manage embedding services decides where document text is sent, and the server makes requests to the URLs they enter. Only the `admin` role can manage them when admin auth is on; turn it on before other people can reach the server.
- Chat services (`/v1/admin/chat-services`) and each tenant's chat choice (`/v1/admin/chat-settings`) are stored the same way, chat API keys in plain text too. Whoever manages them decides where questions and retrieved document text are sent for answer generation; only the `admin` role can do it when admin auth is on.
- A service's URL or key change applies to the next request of every collection that uses it (clients are cached per service version); no restart and no re-index are needed.

## Documents on disk

- Uploads collections keep their documents in `data/collections/<collection id>` (with Docker: `./data/collections` next to `docker-compose.yml`). Deleting the collection deletes that folder. Back up `./data` to keep both the documents and the registry.
- Folder collections read their `sourcePath` directly; nothing in the API changes those files. Scans of a folder never descend into `data/collections`, so a folder collection on `data` does not index other collections' uploads.
- An upload makes the collection `reindex_required` until the next re-index; until then searches use the previous content. A delete removes the document's chunks from the active index at once (and lowers `chunkCount` / `documentCount`), so it needs no re-index; if Chroma cannot be reached, nothing is deleted (`503 COLLECTION_STORAGE_INCONSISTENT`).
- Uploads and deletes are refused while the collection's index job is queued or running, so a job always reads a stable set of files.
- The Docker image runs as root, so on a Linux host the files it writes into `./data` (registry and uploads) belong to root; use `sudo` to remove them by hand.

## Index lifecycle and cleanup

- Each re-index builds a new physical Chroma collection and switches the collection to it only when the build succeeds (blue/green), so searches keep working during a rebuild. One re-index job can run per collection at a time.
- Retired physical collections are deleted after `cleanup.retentionMs`. Their lifecycle states are `delete_pending`, `cleanup_failed` (retried) and `failed_build`.
- Storage delete handling is idempotent not-found cleanup behavior: deleting something that is already gone is not an error. Accessing another tenant's collection returns `COLLECTION_FORBIDDEN`.
- Interrupted jobs never stay "running". When the server stops (restart, update, `docker compose stop`), it marks its running jobs failed with "Interrupted: the server stopped while this job was running. Re-index again." A running job (in the server or in `npm run index`) also records a heartbeat every 30 seconds; a job without one for 3 minutes (its process crashed or was killed) is failed at startup or by a check that runs every minute. The collection keeps serving its previous index; re-index it again.
- Docker: the compose file gives the backend `stop_grace_period: 30s` so it can stop cleanly; built-in embedding batches can keep it busy for a few seconds.
- `GET /v1/admin/collections` (with `/v1/admin/jobs/` for job status) is a registry-style discovery endpoint and does not return query/retrieve capability flags. Its items include `readyUrl`, `queryUrl` and `retrieveUrl`; when a collection has no active index yet, the `activeVersion` and `chunkCount` fields stay `null` instead of disappearing from the response shape.
- The HTTP application is assembled in [src/app.ts](../src/app.ts).

## Scripts

- `npm run dev`: start in watch mode. `npm run build` then `npm start`: compile and run.
- `npm run onboard`: write the config interactively (see [configuration.md](./configuration.md)).
- `npm run index -- --collection-id <id>`: re-index an existing collection from the command line.
- `npm run admin:hash-password -- "<password>"`: scrypt hash for a config user.
- `npm test`, `npm run test:integration` (needs Chroma), `npm run typecheck`, `npm run typecheck:test`.
