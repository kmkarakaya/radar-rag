# Admin Panel Cold Start Prompt Pack

Bu dosyadaki promptlari sirayla kullan. Her promptu yeni bir cold-start oturumuna tek basina copy-paste et. Kucuk modelin baglamina guvenme; her prompt kendi kurallarini tekrar eder.

Onemli kullanim kurali:

- Ayni oturumda birden fazla adim yaptirma.
- Once Prompt 00, sonra Prompt 01, sonra Prompt 02 seklinde ilerle.
- Her adimdan sonra modelin final raporunu ve `git diff` kapsamini kontrol et.
- Beklenen uygulama dosyalari sadece `admin/index.html`, `admin/admin.js`, `admin/admin.css`.
- `notes/adminpanel_plan.md` ana kaynak dokumandir. Bu promptlar o planin uygulanabilir kopyalaridir.

Kapanis kaydi zorunlulugu:

- Her promptu tamamlayan agent, final yanitini vermeden once `notes/adminpanel_done.md` dosyasina ayni prompt basligi ile bir kayit eklemeli.
- Kayit formati:

```md
## Prompt XX - <prompt basligi>
- Tarih: YYYY-MM-DD
- Degisen dosyalar:
- Yapilanlar:
- Testler:
- Eksik kalanlar / riskler:
- Dogrulama notu:
```

- `Yapilanlar` alaninda promptta istenen degisiklikler ozetlenmeli.
- `Eksik kalanlar / riskler` alaninda tamamlanmamis isler, manuel test gereksinimleri veya bilinen riskler yazilmali.
- `Dogrulama notu` alaninda agentin calismayi bitirdigine dair kisa not yer almali.
- Degisiklik yoksa `Degisen dosyalar: yok` yaz.

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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
rg -n "/rag/query|/rag/retrieve" admin

Final response format:
- Changed files
- What changed
- Commands run and results
- Manual test steps for http://localhost:3010/admin/
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
rg -n "/rag/query|/rag/retrieve" admin

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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
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
rg -n "/rag/query|/rag/retrieve" admin
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
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 10 - API Client ve Error/Toast Dayanikliligi

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 10 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not edit backend files.
- Do not add or change endpoints.
- Keep the current static admin app shape.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css
  - src/http/errors.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 01 only partially complete.
- `apiRequest` handles JSON errors but still tries `JSON.parse(text)` for non-JSON response bodies.
- Error/toast rendering does not consistently show `code`, `requestId`, and `details.issues`.

Implement only this package:
1. Harden `apiRequest`:
   - Return `null` for HTTP 204.
   - Return `null` for empty response bodies.
   - Parse JSON only when the content type is JSON.
   - For non-JSON successful responses, return the text body or `{ text }` consistently.
   - For non-JSON failed responses, throw a normalized error with `status`, `code`, `message`, `requestId`, `details`, and `issues`.
   - If JSON parsing fails, throw a normalized client error such as `RESPONSE_PARSE_ERROR`; do not mislabel it as `NETWORK_ERROR`.
   - Continue reading Zod issues from `data.details?.issues`.
2. Add a small safe DOM helper for rendering API errors:
   - Show `code`, `message`, optional `requestId`, and optional `details.issues`.
   - Use `textContent` / DOM nodes. Do not inject backend text with `innerHTML`.
3. Improve `showToast` or add a companion helper so long error messages and issue lists are readable.
4. Replace any admin JS `innerHTML` usage that is easy and safe to replace in this prompt, especially empty-state templates. Static developer-owned HTML can remain only if replacing it would expand scope too much.
5. Do not touch playground success rendering, job monitor polling, health dashboard mapping, or editor payload diff in this prompt. Those have their own follow-up prompts.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "/rag/query|/rag/retrieve" admin
rg -n "data\\.issues" admin/admin.js

Manual tests to report:
1. Open http://localhost:3010/admin/.
2. Trigger a collection load failure if possible and verify code/message/requestId/issues are readable.
3. Verify normal collection loading still works.
4. Verify no legacy endpoint strings are introduced.

Final response format:
- Changed files
- API/error behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 11 - Editor PATCH Payload Diff ve Description Clear

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 11 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not edit backend schemas or backend routers.
- Do not add endpoints.
- Preserve createCollectionSchema and updateCollectionSchema compatibility.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - src/http/adminRouter.ts
  - src/http/errors.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 03 partially complete.
- Current update payload sends all non-empty fields instead of only changed fields.
- Current update payload sends `description: null` whenever the field is empty, even if the original value was empty or unknown.

Implement only this package:
1. Store an initial editor snapshot when `setupEditorTab(col)` fills the form.
   - Include editable fields: displayName, description, sourcePath, ozelgeDataPath, distanceMetric, chunkSize, chunkOverlap, retrievalK, retrievalDistanceThreshold, embeddingModel, chatModel.
   - Use normalized comparable values so `0` remains distinct from empty.
2. Keep create payload behavior:
   - `displayName` required.
   - Empty optional text fields omitted.
   - Valid numeric `0` values preserved where schema allows them.
3. Fix update payload behavior:
   - Send only fields that actually changed from the initial snapshot.
   - Send `description: null` only when an existing non-empty description is intentionally cleared.
   - If original description was empty/missing and current description is empty, omit description.
   - Do not send empty strings, `undefined`, `NaN`, or unknown keys.
4. If update mode has no changes, do not call PATCH. Show a short info toast and keep the inspector open.
5. Keep current client-side validation rules:
   - positive integer chunkSize and retrievalK
   - nonnegative integer chunkOverlap
   - nonnegative number retrievalDistanceThreshold
   - chunkOverlap < chunkSize when both are present
   - distanceMetric in `l2`, `cosine`, `ip`
6. Keep backend issue rendering from `details.issues`.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Create collection with only displayName sends only displayName.
2. Update without changing any field sends no PATCH and shows an info toast.
3. Change only retrievalDistanceThreshold to 0 and verify payload preserves 0.
4. Change only chunkOverlap to 0 and verify payload preserves 0.
5. Clear an existing non-empty description and verify payload sends `description: null`.
6. Save an originally empty description unchanged and verify description is omitted.

Final response format:
- Changed files
- Payload diff behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 12 - Readiness ve Playground Capability State Stabilizasyonu

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 12 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not add or change backend endpoints.
- Do not expect collection readiness to return a `blockers` array.
- Do not implement playground success/error rendering in this prompt; Prompt 13 owns that.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - src/http/ragRouter.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 04 partially complete.
- Mode buttons can keep disabled styling after becoming enabled.
- `#btnPgRun` is not capability-driven.
- `state.selectedReadiness` can stay stale after create mode, collection change, or readiness fetch failure.

Implement only this package:
1. Add a small reset helper for readiness/playground state:
   - Clear `state.selectedReadiness` when opening create mode.
   - Clear or reset readiness UI before fetching a different collection.
   - Clear playground result to a neutral placeholder when changing selected collection.
2. Avoid duplicate readiness fetches:
   - Opening an existing collection should fetch readiness once.
   - Selecting the Readiness tab should fetch readiness if needed or explicitly refresh when selected.
3. Improve `updatePlaygroundCapabilityState()`:
   - Update retrieve/query mode buttons.
   - Remove disabled visual classes when re-enabling.
   - Add `title` or visible helper reason when disabled.
   - Update `#btnPgRun` disabled/title state for the current mode.
4. On playground mode switch:
   - Update `state.playgroundMode`.
   - Update active mode styles.
   - Re-run capability state so `#btnPgRun` matches the selected mode.
5. On readiness fetch failure:
   - Keep inspector open.
   - Show the error inside the readiness tab.
   - Clear `state.selectedReadiness`.
   - Disable playground run with a clear reason.
6. If readiness contains `activeJob`, merge it into known jobs with the selected collection id/name.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Open an unindexed collection and verify Retrieve/Query mode buttons and Run are disabled with a reason.
2. Open a ready collection after an unready one and verify disabled styling is removed.
3. Switch retrieve/query modes and verify Run button state follows capabilities.
4. Open New Collection and verify old readiness/playground state is gone.
5. Force readiness failure if possible and verify stale readiness is not used.

Final response format:
- Changed files
- Readiness/capability state behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 13 - Playground Retrieve/Query Render Tamamlama

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 13 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not change RAG endpoints.
- Do not send requests if question is empty.
- Use readiness capabilities before enabling or running retrieve/query.
- Render backend text with `textContent` or safe DOM nodes, not raw `innerHTML`.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - src/http/ragRouter.ts
  - src/rag.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 05 incomplete.
- `runPlayground()` calls `renderRetrieveResult`, `renderQueryResult`, and `renderPlaygroundError`, but these functions are not defined.

Use existing endpoints:
POST /v1/rag/collections/:collectionId/retrieve
Body: { "question": string, "k"?: number }

POST /v1/rag/collections/:collectionId/query
Body: { "question": string }

Implement only this package:
1. Define `renderSourceFields(source)` or equivalent:
   - Show sourcePath, sourceType, chunkIndex, ozelgeId, sayi, tarih, konu, distanceScore, and content preview when present.
   - Use safe DOM nodes.
   - Long content should wrap and not break layout.
2. Define `renderRetrieveResult(data)`:
   - Show question, k, sourceCount, distanceScoreThreshold, collectionDisplayName, activeVersion.
   - Show a readable sources list.
   - Optional: include raw JSON in a collapsed `<details>` element using textContent.
3. Define `renderQueryResult(data)`:
   - Show answer prominently.
   - Show distanceScoreThreshold, collectionDisplayName, activeVersion.
   - Show sources/citations list.
   - Optional: include raw JSON in a collapsed `<details>` element using textContent.
4. Define `renderPlaygroundError(error)`:
   - Show code, message, requestId, and details when present.
   - Friendly messages for:
     - NO_RELEVANT_CONTEXT
     - ANSWER_NOT_IN_RETRIEVED_CONTEXT
     - COLLECTION_INDEXING
     - COLLECTION_NOT_READY
     - MODEL_BACKPRESSURE
     - RATE_LIMIT_EXCEEDED
     - EMPTY_MODEL_RESPONSE
     - DISALLOWED_FALLBACK_ANSWER
5. Ensure `runPlayground()`:
   - Trims question for validation.
   - Sends retrieve body `{ question, k? }` and query body `{ question }`.
   - Does not include `k` when there is no k input/value.
   - Restores button loading state in `finally`.
6. After implementation, verify no referenced render function is undefined.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "renderRetrieveResult|renderQueryResult|renderPlaygroundError|renderSourceFields" admin/admin.js

Manual tests to report:
1. Ready collection + Retrieve question shows metadata and source list.
2. Ready collection + Query question shows answer and sources.
3. Empty question makes no API request.
4. No-context/RAG error shows friendly error panel, not a runtime ReferenceError.

Final response format:
- Changed files
- Playground render behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 14 - Job Monitor Polling Contract Fix

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 14 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not add GET /v1/admin/jobs.
- Do not add or change backend endpoints.
- The backend has no job listing endpoint.
- The Job Monitor may only track jobs observed by this browser/admin session.
- Do not change Job Monitor table layout in this prompt unless a tiny adjustment is required. Prompt 15 owns render completeness.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - src/http/adminRouter.ts
  - src/collections/types.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 06 partially complete.
- `loadJobs()` polls `GET /v1/admin/jobs/:jobId`, but reads `data.status` instead of `data.job.status`.
- `deleteCollection()` accidentally contains a duplicate job-table rendering block.

Use existing endpoints:
POST /v1/admin/collections/:collectionId/reindex
GET /v1/admin/jobs/:jobId
POST /v1/admin/jobs/:jobId/cancel

Implement only this package:
1. Remove the accidental duplicate job-rendering block inside `deleteCollection()`.
   - `deleteCollection()` should only delete, toast, reload collections, close inspector, and reset button loading.
2. Fix `loadJobs()` to read the actual response shape:
   - `const job = data?.job`
   - Merge `job.status`, `targetPhysicalCollection`, `targetVersion`, `targetEmbeddingModel`, `startedAt`, `finishedAt`, `error`, `documentCount`, `chunkCount`, `createdAt`, `updatedAt`.
3. Fix `rememberJob(job, collection)`:
   - Merge new fields into existing known job instead of replacing useful existing fields with nulls.
   - Store `collectionId` from `job.collectionId` first, then fallback to selected collection id.
   - Store collection display name snapshot when available.
   - Preserve valid zero counts using `??`, not `||`.
4. Handle polling 404:
   - Mark local job as `notFound` or attach a local error message, or keep it removable.
   - Do not silently make the UI look fresh if the job is inaccessible.
5. Improve `cancelJob(jobId)` behavior:
   - POST cancel endpoint.
   - Reload jobs.
   - Reload collections.
   - If selected collection is open, refresh readiness.
6. Improve `reindexCollection()` error behavior for `409 COLLECTION_INDEX_ALREADY_RUNNING`:
   - Show a specific message.
   - Refresh readiness and jobs if possible.
7. Keep real statuses only:
   - queued
   - running
   - succeeded
   - failed
   - cancelled
   - If you add a local-only inaccessible/notFound marker, make it visually distinct and do not confuse it with backend status.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "data\\.status|data\\.updatedAt|data\\.finishedAt|data\\.chunkCount|data\\.documentCount" admin/admin.js

Manual tests to report:
1. Start re-index and verify the job is remembered.
2. Poll a known job and verify status updates from `data.job.status`.
3. Verify target physical collection/version are stored in localStorage.
4. Cancel queued/running job and verify jobs, collections, and readiness reload.
5. Duplicate re-index during active job shows a specific 409 message.

Final response format:
- Changed files
- Job polling/state behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 15 - Job Monitor Rendering Completeness

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 15 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not add GET /v1/admin/jobs.
- Do not add or change backend endpoints.
- The Job Monitor may only track jobs observed by this browser/admin session.
- Do not show fake deterministic progress.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css
  - src/collections/types.ts

Why this prompt exists:
- Prompt 14 fixes polling/state contract.
- The 2026-06-24 audit found the Job Monitor UI still does not show all planned job information.

Implement only this package:
1. Update `admin/index.html` job table header if needed.
2. Ensure the jobs table is horizontally scrollable on small screens.
   - Use the existing `.table-responsive` CSS class or an equivalent wrapper.
3. Update `renderJobs()` to show:
   - short job id in monospace with full id in `title`
   - collection display name and collection id when available
   - status badge
   - target version
   - target physical collection
   - target embedding model when available
   - document count and chunk count, preserving 0
   - created, updated, started, and finished times when available
   - failed/error or local inaccessible message when available
   - actions
4. Actions:
   - Cancel only for `queued` or `running`.
   - Refresh single job if small and safe, otherwise refresh all known jobs.
   - Remove from local monitor for terminal or inaccessible jobs.
   - Buttons must have `type="button"`, clear text or `aria-label`, and title where useful.
5. Empty state must clearly say:
   - "This monitor tracks jobs observed by this browser/admin session."
6. Use safe DOM nodes for all job data.
   - No backend text via `innerHTML`.
7. Do not implement fake percent/progress bars. Use status/timestamps/activity text only.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build

Manual tests to report:
1. Empty Job Monitor shows the browser-session limitation text.
2. Re-index job appears with target physical collection/version.
3. Counts and timestamps render when present.
4. Failed job shows error text without breaking layout.
5. Mobile viewport can scroll the table horizontally.

Final response format:
- Changed files
- Job rendering behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 16 - System Health Dashboard Contract Fix

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 16 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not change /health or /ready backend behavior.
- Do not use /ready?strict=true for dashboard fetches.
- Prevent overlapping health polling requests.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - src/app.ts

Why this prompt exists:
- The 2026-06-24 audit found Prompt 07 partially complete.
- Details fetch failure currently prevents summary rendering.
- `/ready?details=true` fields are partially mapped incorrectly.

Use existing endpoints:
GET /health
GET /ready
GET /ready?details=true

Implement only this package:
1. Refactor `loadHealth()` so summary can render even if details fetch fails.
   - Use independent try/catch or `Promise.allSettled`.
   - Keep overlapping request guard.
   - Do not use strict mode.
2. Render process health summary:
   - status
   - alive
   - uptimeSec
   - timestamp
   - port
3. Render readiness summary:
   - status
   - ready
   - systemReadyFor
   - overallSummary
   - queryReady
   - indexReady
   - querySummary
   - indexSummary
4. Render dependencies correctly from actual response fields:
   - summary `/ready` has dependencies with `ok` booleans.
   - details `/ready?details=true` has dependencies with `ok`, latency, url/model/details/error fields.
   - Do not expect `deps.registry.status` unless it actually exists.
5. Render details correctly:
   - recommendedActions
   - blockers
   - warnings
   - checks with `code`, `name`, `status` (`pass`, `warn`, `fail`), `capabilities`, `message`, and details/latency when present.
   - dataSource: path, ok/error, details such as counts/unsupported files when present.
   - config info from top-level details fields: `chatModel`, `embeddingModel`, `chromaUrl`, `port`.
6. Empty states:
   - No recommended actions
   - No blockers
   - No warnings
   - No checks/details available
7. Use safe DOM nodes for all backend text.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "strict=true" admin/admin.js

Manual tests to report:
1. Health view renders process/readiness/dependency cards.
2. If details fetch fails, process/readiness summary still renders.
3. Healthy dependencies show OK using `ok: true`.
4. Degraded dependencies show blocker/warning/action details.
5. Checks with `pass`, `warn`, and `fail` statuses show correct colors.

Final response format:
- Changed files
- Health dashboard contract behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 17 - UX, Accessibility ve Responsive Tamamlama

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 17 from notes/adminpanel_prompts.md.

Hard rules:
- Only edit files under admin/.
- Do not change backend endpoints.
- Do not do a full redesign.
- Keep existing ids/classes used by admin/admin.js.
- Keep the app operational.
- Before editing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css

Why this prompt exists:
- The 2026-06-24 audit found Prompt 08 partially complete.
- Some CSS helpers are defined but not used.
- Many buttons still lack `type`, `title`, or `aria-label`.
- Polling cleanup/page visibility behavior was not implemented.

Implement only this package:
1. Add correct `type` attributes to static buttons:
   - refresh
   - create collection
   - tab buttons
   - playground mode buttons
   - run test
   - reindex
   - delete
   - close/cancel/save should remain correct
2. Add `title` or `aria-label` where useful:
   - icon-only refresh
   - close inspector
   - dynamic job actions if not already done by Prompt 15
3. Apply responsive wrappers/classes:
   - Jobs table should use `.table-responsive` or equivalent.
   - Long paths/model names/job ids should wrap or truncate predictably.
   - Inspector remains full width on mobile and constrained on desktop.
4. Improve disabled button reasons:
   - Disabled run/retrieve/query/reindex/delete buttons should have a title or nearby visible helper text explaining why.
5. Toast layout:
   - Long messages and issue lists should wrap.
   - Toasts should not overflow the viewport on mobile.
6. Polling cleanup:
   - Keep current intervals, but avoid unnecessary work while the document is hidden if small and safe.
   - Do not add complex lifecycle code; a simple visibility guard is enough.
7. Do not alter feature behavior beyond accessibility/responsive/polling cleanup.

Validation commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "/rag/query|/rag/retrieve" admin

Manual tests to report:
1. Desktop: collections, inspector, jobs, health views.
2. Mobile viewport: collections, inspector, jobs, health views.
3. Long job ids/paths/model names do not break layout.
4. Keyboard tab focus is visible.
5. Escape closes inspector.
6. Disabled controls expose a reason via title or visible helper.

Final response format:
- Changed files
- UX/accessibility behavior implemented
- Commands run and results
- Manual test steps and expected results
- Any remaining risk
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```

## Prompt 18 - Final Admin Panel Contract Audit

```text
Repo: C:\Codes\Vanilla Rag Backend

You are a coding agent working in a cold-start session. Your task is ONLY Prompt 18 from notes/adminpanel_prompts.md.

Hard rules:
- Do not implement new features unless a tiny admin-only fix is required to pass the audit.
- Do not edit backend files.
- Do not revert unrelated changes.
- If backend files have changed, report it clearly; do not undo user changes without permission.
- Before auditing, read:
  - notes/adminpanel_plan.md
  - notes/adminpanel_done.md
  - notes/adminpanel_prompts.md
  - admin/index.html
  - admin/admin.js
  - admin/admin.css
  - src/http/adminRouter.ts
  - src/http/ragRouter.ts
  - src/app.ts

Audit requirements:
1. Verify only admin files and notes logs/prompts were changed for admin-panel work.
2. Verify no backend endpoint/schema/test file was modified as part of admin-only work.
3. Verify no legacy endpoint strings are used in admin:
   - /rag/query
   - /rag/retrieve
4. Verify API URLs match existing backend contracts.
5. Verify error issues are read from `details.issues`.
6. Verify job statuses match backend:
   - queued
   - running
   - succeeded
   - failed
   - cancelled
7. Verify `GET /v1/admin/jobs/:jobId` response is read from `data.job`.
8. Verify readiness code does not expect collection readiness to return a `blockers` array.
9. Verify Job Monitor explains the backend limitation: no job list endpoint, only observed jobs.
10. Verify create/update payloads do not send empty strings, NaN, or unknown keys.
11. Verify PATCH update sends only changed fields.
12. Verify playground render functions are defined:
   - renderRetrieveResult
   - renderQueryResult
   - renderPlaygroundError
13. Verify `/health`, `/ready`, and `/ready?details=true` dashboard mapping matches `src/app.ts`.
14. Verify details fetch failure does not suppress summary health cards.
15. Verify dynamic backend text is rendered with safe DOM APIs.

Commands to run:
node --check admin/admin.js
npm.cmd run build
rg -n "/rag/query|/rag/retrieve" admin
rg -n "renderRetrieveResult|renderQueryResult|renderPlaygroundError" admin/admin.js
rg -n "data\\.job|data\\.status|data\\.updatedAt|data\\.chunkCount|data\\.documentCount" admin/admin.js
git diff -- admin notes/adminpanel_done.md notes/adminpanel_prompts.md
git status --short

Optional if risk is high:
npm.cmd test

Manual test scenario summary to provide:
1. Open http://localhost:3010/admin/
2. Collection list or empty state appears.
3. Create collection with displayName only.
4. Edit only one setting and verify PATCH contains only that changed field.
5. Clear an existing description and verify `description: null`.
6. Open readiness for unindexed collection and verify derived blockers.
7. Start re-index and observe job monitor polling via known job id.
8. Cancel queued/running job if available.
9. Run retrieve/query on a ready collection.
10. Open health dashboard in healthy and degraded states.
11. Trigger or observe an API error and verify code/message/requestId/issues rendering.

Final response format:
- Audit result
- Changed files
- Commands run and results
- Manual test checklist
- Residual risks
- Explicit confirmation whether backend files were untouched
- Before final response, append a matching entry to `notes/adminpanel_done.md` using the required format and this prompt title.
```
