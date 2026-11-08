# Test Frontend Example

This directory contains a static browser example aligned with the current public RAG API contract in this repository.

It is meant to be useful in two ways:

- A human can open it and manually verify the backend behavior from the browser.
- A coding agent can read it as a working reference implementation for the current `/v1/rag` flows.

## Scope

This example is intentionally a **public RAG frontend example**, not an admin console.

It demonstrates:

- `GET /`
- `GET /health`
- `GET /ready`
- `GET /ready?details=true`
- `GET /v1/rag/collections`
- `GET /v1/rag/collections/:collectionId`
- `GET /v1/rag/collections/:collectionId/ready`
- `POST /v1/rag/collections/:collectionId/retrieve`
- `POST /v1/rag/collections/:collectionId/query` (only when the backend has a chat LLM configured)

It also demonstrates:

- sending `x-tenant-id`, `x-user-id`, and `x-request-id` on every request
- readiness-driven UI enablement for `query` and `retrieve`
- rendering `blockers`, `warnings`, and `recommendedActions`
- rendering effective `embeddingProvider`, `embeddingModel` and `chatModel` metadata from query/retrieve responses
- surfacing `requestId`, `Retry-After`, and `X-RateLimit-*` response headers
- keeping `query` and `retrieve` as separate user actions
- a retrieve-only backend: without a chat LLM, readiness reports `capabilities.query: false` with a `CHAT_NOT_CONFIGURED` warning and **Generate Answer** stays disabled

## Run It

1. Start the backend.
2. Make sure at least one collection exists and has an active index.
3. Open `http://localhost:3010/test-frontend/` in the browser.

If the collection list is empty, create a collection through the admin API or CLI first, then run reindex.

## What This Example Intentionally Does Not Cover

- `/v1/admin` endpoints
- collection creation, patching, validation, or reindex UI
- job polling or job management screens
- authentication/session integration
- persistent chat history
- framework-specific structure such as React, Vue, or Next.js

## Why This Example Is Useful

The file [`index.html`](./index.html) is small enough to read quickly, but it still enforces the most important public contract rules:

- it does not use legacy `/rag/query` or `/rag/retrieve` routes
- it does not enable query buttons before collection readiness confirms capability
- it does not assume `query.sources` is the same full set that `retrieve` would return
- it does not hide the effective model metadata returned by query/retrieve
- it preserves backend diagnostics that are easy to lose in a rushed frontend implementation

## How To Reuse It In A Real Frontend

When adapting this example into a production frontend, keep these pieces:

- the request helper pattern that injects `x-tenant-id`, `x-user-id`, and `x-request-id`
- the readiness check before enabling `query` and `retrieve`
- separate UI treatment for `retrieve` and `query`
- the rate-limit and error display behavior
- request/response inspection during early integration

You will usually replace these pieces:

- the static HTML layout
- the tenant and user inputs
- the simple output panes
- the minimal state model

## Safe Customizations

These changes are usually safe:

- changing the visual design
- moving from static HTML to React, Vue, Svelte, or another framework
- changing how source cards are rendered
- adding auto-refresh or polling around readiness checks
- adding richer collection detail presentation

## Contract Rules You Should Not Break

- Use only versioned `/v1` endpoints.
- Keep `GET /v1/rag/collections/:collectionId/ready` as the capability gate.
- Keep sending `x-tenant-id`, `x-user-id`, and `x-request-id`.
- Handle `400`, `403`, `404`, `413`, `422`, `429`, `502`, and `503` distinctly.
- Treat `Retry-After` as actionable on `429`.
- Treat `503 CHAT_NOT_CONFIGURED` from `/query` as a configuration state (no chat LLM), not a transient error; it has no `Retry-After`.
- Treat `query.sources` as generation-context output, not automatically as the full evidence set.
- Treat `retrieve.embeddingProvider` / `retrieve.embeddingModel` and `query.embeddingProvider` / `query.embeddingModel` / `query.chatModel` as part of the response contract.
- If `desiredEmbeddingModel` appears in readiness, treat it as a pending post-reindex change.

## Related Docs

Read these files together with this example:

- [`../docs/frontend_agent_handoff.md`](../docs/frontend_agent_handoff.md)
- [`../docs/user_api_endpoints.md`](../docs/user_api_endpoints.md)
- [`../docs/http_workflows.md`](../docs/http_workflows.md)
- [`../docs/frontend_acceptance_checklist.md`](../docs/frontend_acceptance_checklist.md)
- [`../docs/openapi.yaml`](../docs/openapi.yaml)

## Recommendation For End Users

If someone wants to build their own frontend with a coding agent, giving the agent both the docs and this example is stronger than giving docs alone.

The docs explain the contract.

This example shows one concrete way to respect it.
