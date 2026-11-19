# Configuration

Every setting has a default, so the config file is optional. Settings come from three places, later ones winning:

1. Built-in defaults (listed below).
2. The YAML file [config/rag.config.yaml](../config/rag.config.yaml) (or the path in `RAG_CONFIG_PATH`). If the file does not exist, the defaults are used and the server logs `No config file at ...`.
3. Environment variables `RAG_*` (in Docker: the `.env` file next to `docker-compose.yml`). They are applied when the server or a CLI loads its config and are never written back to the YAML.

The config is read at startup; restart the server after changing it (`docker compose restart backend`, or restart `npm run dev`).

## Settings and defaults

```yaml
server:
  port: 3010
registry:
  path: data/registry.sqlite        # collections, jobs, logs (SQLite)
chroma:
  url: http://localhost:8000        # in Docker overridden to http://chroma:8000
embedding:                          # default for NEW collections; each collection keeps its own
  provider: builtin                 # builtin | openai-compatible
  model: onnx-community/embeddinggemma-2-ONNX
  baseUrl: ""                       # openai-compatible API, e.g. http://localhost:11434/v1
  cacheDir: models                  # where the built-in model is downloaded
chat:                               # optional; empty = retrieve-only (/query returns 503)
  baseUrl: ""
  model: ""
  # temperature, maxTokens: not sent unless set here (provider defaults apply)
  # maxContextTokens: cap on the retrieved context sent to the model
collectionDefaults:                 # defaults for new collections
  sourcePath: data                  # default source checked by /ready and onboarding; a collection created
                                    # without sourcePath gets its own uploads folder instead
  distanceMetric: l2                # l2 | cosine | ip
  chunkSize: 500                    # characters
  chunkOverlap: 200                 # must be smaller than chunkSize
  retrievalK: 5
  retrievalDistanceThreshold: 1.2   # chunks farther than this are dropped
  timeoutMs: 180000
readiness:
  timeoutMs: 30000
  embeddingProbeText: Hello         # onboarding's test embedding
  chatProbeText: Reply with one short sentence.
cleanup:
  retentionMs: 3600000              # how long retired indexes are kept before deletion
limits:
  maxConcurrentEmbeddings: 5
  maxConcurrentGenerations: 2
rateLimit:
  enabled: true
  windowMs: 60000
  maxRequestsPerWindow: 60
adminAuth:
  enabled: false                    # see docs/admin_auth.md
observability:
  includeDebugTimings: false        # adds debug.latency to query/retrieve responses
sampleCollection:
  enabled: true                     # create and index "Sample documents" on the very first start
uploads:
  maxFileSizeMb: 50                 # per file uploaded through the files API (stored in data/collections/<id>)
```

API keys are never stored in the YAML: the chat key comes from `RAG_CHAT_API_KEY` or `.local/rag_chat_api_key.secret`, the embedding key from `RAG_EMBEDDING_API_KEY` or `.local/rag_embedding_api_key.secret`, and the admin session secret from `RAG_ADMIN_SESSION_SECRET` or `.local/rag_admin_session.secret`. They are redacted from errors and never returned by the API.

## Environment variables

| Variable | Overrides |
| -------- | --------- |
| `RAG_CONFIG_PATH` | Config file location (default `config/rag.config.yaml`) |
| `RAG_PORT` | `server.port` |
| `RAG_REGISTRY_PATH` | `registry.path` |
| `RAG_CHROMA_URL` | `chroma.url` (`http://chroma:8000` in Docker) |
| `RAG_EMBEDDING_PROVIDER` | `embedding.provider` (`builtin` or `openai-compatible`) |
| `RAG_EMBEDDING_MODEL` | `embedding.model` |
| `RAG_EMBEDDING_BASE_URL` | `embedding.baseUrl` |
| `RAG_EMBEDDING_CACHE_DIR` | `embedding.cacheDir` |
| `RAG_EMBEDDING_API_KEY` | Embedding API key (instead of `.local/rag_embedding_api_key.secret`) |
| `RAG_CHAT_BASE_URL` | `chat.baseUrl` (empty = retrieve-only) |
| `RAG_CHAT_MODEL` | `chat.model` |
| `RAG_CHAT_API_KEY` | Chat API key (instead of `.local/rag_chat_api_key.secret`) |
| `RAG_SOURCE_PATH` | `collectionDefaults.sourcePath` |
| `RAG_SAMPLE_COLLECTION` | `sampleCollection.enabled` (`true` / `false`) |
| `RAG_ADMIN_SESSION_SECRET` | Admin session secret (instead of `.local/rag_admin_session.secret`) |

Docker-only variables (read by `docker-compose.yml`): `BACKEND_HOST_PORT` (default `3010`) and `CHROMA_HOST_PORT` (default `8000`).

An empty environment variable does not override the file. Inside a container, `localhost` is the container itself: use `host.docker.internal` for services running on your computer.

## Onboarding (`npm run onboard`)

Onboarding is the interactive way to write the config when you run the backend without Docker. Press Enter to keep the current value.

By default it asks only the main choices:

- the embedding provider for new collections (and, for `openai-compatible`, the base URL, model and API key); an external service is checked and runs one test embedding, a built-in model is only reported (it downloads on the first indexing)
- whether to enable a chat model for answer generation (and its base URL, model and API key); it is checked and answers one test prompt
- whether to enable admin auth (session secret, first admin user and password; only a scrypt hash of the password is saved)

Every other setting is kept. Flags:

- `--advanced` asks every setting (port, registry path, Chroma URL, collection defaults, readiness, cleanup, limits, rate limiting, debug timings)
- `--yes` skips the questions and only runs the checks against the existing config
- `--dry-run` or `--no-write` asks the questions and runs the checks without writing the config
- `--config <path>` uses a different config file

It writes [config/rag.config.yaml](../config/rag.config.yaml) (keeping the previous version as `config/rag.config.yaml.bak`), analyzes the default source folder, and checks Chroma, the embedding and the chat model. If something is missing it prints `Config saved; fix these before indexing:` with a one-line fix for each problem; the config is already saved, so you do not need to rerun it after fixing the problem.

It does not create, edit, index or monitor collections (use the admin panel or the admin API), and it does not create the SQLite registry (the server does that on startup).

## Running on another machine

Paths inside the project are stored relative to the project root (for example `collectionDefaults.sourcePath: data` and collection source paths such as `data/my-docs`), so you can clone or move the repo anywhere and run it from the project root. Collections that still point at an absolute path inside the project are rewritten to relative paths when the server starts. Paths outside the project stay absolute.
