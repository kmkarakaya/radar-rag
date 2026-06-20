# Admin Panel Cold Start Prompt Pack

Bu dosyadaki promptlari sirayla kullan. Her promptu yeni bir cold-start oturumuna tek basina copy-paste et. Kucuk modelin baglamina guvenme; her prompt kendi kurallarini tekrar eder.

Onemli kullanim kurali:

- Ayni oturumda birden fazla adim yaptirma.
- Once Prompt 00, sonra Prompt 01, sonra Prompt 02 seklinde ilerle.
- Her adimdan sonra modelin final raporunu ve `git diff` kapsamini kontrol et.
- Beklenen uygulama dosyalari sadece `admin/index.html`, `admin/admin.js`, `admin/admin.css`.
- `notes/adminpanel_plan.md` ana kaynak dokumandir. Bu promptlar o planin uygulanabilir kopyalaridir.

## Prompt 00 - Audit, Kod Degisikligi Yok

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 0 from notes/adminpanel_plan.md.

Hard rules:
- Do not edit any file in this step.
- Do not modify backend files.
- Do not invent or change endpoints.
- Read the plan file first: notes/adminpanel_plan.md.
- Also read these files for context:
  - admin/index.html
  - admin/admin.js
  - admin/admin.css
  - src/http/adminRouter.ts
  - src/http/ragRouter.ts
  - src/app.ts
  - src/http/errors.ts
- Use the repo as source of truth if anything in the plan seems inconsistent.

What to do:
1. Audit the existing admin HTML/JS/CSS structure.
2. Audit the real backend API contracts.
3. Confirm that later implementation steps must only touch admin/index.html, admin/admin.js, and admin/admin.css.
4. Identify mismatches in the current admin panel:
   - job listing absence
   - collection readiness response shape
   - job statuses
   - error details path
   - unsafe or brittle DOM rendering
   - create-mode inspector behavior

Do not implement anything.

Final response format:
- Files read
- Endpoint facts confirmed
- Current admin panel issues
- Risks for next step
- Confirm: no files were changed
```

## Prompt 01 - API Client, State Model, Safe Render Temeli

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 1 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Expected edit files: admin/admin.js, and only admin/index.html or admin/admin.css if strictly needed.
- Do not edit src/, test/, config/, package files, or backend endpoint/schema files.
- Do not invent new endpoints.
- Preserve the current static admin app shape.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css
  - src/http/errors.ts
  - src/http/ragRouter.ts
  - src/http/adminRouter.ts

Implement Step 1:
1. Improve `apiRequest`:
   - Return `null` for HTTP 204.
   - Handle empty/non-JSON response bodies safely.
   - Normalize errors with `status`, `code`, `message`, `requestId`, `details`, and `issues`.
   - Read Zod issues from `data.details?.issues`, not `data.issues`.
2. Extend state safely:
   - collections
   - selectedCollection
   - selectedReadiness
   - playgroundMode
   - knownJobs
   - isLoading flags
   - lastError
3. Add endpoint helpers:
   - collectionReadyUrl(collection)
   - collectionQueryUrl(collection)
   - collectionRetrieveUrl(collection)
   - adminCollectionUrl(id)
   - adminJobUrl(id)
4. Add small DOM/render helpers:
   - clearNode(node)
   - createBadge or equivalent
   - formatDateTime
   - formatCount
   - setButtonLoading
5. Reduce unsafe backend text injection in collection rendering.
6. Keep existing UI behavior working.

Small-model implementation order:
1. Fix only apiRequest and error normalization; run syntax check mentally before continuing.
2. Add endpoint/helper functions without changing all call sites.
3. Add DOM helpers.
4. Touch renderCollections only as much as needed to reduce unsafe text injection.
5. Do not rewrite the whole app.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin

Final response format:
- Changed files
- What changed
- Commands run and results
- Manual test steps for http://localhost:3010/admin/
- Any remaining risk
```

## Prompt 02 - Collections View ve Inspector Akisi

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 2 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not edit backend files.
- Do not change or add endpoints.
- Preserve existing HTML ids and data attributes unless the plan explicitly requires a small addition.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css

Implement Step 2:
1. Improve Collections view states:
   - loading
   - empty
   - error
2. Render collection cards using the real GET /v1/rag/collections DTO:
   - id
   - displayName
   - description
   - status
   - chunkCount
   - activeVersion
   - updatedAt
3. Use backend status values correctly:
   - creating
   - indexing
   - ready
   - failed
   - archived
4. Improve inspector open/close flow:
   - Existing collection mode fills title, status, and editor fields.
   - Create mode clears selected collection and editor fields.
   - Create mode disables or hides Readiness, Playground, Re-index, and Delete actions.
   - Existing collection mode enables relevant actions.
5. Wire existing `#btnCancelEdit`.
6. Ensure overlay/close/cancel behavior is stable.
7. Optional: add Escape-to-close if small and safe.

Important existing HTML ids:
- #collectionsGrid
- #inspectorOverlay
- #inspectorPanel
- #inspectorTitle
- #inspectorStatusBadge
- #btnCloseInspector
- .tab-btn[data-tab]
- #tab-ready
- #tab-playground
- #tab-editor
- #colEditForm
- #btnCancelEdit
- #btnReindex
- #btnDeleteCol

Small-model implementation order:
1. Add missing element references such as btnCancelEdit.
2. Add loading/empty/error render paths for collections.
3. Fix openInspector(null) create mode.
4. Fix openInspector(id) existing collection mode.
5. Wire close/cancel/Escape behavior.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Open http://localhost:3010/admin/
2. Verify collection list or empty state.
3. Click New Collection and verify create mode.
4. Click an existing collection and verify inspector title/status/form.
5. Verify cancel/close/overlay behavior.

Final response format:
- Changed files
- What changed
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 03 - Create/Edit Form ve Payload Guvenligi

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 3 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not edit src/http/adminRouter.ts.
- Do not edit backend schemas.
- Do not add endpoints.
- The payload must match existing createCollectionSchema and updateCollectionSchema.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - src/http/adminRouter.ts
  - src/http/errors.ts

Implement Step 3:
1. Build strict create/update payloads for:
   - displayName
   - description
   - sourcePath
   - ozelgeDataPath
   - distanceMetric
   - chunkSize
   - chunkOverlap
   - retrievalK
   - retrievalDistanceThreshold
   - embeddingModel
   - chatModel
2. Empty strings must not be sent.
3. Create mode:
   - displayName is required.
   - empty description should be omitted.
4. Update mode:
   - displayName is optional but if present must be non-empty.
   - if description is intentionally cleared, send `description: null`.
5. Numeric parsing:
   - Use Number(value), not `parseInt(value) || undefined`.
   - Preserve valid zero for chunkOverlap and retrievalDistanceThreshold.
   - Omit NaN and empty numeric fields.
6. Client-side validation:
   - displayName.trim() required for create.
   - chunkSize and retrievalK must be positive integers.
   - chunkOverlap must be nonnegative integer.
   - retrievalDistanceThreshold must be nonnegative number.
   - distanceMetric must be l2, cosine, or ip.
   - warn or prevent if chunkOverlap >= chunkSize.
7. Show INVALID_REQUEST_BODY issues from `details.issues`.
8. Disable/loading state during save.

Small-model implementation order:
1. Add helpers: readTrimmed, readOptionalNumber, readOptionalInteger.
2. Add buildCollectionPayload(mode).
3. Add validation helper and issue rendering/toast.
4. Replace saveCollection create/update branches.
5. Keep behavior narrow; do not rewrite unrelated UI.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. New Collection with empty displayName should be blocked client-side.
2. New Collection with only displayName should create successfully.
3. Existing collection description can be cleared.
4. retrievalDistanceThreshold=0 must be preserved in payload.
5. chunkOverlap=0 must be preserved in payload.
6. Browser Network payload should contain no empty strings, no NaN, and no unknown keys.

Final response format:
- Changed files
- Payload rules implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 04 - Collection Readiness ve Capability-Driven UI

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 4 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not add or change backend endpoints.
- Do not expect collection readiness to return a `blockers` array.
- Derive collection blocker messages from the actual readiness response.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - src/http/ragRouter.ts

Use this existing endpoint:
GET /v1/rag/collections/:collectionId/ready

Actual response fields to use:
- id
- status
- hasActivePhysicalCollection
- activeVersion
- activeJob
- chromaReadable
- chromaCount
- modelAvailability.embeddingModel
- modelAvailability.embeddingModelAvailable
- modelAvailability.chatModel
- modelAvailability.chatModelAvailable
- modelAvailability.desiredEmbeddingModel
- capabilities.query
- capabilities.retrieve
- capabilities.reindex

Implement Step 4:
1. Fetch readiness when inspector opens for an existing collection.
2. Fetch readiness when Readiness tab is selected.
3. Render readiness in existing elements:
   - #readinessStatusGrid
   - #readinessBlockers
   - #blockerList
4. Derive blockers:
   - no active physical collection
   - chroma not readable
   - embedding model unavailable
   - chat model unavailable
   - retrieve capability false
   - query capability false
5. Show active job id/status if present.
6. Update playground buttons from capabilities:
   - retrieve mode needs capabilities.retrieve
   - query mode needs capabilities.query
7. Disabled buttons must have visible reason or title tooltip.
8. Keep inspector open if readiness fetch fails; show error inside inspector.

Small-model implementation order:
1. Add fetchCollectionReadiness(collection).
2. Add deriveReadinessBlockers(readiness).
3. Add renderReadiness(readiness).
4. Add updatePlaygroundCapabilityState().
5. Wire calls from inspector open/tab switch/global refresh.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Open unindexed collection.
2. Verify no-active-physical warning.
3. Verify Retrieve and Query are disabled.
4. Start re-index and verify active job appears after refresh.
5. After successful indexing, verify capability-driven buttons update.

Final response format:
- Changed files
- Readiness behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 05 - Playground Retrieve/Query Render

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 5 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not change RAG endpoints.
- Do not send requests if question is empty.
- Use readiness capabilities before enabling retrieve/query.
- Render backend text with textContent/safe DOM nodes, not raw innerHTML.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - src/http/ragRouter.ts
  - src/rag.ts

Use existing endpoints:
POST /v1/rag/collections/:collectionId/retrieve
Body: { "question": string, "k"?: number }

POST /v1/rag/collections/:collectionId/query
Body: { "question": string }

Existing HTML ids:
- .mode-btn[data-mode="retrieve"]
- .mode-btn[data-mode="query"]
- #pgQuestion
- #btnPgRun
- #pgResult

Implement Step 5:
1. Keep playground mode state as retrieve or query.
2. Validate question.trim() before API call.
3. If readiness is unknown, fetch readiness first or keep action disabled.
4. Retrieve result render:
   - question
   - k
   - sourceCount
   - distanceScoreThreshold
   - collectionDisplayName
   - activeVersion
   - sources list
5. Query result render:
   - answer
   - distanceScoreThreshold
   - collectionDisplayName
   - activeVersion
   - sources/citations list
6. Source fields to show when present:
   - sourcePath
   - sourceType
   - chunkIndex
   - ozelgeId
   - sayi
   - tarih
   - konu
   - distanceScore
   - content preview
7. Show friendly errors for:
   - NO_RELEVANT_CONTEXT
   - ANSWER_NOT_IN_RETRIEVED_CONTEXT
   - COLLECTION_INDEXING
   - COLLECTION_NOT_READY
   - MODEL_BACKPRESSURE
   - RATE_LIMIT_EXCEEDED
8. Optional: include raw JSON in a `<details>` element.

Small-model implementation order:
1. Add empty-question and capability guard to runPlayground.
2. Add renderRetrieveResult(data).
3. Add renderQueryResult(data).
4. Add renderPlaygroundError(error).
5. Keep changes local to playground behavior.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Ready collection + Retrieve question shows source list.
2. Ready collection + Query question shows answer and sources.
3. Empty question makes no API request.
4. No-context or RAG error shows friendly error panel.

Final response format:
- Changed files
- Playground behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 06 - Re-index Job Tracking ve Job Monitor

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 6 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not add GET /v1/admin/jobs.
- Do not add or change any backend endpoint.
- The backend has no job listing endpoint.
- The Job Monitor may only track jobs observed by this browser/admin session.
- Do not show fake deterministic progress.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - src/http/adminRouter.ts
  - src/collections/types.ts

Use existing endpoints:
POST /v1/admin/collections/:collectionId/reindex
GET /v1/admin/jobs/:jobId
POST /v1/admin/jobs/:jobId/cancel

Use real job statuses:
- queued
- running
- succeeded
- failed
- cancelled

Implement Step 6:
1. Add knownJobs state and localStorage persistence.
2. Add a localStorage key such as `ragAdmin.knownJobs.v1`.
3. When reindexCollection receives `data.job`, remember it.
4. When collection readiness contains activeJob, merge it into knownJobs.
5. Replace the placeholder loadJobs:
   - poll each known job via GET /v1/admin/jobs/:jobId
   - update knownJobs state
   - persist updated state
6. Render #jobsTableBody with:
   - short job id
   - collection id/name if known
   - status badge
   - target version/physical collection if available
   - created/updated/finished times if available
   - document/chunk counts if available
   - error if failed
   - actions
7. Add cancel action for queued/running jobs:
   - POST /v1/admin/jobs/:jobId/cancel
   - reload job and collection list after success
8. Add remove-from-local-monitor action.
9. If you need more table columns, update admin/index.html table header in the same step.
10. Show clear UI text: "This monitor tracks jobs observed by this browser/admin session."

Small-model implementation order:
1. Add knownJobs state/localStorage helpers.
2. Add rememberJob(job, collection).
3. Wire reindexCollection to remember jobs.
4. Implement loadJobs polling known IDs.
5. Implement renderJobs.
6. Add cancelJob.
7. Merge readiness activeJob into known jobs.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Start re-index for a collection.
2. Job appears in Job Monitor.
3. Job status updates through polling.
4. queued/running job can be cancelled.
5. Duplicate re-index shows 409 COLLECTION_INDEX_ALREADY_RUNNING clearly.
6. Refresh page and known jobs remain visible from localStorage.

Final response format:
- Changed files
- Job monitor limitation explained
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 07 - System Health Dashboard

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 7 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not change /health or /ready backend behavior.
- Do not use /ready?strict=true for dashboard fetches.
- Prevent overlapping health polling requests.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - src/app.ts

Use existing endpoints:
GET /health
GET /ready
GET /ready?details=true

Existing HTML ids:
- #healthGrid
- #readinessDetail

Implement Step 7:
1. loadHealth should fetch:
   - /health
   - /ready
   - /ready?details=true
2. If details fetch fails, keep summary visible if possible.
3. Render summary cards:
   - process health: status, alive, uptimeSec, timestamp, port
   - readiness: ready, systemReadyFor, overallSummary, queryReady, indexReady
   - dependencies: registry, chroma, ollama
4. Render details:
   - recommendedActions
   - blockers
   - warnings
   - checks with code/name/status/capabilities/message/details
   - dataSource
   - config info such as chat model, embedding model, chroma URL, port
5. Empty states:
   - no recommended actions
   - no blockers
   - no warnings
6. Global refresh should update health.
7. Polling should not overlap if previous health request is still running.

Small-model implementation order:
1. Add overlapping guard in loadHealth.
2. Make existing summary render safer.
3. Add /ready?details=true fetch.
4. Add renderReadinessDetails(details).
5. Add fallback rendering when details are absent.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Health view renders process/readiness/dependency cards.
2. With Chroma/Ollama running, dependencies show OK.
3. With a dependency down, degraded state and recommended action are visible.
4. Refresh updates the view without mixing old/new results.

Final response format:
- Changed files
- Health dashboard behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 08 - UX Polish, Accessibility, Responsive Stabilizasyon

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 8 from notes/adminpanel_plan.md.

Hard rules:
- Only edit files under admin/.
- Do not change backend endpoints.
- Do not do a full redesign.
- Keep the app operational.
- Preserve existing ids/classes needed by admin/admin.js.
- Before editing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css

Implement Step 8:
1. Improve responsive behavior:
   - inspector full width on mobile, constrained on desktop
   - form single column on small screens
   - long paths/model names/job ids wrap safely
2. Improve accessibility:
   - icon-only buttons get title or aria-label
   - buttons have correct type
   - disabled buttons have visible reason or title
   - focus states remain visible
   - Escape-to-close works if already added or small to add
3. Improve toast layout:
   - long messages do not overflow
   - error details/issues readable
   - success/error/info styles consistent
4. Keep status badge colors consistent across views.
5. Polling cleanup:
   - avoid unnecessary loops if possible
   - optionally slow polling when page is hidden
6. Code organization:
   - keep helper functions grouped
   - do not add noisy comments

Small-model implementation order:
1. CSS/HTML responsive fixes first.
2. Add accessibility attributes.
3. Fix toast layout.
4. Add small polling cleanup/page visibility only if safe.
5. Run node --check after each behavioral JS change.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin

Manual tests to report:
1. Desktop: collections, inspector, jobs, health views.
2. Mobile viewport: collections, inspector, jobs, health views.
3. Long text does not break layout.
4. Keyboard tab and Escape behavior.
5. Console has no runtime errors.

Final response format:
- Changed files
- UX/accessibility behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
```

## Prompt 09 - Final Contract Audit ve Handoff

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Step 9 from notes/adminpanel_plan.md.

Hard rules:
- Do not implement new features unless a tiny admin-only fix is required to pass the audit.
- Do not edit backend files.
- Do not revert unrelated changes.
- If backend files have changed, report it clearly; do not undo user changes without permission.
- Before auditing, read:
  - notes/adminpanel_plan.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css

Audit requirements:
1. Verify only admin files were changed for implementation work:
   - admin/index.html
   - admin/admin.js
   - admin/admin.css
2. Verify no backend endpoint/schema/test file was modified as part of admin-only work.
3. Verify no legacy endpoint strings are used:
   - /rag/query
   - /rag/retrieve
4. Verify API URLs match existing backend contracts.
5. Verify error issues are read from details.issues.
6. Verify job statuses match backend:
   - queued
   - running
   - succeeded
   - failed
   - cancelled
7. Verify readiness code does not expect collection readiness to return a blockers array.
8. Verify Job Monitor explains the backend limitation: no job list endpoint, only observed jobs.
9. Verify create/update payloads do not send empty strings, NaN, or unknown keys.

Commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n '"/rag/query"|"/rag/retrieve"|/rag/query|/rag/retrieve' admin
git diff -- admin
git status --short

Optional if risk is high:
npm.cmd test

Manual test scenario summary to provide:
1. Open http://localhost:3010/admin/
2. Collection list or empty state appears.
3. Create collection with displayName only.
4. Edit description and retrieval threshold.
5. Open readiness for unindexed collection.
6. Start re-index and observe job monitor.
7. Run retrieve/query on a ready collection.
8. Open health dashboard.
9. Trigger or observe an error and verify code/message/requestId/issues rendering.

Final response format:
- Audit result
- Changed files
- Commands run and results
- Manual test checklist
- Residual risks
- Explicit confirmation whether backend files were untouched
```
