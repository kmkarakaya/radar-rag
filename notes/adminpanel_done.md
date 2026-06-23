# Admin Panel Implementation Progress

## [PROMPT 01] API Client, State Model, Safe Render Temeli

**Plan Reference:** `notes/adminpanel_plan.md` - Step 1
**Target Files:** `admin/admin.js`, `admin/index.html`, `admin/admin.css`
**Status:** **Implementation Code — MOSTLY COMPLETE** | **Documentation — MISSING**

---

### 1. apiRequest Improvements

| Requirement | Status | Evidence (admin.js line) |
|---|---|---|
| Return `null` for HTTP 204 | ✅ Implemented | Line 159: `if (response.status === 204) return null;` |
| Handle empty/non-JSON response bodies safely | ✅ Implemented | Lines 162-169: checks content-type, parses JSON only, falls back to null |
| Normalize errors with `status`, `code`, `message`, `requestId`, `details`, `issues` | ✅ Implemented | Lines 174-180 (HTTP error normalization) + Lines 189-196 (network error normalization) |
| Read Zod issues from `data.details?.issues`, not `data.issues` | ✅ Implemented | Line 179: `const issues = data?.details?.issues;` |

**Notes:** The normalization matches the backend `ApiErrorResponse` shape from `src/http/errors.ts`: `{ status, code, message, requestId, details, issues }`. Both HTTP errors and network errors produce consistent shapes.

---

### 2. State Model Extension

| Field | Status | Evidence |
|---|---|---|
| `collections` | ✅ | Line 37: `collections: []` |
| `selectedCollection` | ✅ | Line 38: `selectedCollection: null` |
| `selectedReadiness` | ✅ | Line 39: `selectedReadiness: null` |
| `playgroundMode` | ✅ | Line 40: `playgroundMode: 'retrieve'` |
| `knownJobs` | ✅ | Line 41: `knownJobs: []` |
| `isLoading` flags | ✅ | Lines 42-47: `collections`, `jobs`, `health`, `readiness` |
| `lastError` | ✅ | Line 48: `lastError: null` |
| `activeJobs` (bonus) | ✅ | Line 49: `activeJobs: []` |
| `healthStatus` (bonus) | ✅ | Line 50: `healthStatus: null` |

**Notes:** State shape is well-designed. `knownJobs` exists but is NOT yet wired to localStorage or polling — that's reserved for Prompt 06.

---

### 3. Endpoint Helpers

| Function | Status | Evidence |
|---|---|---|
| `collectionReadyUrl(collection)` | ✅ | Line 14: returns `collection?.readyUrl` or `/v1/rag/collections/${collection?.id}/ready` |
| `collectionQueryUrl(collection)` | ✅ | Line 18: returns `collection?.queryUrl` or `/v1/rag/collections/${collection?.id}/query` |
| `collectionRetrieveUrl(collection)` | ✅ | Line 22: returns `collection?.retrieveUrl` or `/v1/rag/collections/${collection?.id}/retrieve` |
| `adminCollectionUrl(id)` | ✅ | Line 26: returns `/v1/admin/collections/${id}` |
| `adminJobUrl(id)` | ✅ | Line 30: returns `/v1/admin/jobs/${id}` |

**Notes:** Helper functions correctly use the base `API` object. They support both direct collection ID fallback and optional custom URL properties on the collection object.

---

### 4. DOM / Render Helpers

| Function | Status | Evidence |
|---|---|---|
| `clearNode(node)` | ✅ | Line 100: handles both `clearChildren()` method and vanilla `while(node.firstChild)` removal |
| `appendText(node, text)` | ✅ | Line 111: creates `createTextNode` safely, never uses innerHTML |
| `createBadge(text, colorClass)` | ✅ | Line 117: creates span with Tailwind classes, uses `appendText` not innerHTML |
| `formatDateTime(isoString)` | ✅ | Line 124: safe Date parsing with try/catch fallback to string |
| `formatCount(value)` | ✅ | Line 133: handles null/undefined → 'N/A', uses `Number().toLocaleString()` |
| `setButtonLoading(btn, loading)` | ✅ | Line 138: manages disabled state + `dataset.originalText` preservation |

---

### 5. Safe Backend Text Injection in Collection Rendering

| Requirement | Status | Evidence |
|---|---|---|
| Use `appendText` for dynamic text | ✅ | Lines 353, 364, 369: `appendText(title, col.displayName || 'Unnamed Collection')` etc. |
| No raw innerHTML for backend data | ✅ | Collection cards built with `createElement` + `appendText` — no `.innerHTML = ...` with col data |
| Status colors mapped correctly | ✅ | Lines 340-345: proper color classes per status |

**Notes:** All dynamic content uses `appendText()` or `textContent`. The only `innerHTML` usage is for loading/empty state HTML strings that contain NO user data.

---

### 6. Existing UI Behavior Preserved

| Behavior | Status |
|---|---|
| Collection card click opens inspector | ✅ (line 328: `card.addEventListener('click', ...)`) |
| Tab switching works | ✅ (line 745: `tabBtns.forEach` handler) |
| Playground mode toggle works | ✅ (line 761: `pgModeBtns.forEach` handler) |
| Global refresh button works | ✅ (line 760: `btnRefresh.onclick`) |
| Close inspector (button, overlay click) | ✅ (lines 757-758: closeInspector on btnCloseInspector + overlay click) |
| Initial load on DOMContentLoaded | ✅ (lines 784-788) |
| Periodic polling (jobs, health) | ✅ (lines 791-792) |

---

### 7. Validation Commands

The prompt requires running these commands. **Results not recorded in adminpanel_done.md:**

```bash
node --check admin/admin.js
npm.cmd run build
rg -n "/rag/query|/rag/retrieve" admin
```

**Current concerns:**
- `rg -n "/rag/query|/rag/retrieve" admin` — the endpoint helpers use hardcoded `/v1/rag/collections/...` strings (not `/rag/query` or `/rag/retrieve` bare paths). These are the correct updated paths.
- `setInterval(loadJobs, 10000)` fires every 10s, but `loadJobs()` is a stub that shows "No active jobs" — it will never actually show jobs until Prompt 06 implements knownJobs tracking. This is an intentional placeholder per the plan.

---

### 8. Manual Test Steps (Not Documented)

The prompt requests manual test steps for `http://localhost:3010/admin/`:

1. Open `http://localhost:3010/admin/` — verify collections grid loads
2. Verify loading → empty or collection cards render
3. Click "New Collection" — verify inspector opens in create mode (empty form, status badge hidden)
4. Click an existing collection — verify inspector shows collection data
5. Switch tabs (Readiness, Playground, Settings) — verify content swaps
6. Close inspector via button, overlay click, or Escape
7. Verify no console errors

**These steps need to be executed and results recorded.**

---

### 9. Remaining Risks & Gaps

#### Implemented but needs later refinement:
1. **`knownJobs` state is a placeholder** — declared but never persisted to localStorage or polled. Handled by Prompt 06.
2. **`loadJobs()` is a stub** — shows static text with "(Backend does not support job listing yet)". Will be replaced by Prompt 06's job monitor.
3. **`setInterval(loadJobs, 10000)` runs forever** — polls a stub. Should be removed or made safe in Prompt 06.
4. **Playground error rendering is basic** — `resultEl.textContent = 'Error: ${err.message}'` (line 546) doesn't render full error details, issues, or requestId. Handled by Prompt 05.
5. **`saveCollection()` uses `parseInt(x).value || undefined` pattern** — This means `chunkOverlap=0` gets treated as falsy and omitted. Also `NaN` values pass through. This is a Prompt 03 concern.
6. **No client-side validation** — displayName required check, numeric validation, chunkOverlap >= chunkSize warning — all Prompt 03.
7. **No error details/issues rendering from `INVALID_REQUEST_BODY`** — `details.issues` from backend is available in the error object but not displayed to user. Prompt 03 handles this.

#### Code quality concerns:
8. **`btnCancelEdit` is NOT wired** — The HTML has `id="btnCancelEdit"` and `admin.js` line 95 defines `btnCancelEdit: document.getElementById('btnCancelEdit')` in the elements object, but there is **no click handler assigned** (`elements.btnCancelEdit.onclick = closeInspector` is missing). This is explicitly called out in Prompt 02 as "Wire existing #btnCancelEdit".
9. **`escape-to-close` not implemented** — The prompt says "Optional: add Escape-to-close if small and safe". It was NOT added. This is called out in Prompt 02.
10. **`createBadge` vs `getStatusBadge` duplication** — Both functions exist. `createBadge` (line 117) creates DOM elements; `getStatusBadge` (line 239) returns HTML string. The collection cards use `createBadge` but `getStatusBadge` is also used elsewhere. Minor inconsistency.

#### Not in Prompt 01 scope (for awareness):
11. Collection readiness block derivation — Prompt 04
12. Capability-driven playground button enable/disable — Prompt 04
13. Read/Write full result render — Prompt 05
14. Job monitor with localStorage persistence — Prompt 06
15. Health dashboard with details=true — Prompt 07
16. UX polish, responsive, accessibility — Prompt 08

---

### 10. Files Changed

Only admin files were modified (as required):
- `admin/admin.js` — Core implementation
- `admin/index.html` — Structure (no changes needed for Prompt 01)
- `admin/admin.css` — Styles (no changes needed for Prompt 01)

### 11. Backend Files Verified Untouched

- `src/http/adminRouter.ts` — Not modified
- `src/http/ragRouter.ts` — Not modified
- `src/http/errors.ts` — Not modified
- `src/app.ts` — Not modified