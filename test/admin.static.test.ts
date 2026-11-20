import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

async function readAdminFile(fileName: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), "admin", fileName), "utf8");
}

/** Every panel script (admin/js/**), joined, so the contract checks see the whole client. */
async function readAdminScripts(): Promise<string> {
  const root = path.resolve(process.cwd(), "admin", "js");
  const entries = await fs.readdir(root, { recursive: true });
  const files = entries.filter((entry) => entry.endsWith(".js")).sort();
  const sources = await Promise.all(files.map((file) => fs.readFile(path.join(root, file), "utf8")));
  return sources.join("\n");
}

describe("admin panel static contract", () => {
  it("uses only the versioned collection endpoints and no unsafe HTML injection", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(!html.includes("/rag/query"));
    assert.ok(!html.includes("/rag/retrieve"));
    assert.ok(!js.includes("/rag/query"));
    assert.ok(!js.includes("/rag/retrieve"));
    assert.ok(js.includes('rag: "/v1/rag"'));
    assert.ok(js.includes('admin: "/v1/admin"'));
    assert.ok(!js.includes(".innerHTML"));
  });

  it("manages documents through the files API in a Documents tab", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    // The panel is a client of the files API, like any other API client.
    assert.ok(html.includes('data-tab="files"'));
    assert.ok(html.includes('id="tab-files"'));
    assert.ok(html.includes('id="filesInput" type="file" multiple'));
    assert.ok(js.includes("`${API.admin}/collections/${id}/files`"));
    assert.ok(js.includes('adminMutationRequest(adminCollectionFilesUrl(collection.id), { method: "POST", body: form })'));
    assert.ok(js.includes('adminMutationRequest(adminCollectionFilesUrl(collection.id, fileName), { method: "DELETE" })'));
    // Uploads collections are created without a sourcePath; a server folder is the advanced option.
    assert.ok(html.includes('name="sourceKind" value="uploads"'));
    assert.ok(js.includes('if (getSelectedSourceKind() === "folder") addIfText(payload, "sourcePath", values.sourcePath);'));
    // What the session may do comes from the server; the panel keeps no role table.
    assert.ok(js.includes("return state.auth.capabilities.includes(capability);"));
    assert.ok(!js.includes('"cancelJob", "manageDocuments"'));
    // Upload limits and file types come from GET /v1/admin/server-info.
    assert.ok(js.includes("const batchSize = state.serverInfo?.uploads?.maxFilesPerRequest || files.length;"));
    assert.ok(!js.includes("MAX_FILES_PER_UPLOAD"));
    assert.ok(!html.includes('accept=".txt'));
    // The external embedding provider is only selectable once the server has a service configured.
    assert.ok(js.includes("function syncExternalProviderOption()"));
    assert.ok(js.includes("Add one under Embedding services in the left menu"));
  });

  it("manages embedding services through the embedding services API in their own view", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(html.includes('data-view="embedding-services"'));
    assert.ok(html.includes('id="view-embedding-services"'));
    assert.ok(html.includes('id="editEmbeddingService"'));
    assert.ok(html.includes('id="esApiKey" autocomplete="new-password"'));
    // The panel is a client of the API: list, test, create/update/delete with action tokens. Embedding and
    // chat services share the same view code over the same API contract.
    assert.ok(js.includes("const base = `${API.admin}/embedding-services`;"));
    assert.ok(js.includes("url: embeddingServicesUrl,"));
    assert.ok(js.includes('apiRequest(`${view.url()}/test`, { method: "POST", body: JSON.stringify(body) })'));
    assert.ok(js.includes('await adminMutationRequest(id ? view.url(id) : view.url(), {'));
    assert.ok(js.includes('await adminMutationRequest(view.url(service.id), { method: "DELETE" });'));
    // Only admins manage services: the capability comes with the session; the warning comes from the API response.
    assert.ok(js.includes('capability: "manageEmbeddingServices",'));
    // Service presets come from GET /v1/admin/server-info.
    assert.ok(js.includes("findServicePreset("));
    assert.ok(!js.includes("SERVICE_PRESETS"));
    assert.ok(js.includes("services.warnings = Array.isArray(data?.warnings) ? data.warnings : [];"));
    // Collections send the chosen service; the model list comes from that service.
    assert.ok(js.includes('addIfText(payload, "embeddingServiceId", values.embeddingServiceId)'));
    assert.ok(!js.includes("modelDiscovery.external"));
    // The default service is the server's choice: "Default" sends no id; its name comes from the API.
    assert.ok(js.includes("Default (the server chooses: ${defaultName})"));
    assert.ok(js.includes('defaultServiceId: typeof data?.defaultEmbeddingServiceId === "string" ? data.defaultEmbeddingServiceId : null,'));
    assert.ok(!js.includes("services[0]?.id || \"\";"));
  });

  it("manages chat services and the tenant's chat choice through the API in their own view", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(html.includes('data-view="chat-services"'));
    assert.ok(html.includes('id="view-chat-services"'));
    assert.ok(html.includes('id="csApiKey" autocomplete="new-password"'));
    assert.ok(html.includes('id="csSettingsService"'));
    assert.ok(html.includes('id="csSettingsModel"'));
    // Chat services use the shared view code; the choice is read, saved and reset only through the API.
    assert.ok(js.includes("const base = `${API.admin}/chat-services`;"));
    assert.ok(js.includes("url: chatServicesUrl,"));
    assert.ok(js.includes('capability: "manageChatServices",'));
    assert.ok(js.includes("return `${API.admin}/chat-settings`;"));
    assert.ok(js.includes('adminMutationRequest(chatSettingsUrl(), { method: "PUT", body: JSON.stringify({ serviceId, model }) })'));
    assert.ok(js.includes('adminMutationRequest(chatSettingsUrl(), { method: "DELETE" })'));
    // Model suggestions come from GET /v1/admin/models chatServices; the collection form shows the choice.
    assert.ok(js.includes("chatServices: normalizeServiceModels(data?.chatServices),"));
    assert.ok(js.includes("describeChatSettings(state.chatSettings.data)"));
  });

  it("loads full editable settings through the admin collection detail endpoint", async () => {
    const js = await readAdminScripts();

    assert.ok(js.includes("function loadAdminCollectionDetail(collectionId)"));
    assert.ok(js.includes("apiRequest(adminCollectionUrl(collectionId))"));
    assert.ok(js.includes("setupEditorTab(merged)"));
    assert.ok(js.includes("mergeCollectionIntoState(detail)"));
  });

  it("includes the admin auth shell, session bootstrap, and protected mutation helpers", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(html.includes('id="authShell"'));
    assert.ok(html.includes('id="authLoginForm"'));
    assert.ok(html.includes('id="authUsername"'));
    assert.ok(html.includes('id="authPassword"'));
    assert.ok(html.includes('id="authLoginButton"'));
    assert.ok(html.includes('id="authLogoutButton"'));
    assert.ok(html.includes('id="authSessionSummary"'));
    assert.ok(html.includes('id="authBadge"'), "the role shows in the header badge");
    assert.ok(html.includes('id="authSessionTenant"'));
    assert.ok(html.includes('id="authSessionExpiry"'));
    assert.ok(js.includes("function adminAuthSessionUrl()"));
    assert.ok(js.includes("function adminAuthLoginUrl()"));
    assert.ok(js.includes("function adminAuthLogoutUrl()"));
    assert.ok(js.includes("async function loadAdminSession()"));
    assert.ok(js.includes("async function loginAdmin(event)"));
    assert.ok(js.includes("async function logoutAdmin()"));
    assert.ok(js.includes("function syncAuthChrome()"));
    assert.ok(js.includes("async function requestAdminActionToken(method, path)"));
    assert.ok(js.includes("async function adminMutationRequest(url, options = {})"));
    assert.ok(js.includes('headers["x-admin-action-token"] = token;'));
  });

  it("shows clearer indexing language on collection cards while keeping reindex actions in the inspector", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(js.includes("function getCollectionCardStatusPresentation(status, indexState = null)"));
    assert.ok(js.includes("function getCollectionCardStatusBadge(status, indexState = null)"));
    assert.ok(js.includes("function getCollectionCardStatusNote(status, indexState = null)"));
    // Card statuses in plain words.
    assert.ok(js.includes('label: "Not indexed yet"'));
    assert.ok(js.includes('label: "Re-index needed"'));
    assert.ok(js.includes("Add documents, then re-index to make it searchable."));
    assert.ok(js.includes("Open it to see the error."));
    assert.ok(js.includes("getCollectionCardStatusBadge(collection.status, collection.indexState)"));
    assert.ok(js.includes("getCollectionCardStatusNote(collection.status, collection.indexState)"));
    assert.ok(html.includes('id="collectionIndexState"'));
    assert.ok(html.includes('id="collectionIndexStateSummary"'));
    assert.ok(html.includes('id="collectionIndexStateContent"'));
    assert.ok(html.includes('id="btnReindex"'));
    assert.ok(html.includes("Re-index Collection"));
  });

  it("uses backend validation endpoints before save and re-index actions", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(html.includes('id="configDefaultsPanel"'));
    assert.ok(html.includes('id="configDefaultsSummary"'));
    assert.ok(html.includes('id="configDefaultsStatus"'));
    assert.ok(html.includes('data-default-for="sourcePath"'));
    assert.ok(html.includes('data-default-for="distanceMetric"'));
    assert.ok(html.includes('data-default-for="embeddingModel"'));
    assert.ok(js.includes('function loadConfigDefaults()'));
    assert.ok(js.includes('function syncConfigDefaultsPanel()'));
    assert.ok(js.includes('`${API.admin}/config/defaults`'));
    assert.ok(!js.includes('elements.editDistanceMetric.value = "l2"'));
    assert.ok(html.includes('id="collectionValidation"'));
    assert.ok(html.includes('id="collectionValidationSummary"'));
    assert.ok(html.includes('id="collectionValidationContent"'));
    assert.ok(html.includes('id="modelDiscoveryPanel"'));
    assert.ok(html.includes('id="modelDiscoverySummary"'));
    assert.ok(html.includes('id="modelDiscoveryStatus"'));
    assert.ok(html.includes('id="embeddingModelSelect"'));
    // The chat LLM is global and optional: shown read-only, never chosen per collection.
    assert.ok(html.includes('id="chatLlmStatus"'));
    assert.ok(!html.includes('id="chatModelSelect"'));
    assert.ok(!html.includes('id="editChatModel"'));
    assert.ok(!js.includes('addIfText(payload, "chatModel"'));
    assert.ok(js.includes("CHAT_NOT_CONFIGURED"));
    assert.ok(js.includes('function adminCollectionValidateUrl(id)'));
    assert.ok(js.includes('function validateCollectionOnServer(mode, collectionId, payload = buildCollectionPayload(mode))'));
    assert.ok(js.includes('adminCollectionValidateUrl()'));
    assert.ok(js.includes('adminCollectionValidateUrl(collectionId)'));
    assert.ok(js.includes('renderCollectionValidation(validation, getValidationTitle(mode))'));
    assert.ok(js.includes('renderCollectionValidation(validation, "Re-index validation")'));
    assert.ok(js.includes("function renderValidationImpact(parent, impact)"));
    assert.ok(js.includes('async function loadModelDiscovery()'));
    assert.ok(js.includes('function syncModelDiscoveryPanel()'));
    // Model suggestions are a datalist on the model field, not a separate list.
    assert.ok(js.includes('function syncModelSelect(kind)'));
    assert.ok(js.includes('`${API.admin}/models`'));
    assert.ok(js.includes("Change Impact"));
    assert.ok(js.includes("Re-index required"));
    assert.ok(js.includes("Takes effect immediately"));
    assert.ok(js.includes("function isDependencyBlocker(issue)"));
    assert.ok(js.includes('"A service is not available"'));
    assert.ok(js.includes("function renderCollectionIndexStateBanner()"));
    // The status box shows only when something needs attention; saved vs indexed settings live in Settings.
    assert.ok(js.includes('elements.collectionIndexState.classList.add("hidden");'));
    // Re-index needed lists each changed setting with the value in the index and the saved one.
    assert.ok(js.includes("export function describeIndexedValue(field, value)"));
    assert.ok(!html.includes('id="indexedSettings"'));
    assert.ok(js.includes("collectionIndexState"));
    assert.ok(js.includes("return apiRequest(url, {"));
    assert.ok(!js.includes("return adminMutationRequest(url, {"));
  });

  it("uses session-derived rag headers and keeps validation requests token-free", async () => {
    const js = await readAdminScripts();

    assert.ok(js.includes("function isRagRequest(url)"));
    assert.ok(js.includes("function getSessionHeadersForRequest(url)"));
    assert.ok(js.includes('"x-tenant-id": state.auth.session.tenantId'));
    assert.ok(js.includes('"x-user-id": state.auth.session.username'));
    assert.ok(js.includes("if (!state.auth.session || !isRagRequest(url))"));
    assert.ok(js.includes('const url = mode === "create" ? adminCollectionValidateUrl() : adminCollectionValidateUrl(collectionId);'));
    assert.ok(js.includes("return apiRequest(url, {"));
    assert.ok(js.includes("await adminMutationRequest(`${API.admin}/collections`, { method: \"POST\", body: JSON.stringify(payload) });"));
    assert.ok(js.includes("await adminMutationRequest(adminCollectionUrl(id), { method: \"PATCH\", body: JSON.stringify(payload) });"));
    assert.ok(js.includes("await adminMutationRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: \"POST\" });"));
  });

  it("keeps admin DOM id references aligned with index.html", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const directIds = [...js.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    const editFieldBlock = js.match(/const EDIT_FIELD_IDS = \{([\s\S]*?)\};/);
    assert.ok(editFieldBlock, "EDIT_FIELD_IDS should be present");
    const editFieldIds = [...editFieldBlock[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);

    for (const id of [...directIds, ...editFieldIds]) {
      assert.ok(htmlIds.has(id), `admin/index.html is missing id="${id}" referenced by admin/js`);
    }
  });

  it("keeps job, readiness and health contracts aligned with backend response shapes", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(js.includes("data?.job"), "Job polling should read the data.job wrapper");
    assert.ok(!js.includes("data.status"), "Job polling should not read bare data.status");
    assert.ok(!js.includes("data.updatedAt"), "Job polling should not read bare data.updatedAt");
    assert.ok(!js.includes("data.chunkCount"), "Job polling should not read bare data.chunkCount");
    assert.ok(!js.includes("data.documentCount"), "Job polling should not read bare data.documentCount");
    assert.ok(!js.includes("completed"), "Admin UI should not expect a completed job status");
    assert.ok(!js.includes("deriveReadinessBlockers"), "Collection readiness blockers should come from backend issues");
    assert.ok(js.includes("readiness.blockers"), "Collection readiness should render backend blockers");
    assert.ok(js.includes("readiness.warnings"), "Collection readiness should render backend warnings");
    assert.ok(js.includes("item.recommendedAction"), "Readiness issue rendering should surface backend recommended actions");
    assert.ok(js.includes("operationalAlerts"), "Health dashboard should render operational alerts from backend");
    assert.ok(js.includes("operations"), "Health dashboard should render aggregate operations summary from backend");
    assert.ok(js.includes("cleanupBacklog"), "Health dashboard should surface cleanup backlog metrics");
    assert.ok(js.includes("Loading system health..."), "Health dashboard should show an initial loading state");
    assert.ok(js.includes("Refreshing system health..."), "Health dashboard should keep the last snapshot visible during refresh");
    assert.ok(js.includes("Loading system health details..."), "Health detail panel should show loading feedback");
    assert.ok(js.includes("const hasSnapshot = Boolean(state.selectedReadiness);"), "Readiness refresh should preserve the last known snapshot during refresh");
    assert.ok(js.includes("if (!quiet) setReadinessRefreshNotice(\"Refreshing readiness...\""), "A refresh the user asked for shows a non-blocking notice; background refreshes show none");
    assert.ok(js.includes("if (!quiet || JSON.stringify(readinessResult.value) !== previousReadiness) renderReadinessData"), "Background refreshes redraw readiness only when it changed");
    assert.ok(!js.includes("if (state.isLoading.readiness) return { enabled: false, reason: \"Readiness is loading.\" };"), "Playground capability should not be disabled just because readiness is refreshing");
    assert.ok(!js.includes("strict=true"), "Health dashboard should not use ready?strict=true");
    assert.ok(js.includes("Promise.allSettled"), "Health dashboard should preserve summaries if details fail");
    assert.ok(html.includes('id="physicalCollectionsSection"'));
    assert.ok(html.includes('id="physicalCollectionsSummary"'));
    assert.ok(html.includes('id="physicalCollectionsActions"'));
    assert.ok(html.includes('id="physicalCollectionsList"'));
    assert.ok(js.includes("healthCleanupSummary"));
    assert.ok(js.includes("function adminCollectionPhysicalCollectionsUrl(id)"));
    assert.ok(js.includes("data?.physicalCollections"), "Physical collection lifecycle should read the data.physicalCollections wrapper");
    assert.ok(js.includes("Could not load the index versions"));
    // User-facing text names no API paths, environment variables or CLI commands.
    for (const jargon of ["Loading GET /v1/", "npm run onboard", "Physical Collection Lifecycle", "Seeded from", "HNSW Space"]) {
      assert.ok(!js.includes(jargon) && !html.includes(jargon), `no "${jargon}" in the panel`);
    }
    assert.ok(js.includes("View cleanup backlog"));
    assert.ok(html.includes('data-view="audit"'));
    assert.ok(html.includes('id="view-audit"'));
    assert.ok(html.includes('id="auditCollectionPicker"'));
    assert.ok(html.includes('id="auditCollectionToggle"'));
    assert.ok(html.includes('id="auditCollectionSummary"'));
    assert.ok(html.includes('id="auditCollectionPanel"'));
    assert.ok(html.includes('id="auditCollectionSearch"'));
    assert.ok(html.includes('id="auditCollectionAll"'));
    assert.ok(html.includes('id="auditCollectionClear"'));
    assert.ok(html.includes('id="auditCollectionList"'));
    assert.ok(html.includes('id="auditOperationPicker"'));
    assert.ok(html.includes('id="auditOperationToggle"'));
    assert.ok(html.includes('id="auditOperationSummary"'));
    assert.ok(html.includes('id="auditOperationPanel"'));
    assert.ok(html.includes('id="auditOperationSearch"'));
    assert.ok(html.includes('id="auditOperationAll"'));
    assert.ok(html.includes('id="auditOperationClear"'));
    assert.ok(html.includes('id="auditOperationList"'));
    assert.ok(html.includes('id="auditClearFilters"'));
    assert.ok(html.includes('id="auditRefreshList"'));
    assert.ok(html.includes('id="auditPrevPage"'));
    assert.ok(html.includes('id="auditNextPage"'));
    assert.ok(html.includes('id="auditPageInfo"'));
    assert.ok(html.includes('id="auditLogTableBody"'));
    assert.ok(html.includes('id="btnViewHistory"'));
    assert.ok(html.includes("View history"));
    assert.ok(html.includes("Audit log"));
    assert.ok(js.includes("function adminAuditLogUrl(options = {})"));
    assert.ok(js.includes("data?.auditLog"), "Audit log history should read the data.auditLog wrapper");
    assert.ok(js.includes("openAuditLogForCollection"));
    assert.ok(js.includes("btnViewHistory"));
    assert.ok(js.includes('params.append("collectionId", collectionId);'));
    assert.ok(js.includes('params.append("operation", operation);'));
    assert.ok(html.includes("All visible collections"));
    assert.ok(html.includes("All operations"));
    assert.ok(html.includes("Search collections"));
    assert.ok(html.includes("Search operations"));
    assert.ok(!html.includes('placeholder="Optional collectionId"'));
  });

  it("renders audit log and history shortcuts without unsafe html usage", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminScripts(),
    ]);

    assert.ok(html.includes('id="view-audit"'));
    assert.ok(html.includes('id="auditLogTableBody"'));
    assert.ok(js.includes("createAuditLogRow"));
    assert.ok(js.includes("renderAuditLogTable"));
    assert.ok(js.includes("renderAuditFilterControls"));
    assert.ok(js.includes('renderApiErrorContent(cell, state.auditLogError, "Could not load the audit log", { onRetry: () => refreshAuditLog() });'));
    assert.ok(js.includes('renderApiErrorContent(cell, state.auditLogError, "Could not refresh the audit log", { onRetry: () => refreshAuditLog() });'));
    assert.ok(js.includes("function getAuditLogEmptyMessage()"));
    assert.ok(js.includes("No audit log entries have been recorded since this deployment."));
    assert.ok(js.includes("No audit log entries found for the current filters."));
    assert.ok(js.includes("createAuditDetailsBlock"));
    assert.ok(!js.includes(".innerHTML"));
  });

  it("asks with its own accessible dialog, never window.confirm", async () => {
    const js = await readAdminScripts();
    assert.ok(!/[^.\w]confirm\(/.test(js), "no native confirm() calls");
    assert.ok(js.includes('dialog.setAttribute("aria-modal", "true");'));
    assert.ok(js.includes("requireText: name,"), "deleting a collection asks for its name");
    assert.ok(js.includes("export async function requestCloseInspector()"), "closing with unsaved settings asks first");
  });

  it("is usable with a keyboard and a screen reader", async () => {
    const [html, js] = await Promise.all([readAdminFile("index.html"), readAdminScripts()]);
    assert.ok(html.includes('id="inspectorPanel" role="dialog" aria-modal="true" aria-labelledby="inspectorTitle" inert'));
    assert.ok(js.includes("elements.inspectorPanel.inert = true;"), "a closed inspector leaves the tab order");
    assert.ok(html.includes('role="tablist"') && html.includes('role="tab"') && html.includes('role="tabpanel"'));
    assert.ok(js.includes('button.setAttribute("aria-selected", active ? "true" : "false");'));
    assert.ok(html.includes('<input id="filesInput" type="file" multiple class="sr-only">'), "file upload is reachable with the keyboard");
    assert.ok(html.includes('id="toastContainer" role="status" aria-live="polite"'));
    assert.ok(html.includes('<label for="pgQuestion" class="sr-only">Question</label>'));
    // Every visible field label is tied to its field.
    const labels = [...html.matchAll(/<label class="block[^"]*"(?: for="([^"]+)")?>/g)];
    // (A label with class "block" only wraps its input, which ties them too.)
    assert.ok(labels.length > 0 && labels.every((match) => match[1] || match[0] === '<label class="block">'), "every block label has a for= attribute");
  });

  it("keeps no copies of server rules or lists and links jobs to their details", async () => {
    const [html, js] = await Promise.all([readAdminFile("index.html"), readAdminScripts()]);
    // Collection rules are the server's (POST .../validate); the form only reports fields that are not numbers.
    assert.ok(!js.includes('["l2", "cosine", "ip"]'));
    assert.ok(!js.includes("chunkOverlap must be less than chunkSize."));
    // The dependencies are whatever the server reports.
    assert.ok(!js.includes('["registry", "chroma", "embedding", "chat"]'));
    // A job's steps come from its events; the address names the job and the status filter.
    assert.ok(js.includes("`${API.admin}/jobs/${encodeURIComponent(jobId)}/events`"));
    assert.ok(js.includes('if (parts[0] === "jobs") return { view: "jobs", jobId: parts[1] || null, status: query.get("status") || "all" };'));
    assert.ok(html.includes('id="jobDetail"'));
    // One header action per view, shown only when the session may use it.
    assert.ok(js.includes("const HEADER_ACTIONS = {"));
    assert.ok(html.includes('id="esRoleNote"') && html.includes('id="csRoleNote"'));
    // The server's note about the one-time model download is shown.
    assert.ok(js.includes('findReadinessIssue("EMBEDDING_MODEL_NOT_DOWNLOADED")'));
    // Load errors offer to try again.
    assert.ok(js.includes('{ onRetry: () => loadCollections() }'));
  });

  it("works offline: no CDN, the Tailwind CSS is built locally", async () => {
    const html = await readAdminFile("index.html");
    assert.ok(!html.includes("cdn.tailwindcss.com"));
    assert.ok(html.includes('<link rel="stylesheet" href="/admin/tailwind.css">'));
    // Tailwind must load after admin.css (as the CDN injected it), or admin.css rules beat utilities like .hidden.
    assert.ok(html.indexOf('href="/admin/tailwind.css"') > html.indexOf('href="/admin/admin.css"'));
    assert.ok(html.includes('<script type="module" src="/admin/js/main.js"></script>'));
    const css = await readAdminFile("tailwind.css");
    assert.ok(css.includes(".translate-x-full"), "admin/tailwind.css is built (npm run build:admin-css)");
  });

  it("contains the planned playground and job monitor controls", async () => {
    const html = await readAdminFile("index.html");
    const js = await readAdminScripts();

    assert.ok(html.includes('id="pgK"'), "Retrieve K input should exist");
    assert.ok(js.includes("No jobs yet. Re-indexing a collection creates one."));
    assert.ok(!js.includes("localStorage"), "jobs come from the server only, never from a browser cache");
    assert.ok(html.includes('id="jobsBulkActionBar"'));
    assert.ok(html.includes('id="jobsBulkSelectionCount"'));
    assert.ok(html.includes('id="jobsBulkRemove"'));
    assert.ok(html.includes('id="jobsSelectAll"'));
    assert.ok(js.includes("function renderRetrieveResult"));
    assert.ok(js.includes("function renderQueryResult"));
    assert.ok(js.includes("function renderPlaygroundError"));
    assert.ok(js.includes("function renderSourceFields"));
    assert.ok(js.includes("function adminJobDeleteUrl(id)"));
    assert.ok(js.includes("function adminJobsBulkDeleteUrl()"));
    assert.ok(js.includes("async function deleteJob(jobId)"));
    assert.ok(js.includes("async function removeSelectedJobs()"));
    assert.ok(html.includes("Remove selected"));
    assert.ok(js.includes("Remove this finished job from the list"));
    assert.ok(js.includes("Remove"));
  });
});
