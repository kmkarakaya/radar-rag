import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

async function readAdminFile(fileName: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), "admin", fileName), "utf8");
}

describe("admin panel static contract", () => {
  it("uses only the versioned collection endpoints and no unsafe HTML injection", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminFile("admin.js"),
    ]);

    assert.ok(!html.includes("/rag/query"));
    assert.ok(!html.includes("/rag/retrieve"));
    assert.ok(!js.includes("/rag/query"));
    assert.ok(!js.includes("/rag/retrieve"));
    assert.ok(js.includes('rag: "/v1/rag"'));
    assert.ok(js.includes('admin: "/v1/admin"'));
    assert.ok(!js.includes(".innerHTML"));
  });

  it("loads full editable settings through the admin collection detail endpoint", async () => {
    const js = await readAdminFile("admin.js");

    assert.ok(js.includes("function loadAdminCollectionDetail(collectionId)"));
    assert.ok(js.includes("apiRequest(adminCollectionUrl(collectionId))"));
    assert.ok(js.includes("setupEditorTab(merged)"));
    assert.ok(js.includes("mergeCollectionIntoState(detail)"));
  });

  it("includes the admin auth shell, session bootstrap, and protected mutation helpers", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminFile("admin.js"),
    ]);

    assert.ok(html.includes('id="authShell"'));
    assert.ok(html.includes('id="authLoginForm"'));
    assert.ok(html.includes('id="authUsername"'));
    assert.ok(html.includes('id="authPassword"'));
    assert.ok(html.includes('id="authLoginButton"'));
    assert.ok(html.includes('id="authLogoutButton"'));
    assert.ok(html.includes('id="authSessionSummary"'));
    assert.ok(html.includes('id="authSessionRole"'));
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
      readAdminFile("admin.js"),
    ]);

    assert.ok(js.includes("function getCollectionCardStatusPresentation(status, indexState = null)"));
    assert.ok(js.includes("function getCollectionCardStatusBadge(status, indexState = null)"));
    assert.ok(js.includes("function getCollectionCardStatusNote(status, indexState = null)"));
    assert.ok(js.includes("Indexing required"));
    assert.ok(js.includes("Indexing in progress"));
    assert.ok(js.includes("No active index yet. Open details to re-index."));
    assert.ok(js.includes("Open details to inspect the latest error."));
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
      readAdminFile("admin.js"),
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
    assert.ok(js.includes('function setModelFromSelect(kind)'));
    assert.ok(js.includes('`${API.admin}/models`'));
    assert.ok(js.includes("Change Impact"));
    assert.ok(js.includes("Re-index required"));
    assert.ok(js.includes("Takes effect immediately"));
    assert.ok(js.includes("function isDependencyBlocker(issue)"));
    assert.ok(js.includes("DEPENDENCY DOWN"));
    assert.ok(js.includes("Backend dependency down"));
    assert.ok(js.includes("function renderCollectionIndexStateBanner()"));
    assert.ok(js.includes("collectionIndexState"));
    assert.ok(js.includes("return apiRequest(url, {"));
    assert.ok(!js.includes("return adminMutationRequest(url, {"));
  });

  it("uses session-derived rag headers and keeps validation requests token-free", async () => {
    const js = await readAdminFile("admin.js");

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
      readAdminFile("admin.js"),
    ]);

    const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const directIds = [...js.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    const editFieldBlock = js.match(/const EDIT_FIELD_IDS = \{([\s\S]*?)\};/);
    assert.ok(editFieldBlock, "EDIT_FIELD_IDS should be present");
    const editFieldIds = [...editFieldBlock[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);

    for (const id of [...directIds, ...editFieldIds]) {
      assert.ok(htmlIds.has(id), `admin/index.html is missing id="${id}" referenced by admin.js`);
    }
  });

  it("keeps job, readiness and health contracts aligned with backend response shapes", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminFile("admin.js"),
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
    assert.ok(js.includes("setReadinessRefreshNotice(\"Refreshing readiness snapshot...\""), "Readiness refresh should show a non-blocking notice");
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
    assert.ok(js.includes("Failed to load physical collection lifecycle"));
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
    assert.ok(html.includes("Audit Log"));
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
      readAdminFile("admin.js"),
    ]);

    assert.ok(html.includes('id="view-audit"'));
    assert.ok(html.includes('id="auditLogTableBody"'));
    assert.ok(js.includes("createAuditLogRow"));
    assert.ok(js.includes("renderAuditLogTable"));
    assert.ok(js.includes("renderAuditFilterControls"));
    assert.ok(js.includes("renderApiErrorContent(cell, state.auditLogError, \"Failed to load audit log\")"));
    assert.ok(js.includes("renderApiErrorContent(cell, state.auditLogError, \"Audit log refresh failed\")"));
    assert.ok(js.includes("function getAuditLogEmptyMessage()"));
    assert.ok(js.includes("No audit log entries have been recorded since this deployment."));
    assert.ok(js.includes("No audit log entries found for the current filters."));
    assert.ok(js.includes("createAuditDetailsBlock"));
    assert.ok(!js.includes(".innerHTML"));
  });

  it("contains the planned playground and job monitor controls", async () => {
    const html = await readAdminFile("index.html");
    const js = await readAdminFile("admin.js");

    assert.ok(html.includes('id="pgK"'), "Retrieve K input should exist");
    assert.ok(html.includes("This monitor tracks jobs observed by this browser/admin session.") || js.includes("This monitor tracks jobs observed by this browser/admin session."));
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
    assert.ok(js.includes("Delete terminal job from the server"));
    assert.ok(js.includes("Remove"));
  });
});
