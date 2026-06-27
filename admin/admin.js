/**
 * RAG Ops Dashboard - static admin panel.
 */

const API = {
    rag: "/v1/rag",
    admin: "/v1/admin",
    health: "/health",
    ready: "/ready",
};

const JOB_STORAGE_KEY = "ragAdmin.knownJobs.v1";
const JOB_LIST_LIMIT = 25;

const EDIT_FIELD_IDS = {
    displayName: "editDisplayName",
    description: "editDescription",
    sourcePath: "editSourcePath",
    ozelgeDataPath: "editOzelgeDataPath",
    distanceMetric: "editDistanceMetric",
    chunkSize: "editChunkSize",
    chunkOverlap: "editChunkOverlap",
    retrievalK: "editRetrievalK",
    retrievalDistanceThreshold: "editRetrievalDistanceThreshold",
    embeddingModel: "editEmbeddingModel",
    chatModel: "editChatModel",
};

let state = {
    currentView: "collections",
    activeTab: "ready",
    collections: [],
    selectedCollection: null,
    selectedReadiness: null,
    playgroundMode: "retrieve",
    knownJobs: loadKnownJobsFromStorage(),
    jobList: [],
    jobListSource: "local",
    jobListNextCursor: null,
    jobListCursor: null,
    jobListCursorStack: [],
    jobListStatusFilter: "all",
    jobListError: null,
    editorInitialSnapshot: null,
    isLoading: {
        collections: false,
        collectionDetail: false,
        jobs: false,
        health: false,
        readiness: false,
    },
    collectionError: null,
    healthStatus: null,
    readiness: null,
    readinessDetails: null,
};

const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    viewContainers: document.querySelectorAll(".view-container"),
    viewTitle: document.getElementById("viewTitle"),
    collectionsGrid: document.getElementById("collectionsGrid"),
    jobsTableBody: document.getElementById("jobsTableBody"),
    jobsStatusFilter: document.getElementById("jobsStatusFilter"),
    jobsRefreshList: document.getElementById("jobsRefreshList"),
    jobsPrevPage: document.getElementById("jobsPrevPage"),
    jobsNextPage: document.getElementById("jobsNextPage"),
    jobsPageInfo: document.getElementById("jobsPageInfo"),
    healthGrid: document.getElementById("healthGrid"),
    readinessDetail: document.getElementById("readinessDetail"),
    readinessWarnings: document.getElementById("readinessWarnings"),
    warningList: document.getElementById("warningList"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnCreateCollection: document.getElementById("btnCreateCollection"),

    inspectorOverlay: document.getElementById("inspectorOverlay"),
    inspectorPanel: document.getElementById("inspectorPanel"),
    inspectorTitle: document.getElementById("inspectorTitle"),
    inspectorStatusBadge: document.getElementById("inspectorStatusBadge"),
    btnCloseInspector: document.getElementById("btnCloseInspector"),

    tabBtns: document.querySelectorAll(".tab-btn"),
    tabContents: document.querySelectorAll(".tab-content"),
    readyTabBtn: document.querySelector('.tab-btn[data-tab="ready"]'),
    playgroundTabBtn: document.querySelector('.tab-btn[data-tab="playground"]'),

    readinessStatusGrid: document.getElementById("readinessStatusGrid"),
    readinessRefreshNotice: document.getElementById("readinessRefreshNotice"),
    readinessBlockers: document.getElementById("readinessBlockers"),
    blockerList: document.getElementById("blockerList"),

    pgModeBtns: document.querySelectorAll(".mode-btn"),
    pgQuestion: document.getElementById("pgQuestion"),
    pgK: document.getElementById("pgK"),
    pgResult: document.getElementById("pgResult"),
    btnPgRun: document.getElementById("btnPgRun"),

    colEditForm: document.getElementById("colEditForm"),
    editId: document.getElementById("editId"),
    editDisplayName: document.getElementById("editDisplayName"),
    editDescription: document.getElementById("editDescription"),
    editSourcePath: document.getElementById("editSourcePath"),
    editOzelgeDataPath: document.getElementById("editOzelgeDataPath"),
    editDistanceMetric: document.getElementById("editDistanceMetric"),
    editChunkSize: document.getElementById("editChunkSize"),
    editChunkOverlap: document.getElementById("editChunkOverlap"),
    editRetrievalK: document.getElementById("editRetrievalK"),
    editRetrievalDistanceThreshold: document.getElementById("editRetrievalDistanceThreshold"),
    editEmbeddingModel: document.getElementById("editEmbeddingModel"),
    editChatModel: document.getElementById("editChatModel"),
    btnCancelEdit: document.getElementById("btnCancelEdit"),
    btnSave: document.getElementById("btnSave"),

    btnReindex: document.getElementById("btnReindex"),
    btnDeleteCol: document.getElementById("btnDeleteCol"),

    tabReady: document.getElementById("tab-ready"),
    tabPlayground: document.getElementById("tab-playground"),
    tabEditor: document.getElementById("tab-editor"),
    toastContainer: document.getElementById("toastContainer"),
};

function collectionReadyUrl(collection) {
    return collection?.readyUrl || `${API.rag}/collections/${collection?.id}/ready`;
}

function collectionQueryUrl(collection) {
    return collection?.queryUrl || `${API.rag}/collections/${collection?.id}/query`;
}

function collectionRetrieveUrl(collection) {
    return collection?.retrieveUrl || `${API.rag}/collections/${collection?.id}/retrieve`;
}

function adminCollectionUrl(id) {
    return `${API.admin}/collections/${id}`;
}

function adminJobUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

function adminJobsListUrl(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit || JOB_LIST_LIMIT));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.status && options.status !== "all") params.set("status", options.status);
    if (options.collectionId) params.set("collectionId", options.collectionId);
    const query = params.toString();
    return query ? `${API.admin}/jobs?${query}` : `${API.admin}/jobs`;
}

function clearNode(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function appendText(node, text) {
    if (!node) return node;
    node.appendChild(document.createTextNode(String(text ?? "")));
    return node;
}

function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) appendText(node, text);
    return node;
}

function appendChildren(parent, children) {
    children.filter(Boolean).forEach((child) => parent.appendChild(child));
    return parent;
}

function createButton(label, className, onClick, attrs = {}) {
    const button = createEl("button", className, label);
    button.type = attrs.type || "button";
    if (attrs.title) button.title = attrs.title;
    if (attrs.ariaLabel) button.setAttribute("aria-label", attrs.ariaLabel);
    if (attrs.disabled) button.disabled = true;
    if (onClick) button.addEventListener("click", onClick);
    return button;
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
}

function formatCount(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function formatBoolean(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "-";
}

function formatMetric(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(value);
}

function stringifyForDisplay(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function shortId(value, length = 12) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

function createBadge(text, colorClass) {
    return createEl(
        "span",
        `inline-flex items-center px-2 py-1 text-xs font-bold rounded-full uppercase ${colorClass || "bg-slate-100 text-slate-600"}`,
        text || "unknown",
    );
}

function getStatusColor(status) {
    const colors = {
        ready: "bg-emerald-100 text-emerald-700",
        indexing: "bg-blue-100 text-blue-700",
        creating: "bg-amber-100 text-amber-700",
        failed: "bg-rose-100 text-rose-700",
        archived: "bg-slate-100 text-slate-600",
        queued: "bg-blue-100 text-blue-700",
        running: "bg-indigo-100 text-indigo-700",
        succeeded: "bg-emerald-100 text-emerald-700",
        cancelled: "bg-slate-100 text-slate-600",
        pass: "bg-emerald-100 text-emerald-700",
        warn: "bg-amber-100 text-amber-700",
        fail: "bg-rose-100 text-rose-700",
        ok: "bg-emerald-100 text-emerald-700",
        degraded: "bg-amber-100 text-amber-700",
        inaccessible: "bg-slate-100 text-slate-600",
    };
    return colors[status] || "bg-slate-100 text-slate-600";
}

function getStatusBadge(status) {
    return createBadge(status || "unknown", getStatusColor(status));
}

function getCollectionCardStatusPresentation(status) {
    switch (status) {
        case "creating":
            return {
                label: "Indexing required",
                note: "No active index yet. Open details to re-index.",
            };
        case "indexing":
            return {
                label: "Indexing in progress",
                note: "The collection is being indexed right now.",
            };
        case "ready":
            return {
                label: "Ready",
                note: "",
            };
        case "failed":
            return {
                label: "Indexing failed",
                note: "Open details to inspect the latest error.",
            };
        case "archived":
            return {
                label: "Archived",
                note: "This collection is archived and not active.",
            };
        default:
            return {
                label: status || "unknown",
                note: "",
            };
    }
}

function getCollectionCardStatusBadge(status) {
    const presentation = getCollectionCardStatusPresentation(status);
    return createBadge(presentation.label, getStatusColor(status));
}

function getCollectionCardStatusNote(status) {
    const presentation = getCollectionCardStatusPresentation(status);
    if (!presentation.note) return null;
    return createEl("p", "mt-2 text-xs text-slate-500", presentation.note);
}

function createMetaItem(label, value, className = "") {
    const item = createEl("div", `rounded border border-slate-100 bg-white p-3 ${className}`);
    const labelNode = createEl("div", "text-[10px] font-bold uppercase tracking-wider text-slate-400", label);
    const valueNode = createEl("div", "mt-1 text-sm font-semibold text-slate-700 break-all-words", stringifyForDisplay(value));
    appendChildren(item, [labelNode, valueNode]);
    return item;
}

function appendJsonDetails(parent, label, value) {
    if (value === null || value === undefined) return;
    const details = createEl("details", "mt-3 rounded border border-slate-200 bg-white p-3");
    const summary = createEl("summary", "cursor-pointer text-xs font-bold text-slate-500", label);
    const pre = createEl("pre", "mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600");
    try {
        pre.textContent = JSON.stringify(value, null, 2);
    } catch {
        pre.textContent = String(value);
    }
    appendChildren(details, [summary, pre]);
    parent.appendChild(details);
}

function setButtonLoading(button, loading, loadingText = "Loading...") {
    if (!button) return;
    if (loading) {
        button.dataset.originalText = button.dataset.originalText || button.textContent || "";
        button.disabled = true;
        button.textContent = loadingText;
        return;
    }
    button.textContent = button.dataset.originalText || button.textContent || "";
    delete button.dataset.originalText;
    button.disabled = false;
}

function normalizeError(input, fallback = {}) {
    const status = input?.status ?? fallback.status ?? 0;
    const code = input?.code || fallback.code || (status ? `HTTP_${status}` : "NETWORK_ERROR");
    return {
        normalized: true,
        status,
        code,
        message: input?.message || fallback.message || "Request failed",
        requestId: input?.requestId || fallback.requestId || null,
        details: input?.details || fallback.details || null,
        issues: input?.issues || input?.details?.issues || fallback.issues || null,
        cause: input,
    };
}

async function apiRequest(url, options = {}) {
    const body = options.body;
    const headers = {
        Accept: "application/json",
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
    };

    try {
        const response = await fetch(url, { ...options, headers });
        if (response.status === 204) return null;

        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        let data = null;

        if (text.trim()) {
            if (contentType.includes("application/json")) {
                try {
                    data = JSON.parse(text);
                } catch (error) {
                    throw normalizeError(error, {
                        status: response.status,
                        code: "RESPONSE_PARSE_ERROR",
                        message: `Could not parse JSON response from ${url}.`,
                    });
                }
            } else {
                data = text;
            }
        }

        if (!response.ok) {
            const errorData = isRecord(data) ? data : {};
            throw normalizeError(errorData, {
                status: response.status,
                code: errorData.code || `HTTP_${response.status}`,
                message: errorData.message || (typeof data === "string" && data.trim()) || response.statusText || "Request failed",
                requestId: errorData.requestId,
                details: errorData.details,
                issues: errorData.details?.issues,
            });
        }

        return data;
    } catch (error) {
        if (error?.normalized) throw error;
        throw normalizeError(error, {
            status: 0,
            code: "NETWORK_ERROR",
            message: error?.message || "Network request failed",
        });
    }
}

function renderIssuesList(parent, issues) {
    if (!Array.isArray(issues) || issues.length === 0) return;
    const list = createEl("ul", "mt-2 list-disc space-y-1 pl-5 text-xs");
    issues.forEach((issue) => {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
        const message = issue.message || stringifyForDisplay(issue);
        const item = createEl("li", "", path ? `${path}: ${message}` : message);
        list.appendChild(item);
    });
    parent.appendChild(list);
}

function renderApiErrorContent(parent, error, title = "Request failed") {
    clearNode(parent);
    const normalized = normalizeError(error);
    const box = createEl("div", "rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800");
    const heading = createEl("div", "font-bold", title);
    const message = createEl("div", "mt-1 break-all-words", normalized.message);
    appendChildren(box, [heading, message]);

    const meta = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3");
    meta.appendChild(createMetaItem("Code", normalized.code));
    meta.appendChild(createMetaItem("Status", normalized.status || "-"));
    meta.appendChild(createMetaItem("Request ID", normalized.requestId || "-"));
    box.appendChild(meta);
    renderIssuesList(box, normalized.issues);
    if (normalized.details && !normalized.issues) appendJsonDetails(box, "Details", normalized.details);
    parent.appendChild(box);
}

function showToast(message, type = "info", options = {}) {
    if (!elements.toastContainer) return;
    const toast = createEl(
        "div",
        `pointer-events-auto max-w-full rounded-lg p-4 text-sm font-medium shadow-lg transition-all duration-300 animate-in ${
            type === "success"
                ? "bg-emerald-600 text-white"
                : type === "error"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-800 text-white"
        }`,
    );
    const messageNode = createEl("div", "break-all-words", message || "");
    toast.appendChild(messageNode);
    if (options.code || options.requestId) {
        const meta = createEl("div", "mt-1 text-xs opacity-90", [options.code, options.requestId].filter(Boolean).join(" / "));
        toast.appendChild(meta);
    }
    renderIssuesList(toast, options.issues);
    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("opacity-0", "translate-x-4");
        setTimeout(() => toast.remove(), 300);
    }, options.durationMs || 5000);
}

function showErrorToast(error, fallback = "Request failed") {
    const normalized = normalizeError(error, { message: fallback });
    showToast(normalized.message, "error", {
        code: normalized.code,
        requestId: normalized.requestId,
        issues: normalized.issues,
        durationMs: 7000,
    });
}

function collectionNameById(collectionId) {
    return state.collections.find((collection) => collection.id === collectionId)?.displayName || null;
}

function mergeCollectionIntoState(collection) {
    if (!collection?.id) return state.selectedCollection;
    const index = state.collections.findIndex((item) => item.id === collection.id);
    const existing = index >= 0 ? state.collections[index] : {};
    const merged = { ...existing, ...collection };
    if (index >= 0) state.collections[index] = merged;
    else state.collections.push(merged);
    if (state.selectedCollection?.id === collection.id) state.selectedCollection = merged;
    return merged;
}

async function loadAdminCollectionDetail(collectionId) {
    const data = await apiRequest(adminCollectionUrl(collectionId));
    if (!data?.collection) {
        throw normalizeError(null, {
            status: 0,
            code: "INVALID_COLLECTION_RESPONSE",
            message: "Admin collection detail response did not include data.collection.",
        });
    }
    return data.collection;
}

function switchView(viewId) {
    state.currentView = viewId;
    elements.navItems.forEach((item) => {
        const active = item.dataset.view === viewId;
        item.classList.toggle("active", active);
        item.setAttribute("aria-current", active ? "page" : "false");
    });

    elements.viewContainers.forEach((container) => {
        const viewName = container.id.replace("view-", "");
        container.classList.toggle("hidden", viewName !== viewId);
    });

    const titles = {
        collections: "Collections",
        jobs: "Job Monitor",
        health: "System Health",
    };
    elements.viewTitle.textContent = titles[viewId] || "Dashboard";

    if (viewId === "jobs") loadJobs();
    if (viewId === "health") loadHealth();
}

async function loadCollections() {
    if (state.isLoading.collections) return;
    state.isLoading.collections = true;
    state.collectionError = null;
    renderCollections();

    try {
        const data = await apiRequest(`${API.rag}/collections`);
        state.collections = Array.isArray(data?.collections) ? data.collections : [];
    } catch (error) {
        state.collectionError = error;
        state.collections = [];
        showErrorToast(error, "Failed to load collections");
    } finally {
        state.isLoading.collections = false;
        renderCollections();
    }
}

function renderCollections() {
    const grid = elements.collectionsGrid;
    clearNode(grid);

    if (state.isLoading.collections) {
        grid.appendChild(createEl("div", "col-span-full py-12 text-center text-slate-400 italic", "Loading collections..."));
        return;
    }

    if (state.collectionError) {
        const errorBox = createEl("div", "col-span-full");
        renderApiErrorContent(errorBox, state.collectionError, "Failed to load collections");
        grid.appendChild(errorBox);
        return;
    }

    if (state.collections.length === 0) {
        grid.appendChild(createEl("div", "col-span-full py-12 text-center text-slate-400 italic", 'No collections found. Click "New Collection" to get started.'));
        return;
    }

    state.collections.forEach((collection) => {
        const card = createEl("button", "group relative rounded-lg border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600");
        card.type = "button";
        card.addEventListener("click", () => openInspector(collection.id));

        const icon = createEl("div", "mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 font-bold text-indigo-600", (collection.displayName || "?").charAt(0).toUpperCase());
        const statusNote = getCollectionCardStatusNote(collection.status);
        const title = createEl("h3", "mt-3 break-all-words font-bold text-slate-800 transition-colors group-hover:text-indigo-600", collection.displayName || "Unnamed Collection");
        const desc = createEl("p", "mt-1 line-clamp-2 min-h-[2rem] text-xs text-slate-500", collection.description || "No description provided.");
        const footer = createEl("div", "mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:grid-cols-3");
        footer.appendChild(createEl("span", "", `Chunks: ${formatCount(collection.chunkCount)}`));
        footer.appendChild(createEl("span", "", `Version: ${formatCount(collection.activeVersion)}`));
        footer.appendChild(createEl("span", "", formatDateTime(collection.updatedAt)));

        appendChildren(card, [icon, getCollectionCardStatusBadge(collection.status), statusNote, title, desc, footer]);
        grid.appendChild(card);
    });
}

function openPanel() {
    elements.inspectorOverlay.classList.remove("hidden");
    requestAnimationFrame(() => elements.inspectorOverlay.classList.add("opacity-100"));
    elements.inspectorPanel.classList.remove("translate-x-full");
}

async function openInspector(id) {
    if (id === null) {
        state.selectedCollection = null;
        state.editorInitialSnapshot = null;
        resetReadinessAndPlayground("Save the collection before checking readiness.");
        clearEditorForm();
        elements.inspectorTitle.textContent = "Create Collection";
        clearNode(elements.inspectorStatusBadge);
        elements.inspectorStatusBadge.classList.add("hidden");
        setInspectorActionsEnabled(false, "Save the collection before using this action.");
        setCollectionTabsEnabled(false);
        switchTab("editor");
        openPanel();
        return;
    }

    const collection = state.collections.find((item) => item.id === id);
    if (!collection) {
        showToast("Collection was not found in the current list. Refresh and try again.", "error");
        return;
    }

    state.selectedCollection = collection;
    state.editorInitialSnapshot = null;
    resetReadinessAndPlayground("Readiness has not been loaded yet.");
    elements.inspectorTitle.textContent = collection.displayName || collection.id;
    clearNode(elements.inspectorStatusBadge);
    elements.inspectorStatusBadge.classList.remove("hidden");
    elements.inspectorStatusBadge.appendChild(getStatusBadge(collection.status));
    setInspectorActionsEnabled(true);
    setCollectionTabsEnabled(true);
    setupEditorTab(collection);
    switchTab("ready");
    openPanel();
    state.isLoading.collectionDetail = true;
    setButtonLoading(elements.btnSave, true, "Loading...");
    try {
        const detail = await loadAdminCollectionDetail(id);
        if (state.selectedCollection?.id !== id) return;
        const merged = mergeCollectionIntoState(detail);
        setupEditorTab(merged);
        elements.inspectorTitle.textContent = merged.displayName || merged.id;
        clearNode(elements.inspectorStatusBadge);
        elements.inspectorStatusBadge.appendChild(getStatusBadge(merged.status));
    } catch (error) {
        showErrorToast(error, "Failed to load editable collection settings");
    } finally {
        state.isLoading.collectionDetail = false;
        setButtonLoading(elements.btnSave, false);
    }
    await updateReadinessTab();
}

function closeInspector() {
    elements.inspectorPanel.classList.add("translate-x-full");
    elements.inspectorOverlay.classList.remove("opacity-100");
    setTimeout(() => elements.inspectorOverlay.classList.add("hidden"), 200);
}

function handleOverlayClick(event) {
    if (event.target === elements.inspectorOverlay) closeInspector();
}

function switchTab(tabName) {
    state.activeTab = tabName;
    elements.tabBtns.forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle("active", active);
        button.classList.toggle("border-indigo-600", active);
        button.classList.toggle("text-indigo-600", active);
        button.classList.toggle("border-transparent", !active);
        button.classList.toggle("text-slate-500", !active);
    });

    elements.tabContents.forEach((content) => {
        content.classList.toggle("hidden", content.id !== `tab-${tabName}`);
    });
}

function setCollectionTabsEnabled(enabled) {
    [elements.readyTabBtn, elements.playgroundTabBtn].forEach((button) => {
        if (!button) return;
        button.classList.toggle("hidden", !enabled);
        button.disabled = !enabled;
        if (!enabled) button.title = "Save the collection before using this tab.";
        else button.removeAttribute("title");
    });
}

function setInspectorActionsEnabled(enabled, reason = "") {
    [elements.btnReindex, elements.btnDeleteCol].forEach((button) => {
        if (!button) return;
        button.disabled = !enabled;
        button.classList.toggle("opacity-50", !enabled);
        button.classList.toggle("cursor-not-allowed", !enabled);
        if (!enabled && reason) button.title = reason;
        if (enabled) button.removeAttribute("title");
    });
}

function resetPlaygroundResult(message = "Results will appear here...") {
    clearNode(elements.pgResult);
    elements.pgResult.appendChild(createEl("span", "text-slate-400 italic", message));
}

function clearReadinessRefreshNotice() {
    if (!elements.readinessRefreshNotice) return;
    clearNode(elements.readinessRefreshNotice);
    elements.readinessRefreshNotice.className = "hidden rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800";
}

function setReadinessRefreshNotice(message, tone = "warning") {
    if (!elements.readinessRefreshNotice) return;
    clearNode(elements.readinessRefreshNotice);
    const toneClasses = tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-amber-200 bg-amber-50 text-amber-800";
    elements.readinessRefreshNotice.className = `rounded-lg border p-3 text-xs ${toneClasses}`;
    elements.readinessRefreshNotice.textContent = message || "";
    elements.readinessRefreshNotice.classList.remove("hidden");
}

function resetReadinessAndPlayground(message) {
    state.selectedReadiness = null;
    clearReadinessRefreshNotice();
    clearNode(elements.readinessStatusGrid);
    elements.readinessStatusGrid.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500", message || "Readiness has not been loaded yet."));
    clearNode(elements.blockerList);
    elements.readinessBlockers.classList.add("hidden");
    clearNode(elements.warningList);
    elements.readinessWarnings.classList.add("hidden");
    resetPlaygroundResult();
    updatePlaygroundCapabilityState(message || "Readiness has not been loaded yet.");
}

function renderReadinessIssueList(listElement, items) {
    clearNode(listElement);
    items.forEach((item) => {
        const row = createEl("li", "list-none rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700");
        if (isRecord(item)) {
            row.appendChild(createEl("div", "font-semibold text-slate-800", item.code || item.name || "Issue"));
            row.appendChild(createEl("div", "mt-1 break-all-words", item.message || stringifyForDisplay(item)));
            if (item.recommendedAction) {
                row.appendChild(createEl("div", "mt-1 break-all-words text-slate-500", item.recommendedAction));
            }
        } else {
            appendText(row, stringifyForDisplay(item));
        }
        listElement.appendChild(row);
    });
}

async function updateReadinessTab() {
    if (!state.selectedCollection || state.isLoading.readiness) return;
    const hasSnapshot = Boolean(state.selectedReadiness);
    state.isLoading.readiness = true;
    if (hasSnapshot) {
        setReadinessRefreshNotice("Refreshing readiness snapshot...", "warning");
    } else {
        clearReadinessRefreshNotice();
        clearNode(elements.readinessStatusGrid);
        elements.readinessStatusGrid.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500", "Loading readiness..."));
    }
    updatePlaygroundCapabilityState(hasSnapshot ? "Refreshing readiness snapshot..." : "Readiness is loading.");

    try {
        const readiness = await apiRequest(collectionReadyUrl(state.selectedCollection));
        state.selectedReadiness = readiness;
        renderReadinessData(readiness);
        clearReadinessRefreshNotice();
        mergeActiveJobFromReadiness(readiness);
    } catch (error) {
        if (!hasSnapshot) {
            state.selectedReadiness = null;
            renderApiErrorContent(elements.readinessStatusGrid, error, "Failed to load readiness");
            clearNode(elements.blockerList);
            elements.readinessBlockers.classList.add("hidden");
            clearNode(elements.warningList);
            elements.readinessWarnings.classList.add("hidden");
            clearReadinessRefreshNotice();
            updatePlaygroundCapabilityState("Readiness failed to load.");
        } else {
            setReadinessRefreshNotice("Readiness refresh failed. Showing the last known snapshot.", "error");
            updatePlaygroundCapabilityState("Refresh failed. Showing the last known readiness.");
        }
    } finally {
        state.isLoading.readiness = false;
    }
}

function createReadinessRow(label, value, ok) {
    const row = createEl("div", "flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3");
    row.appendChild(createEl("span", "text-xs font-medium text-slate-600", label));
    if (typeof ok === "boolean") row.appendChild(createBadge(ok ? "READY" : "NOT READY", ok ? getStatusColor("ready") : getStatusColor("failed")));
    else row.appendChild(createEl("span", "break-all-words text-right text-xs font-semibold text-slate-600", stringifyForDisplay(value)));
    return row;
}

function renderReadinessData(readiness) {
    clearNode(elements.readinessStatusGrid);
    const availability = readiness.modelAvailability || {};
    const capabilities = readiness.capabilities || {};
    const rows = [
        createReadinessRow("Collection status", readiness.status),
        createReadinessRow("Active physical collection", readiness.hasActivePhysicalCollection, Boolean(readiness.hasActivePhysicalCollection)),
        createReadinessRow("Active version", readiness.activeVersion || "-"),
        createReadinessRow("Chroma readable", readiness.chromaReadable, Boolean(readiness.chromaReadable)),
        createReadinessRow("Chroma count", formatCount(readiness.chromaCount)),
        createReadinessRow(`Embedding model: ${availability.embeddingModel || "-"}`, availability.embeddingModelAvailable, Boolean(availability.embeddingModelAvailable)),
        createReadinessRow(`Chat model: ${availability.chatModel || "-"}`, availability.chatModelAvailable, Boolean(availability.chatModelAvailable)),
        createReadinessRow("Retrieve capability", capabilities.retrieve, Boolean(capabilities.retrieve)),
        createReadinessRow("Query capability", capabilities.query, Boolean(capabilities.query)),
        createReadinessRow("Re-index capability", capabilities.reindex, Boolean(capabilities.reindex)),
    ];
    rows.forEach((row) => elements.readinessStatusGrid.appendChild(row));

    if (readiness.activeJob) {
        const active = createEl("div", "rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800");
        appendText(active, `Active job: ${readiness.activeJob.id} (${readiness.activeJob.status})`);
        elements.readinessStatusGrid.appendChild(active);
    }

    const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
    if (blockers.length > 0) {
        elements.readinessBlockers.classList.remove("hidden");
        renderReadinessIssueList(elements.blockerList, blockers);
    } else {
        elements.readinessBlockers.classList.add("hidden");
        clearNode(elements.blockerList);
    }

    const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
    if (warnings.length > 0) {
        elements.readinessWarnings.classList.remove("hidden");
        renderReadinessIssueList(elements.warningList, warnings);
    } else {
        elements.readinessWarnings.classList.add("hidden");
        clearNode(elements.warningList);
    }

    updatePlaygroundCapabilityState();
}

function getCapabilityState(mode) {
    if (!state.selectedCollection) return { enabled: false, reason: "Select and save a collection first." };
    if (!state.selectedReadiness) return { enabled: false, reason: "Readiness is not available." };
    const enabled = state.selectedReadiness.capabilities?.[mode] === true;
    return {
        enabled,
        reason: enabled ? "" : `${mode === "query" ? "Query" : "Retrieve"} is not available for this collection.`,
    };
}

function updatePlaygroundCapabilityState(fallbackReason) {
    elements.pgModeBtns.forEach((button) => {
        const capability = getCapabilityState(button.dataset.mode);
        button.disabled = !capability.enabled;
        button.classList.toggle("opacity-50", !capability.enabled);
        button.classList.toggle("cursor-not-allowed", !capability.enabled);
        if (capability.enabled) button.removeAttribute("title");
        else button.title = fallbackReason || capability.reason;
    });

    const current = getCapabilityState(state.playgroundMode);
    elements.btnPgRun.disabled = !current.enabled;
    elements.btnPgRun.classList.toggle("opacity-50", !current.enabled);
    elements.btnPgRun.classList.toggle("cursor-not-allowed", !current.enabled);
    if (current.enabled) elements.btnPgRun.removeAttribute("title");
    else elements.btnPgRun.title = fallbackReason || current.reason;
}

function clearEditorForm() {
    Object.values(EDIT_FIELD_IDS).forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.value = "";
    });
    elements.editId.value = "";
    elements.editDistanceMetric.value = "l2";
}

function fieldValueFromCollection(collection, field) {
    if (!Object.prototype.hasOwnProperty.call(collection, field)) return "";
    return collection[field] ?? "";
}

function setupEditorTab(collection) {
    elements.editId.value = collection.id || "";
    elements.editDisplayName.value = fieldValueFromCollection(collection, "displayName");
    elements.editDescription.value = fieldValueFromCollection(collection, "description");
    elements.editSourcePath.value = fieldValueFromCollection(collection, "sourcePath");
    elements.editOzelgeDataPath.value = fieldValueFromCollection(collection, "ozelgeDataPath");
    elements.editDistanceMetric.value = collection.distanceMetric || "l2";
    elements.editChunkSize.value = collection.chunkSize ?? "";
    elements.editChunkOverlap.value = collection.chunkOverlap ?? "";
    elements.editRetrievalK.value = collection.retrievalK ?? "";
    elements.editRetrievalDistanceThreshold.value = collection.retrievalDistanceThreshold ?? "";
    elements.editEmbeddingModel.value = fieldValueFromCollection(collection, "embeddingModel");
    elements.editChatModel.value = fieldValueFromCollection(collection, "chatModel");
    state.editorInitialSnapshot = readEditorValues();
}

function readTrimmed(id) {
    return document.getElementById(id)?.value.trim() || "";
}

function readOptionalInteger(id) {
    const value = document.getElementById(id)?.value.trim() || "";
    if (value === "") return undefined;
    const number = Number(value);
    return Number.isInteger(number) ? number : NaN;
}

function readOptionalNumber(id) {
    const value = document.getElementById(id)?.value.trim() || "";
    if (value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function readEditorValues() {
    return {
        displayName: readTrimmed(EDIT_FIELD_IDS.displayName),
        description: readTrimmed(EDIT_FIELD_IDS.description),
        sourcePath: readTrimmed(EDIT_FIELD_IDS.sourcePath),
        ozelgeDataPath: readTrimmed(EDIT_FIELD_IDS.ozelgeDataPath),
        distanceMetric: readTrimmed(EDIT_FIELD_IDS.distanceMetric),
        chunkSize: readOptionalInteger(EDIT_FIELD_IDS.chunkSize),
        chunkOverlap: readOptionalInteger(EDIT_FIELD_IDS.chunkOverlap),
        retrievalK: readOptionalInteger(EDIT_FIELD_IDS.retrievalK),
        retrievalDistanceThreshold: readOptionalNumber(EDIT_FIELD_IDS.retrievalDistanceThreshold),
        embeddingModel: readTrimmed(EDIT_FIELD_IDS.embeddingModel),
        chatModel: readTrimmed(EDIT_FIELD_IDS.chatModel),
    };
}

function validateCollectionForm(mode) {
    const values = readEditorValues();
    const errors = [];
    if (mode === "create" && !values.displayName) errors.push("displayName is required for new collections.");
    if (mode === "update" && !values.displayName) errors.push("displayName cannot be empty.");
    if (values.chunkSize !== undefined && (!Number.isInteger(values.chunkSize) || values.chunkSize <= 0)) errors.push("chunkSize must be a positive integer.");
    if (values.chunkOverlap !== undefined && (!Number.isInteger(values.chunkOverlap) || values.chunkOverlap < 0)) errors.push("chunkOverlap must be a nonnegative integer.");
    if (
        values.chunkSize !== undefined &&
        values.chunkOverlap !== undefined &&
        !Number.isNaN(values.chunkSize) &&
        !Number.isNaN(values.chunkOverlap) &&
        values.chunkOverlap >= values.chunkSize
    ) {
        errors.push("chunkOverlap must be less than chunkSize.");
    }
    if (values.retrievalK !== undefined && (!Number.isInteger(values.retrievalK) || values.retrievalK <= 0)) errors.push("retrievalK must be a positive integer.");
    if (values.retrievalDistanceThreshold !== undefined && (!Number.isFinite(values.retrievalDistanceThreshold) || values.retrievalDistanceThreshold < 0)) {
        errors.push("retrievalDistanceThreshold must be a nonnegative number.");
    }
    if (values.distanceMetric && !["l2", "cosine", "ip"].includes(values.distanceMetric)) errors.push("distanceMetric must be l2, cosine, or ip.");
    return errors;
}

function addIfText(payload, key, value) {
    if (value) payload[key] = value;
}

function addIfNumber(payload, key, value) {
    if (value !== undefined && Number.isFinite(value)) payload[key] = value;
}

function buildCollectionPayload(mode) {
    const values = readEditorValues();
    const payload = {};

    if (mode === "create") {
        payload.displayName = values.displayName;
        addIfText(payload, "description", values.description);
        addIfText(payload, "sourcePath", values.sourcePath);
        addIfText(payload, "ozelgeDataPath", values.ozelgeDataPath);
        if (values.distanceMetric) payload.distanceMetric = values.distanceMetric;
        addIfNumber(payload, "chunkSize", values.chunkSize);
        addIfNumber(payload, "chunkOverlap", values.chunkOverlap);
        addIfNumber(payload, "retrievalK", values.retrievalK);
        addIfNumber(payload, "retrievalDistanceThreshold", values.retrievalDistanceThreshold);
        addIfText(payload, "embeddingModel", values.embeddingModel);
        addIfText(payload, "chatModel", values.chatModel);
        return payload;
    }

    const initial = state.editorInitialSnapshot || {};
    if (values.displayName && values.displayName !== initial.displayName) payload.displayName = values.displayName;

    if (values.description !== initial.description) {
        if (values.description) payload.description = values.description;
        else if (initial.description) payload.description = null;
    }

    ["sourcePath", "ozelgeDataPath", "embeddingModel", "chatModel"].forEach((key) => {
        if (values[key] && values[key] !== initial[key]) payload[key] = values[key];
    });

    if (values.distanceMetric && values.distanceMetric !== initial.distanceMetric) payload.distanceMetric = values.distanceMetric;

    ["chunkSize", "chunkOverlap", "retrievalK", "retrievalDistanceThreshold"].forEach((key) => {
        if (values[key] !== undefined && Number.isFinite(values[key]) && values[key] !== initial[key]) payload[key] = values[key];
    });

    return payload;
}

async function saveCollection() {
    const id = elements.editId.value;
    const mode = id ? "update" : "create";
    const errors = validateCollectionForm(mode);
    if (errors.length > 0) {
        showToast(errors.join(" "), "error", { durationMs: 7000 });
        return;
    }

    const payload = buildCollectionPayload(mode);
    if (mode === "update" && Object.keys(payload).length === 0) {
        showToast("No changes to save.", "info");
        return;
    }

    try {
        setButtonLoading(elements.btnSave, true, "Saving...");
        if (mode === "create") {
            const data = await apiRequest(`${API.admin}/collections`, { method: "POST", body: JSON.stringify(payload) });
            showToast(`Collection created: ${data?.collection?.id || payload.displayName}`, "success");
        } else {
            await apiRequest(adminCollectionUrl(id), { method: "PATCH", body: JSON.stringify(payload) });
            showToast("Collection updated.", "success");
        }
        await loadCollections();
        closeInspector();
    } catch (error) {
        showErrorToast(error, "Save failed");
    } finally {
        setButtonLoading(elements.btnSave, false);
    }
}

function setPlaygroundMode(mode) {
    state.playgroundMode = mode;
    elements.pgModeBtns.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("active", active);
        button.classList.toggle("bg-indigo-600", active);
        button.classList.toggle("text-white", active);
        button.classList.toggle("bg-slate-200", !active);
        button.classList.toggle("text-slate-600", !active);
    });
    updatePlaygroundCapabilityState();
}

function renderSourceFields(source, index) {
    const details = createEl("details", "rounded-lg border border-slate-200 bg-white p-3");
    if (index === 0) details.open = true;
    const summaryParts = [
        source.sourcePath || source.documentId || `Source ${index + 1}`,
        source.ozelgeId ? `Ozelge: ${source.ozelgeId}` : null,
        source.sayi ? `Sayi: ${source.sayi}` : null,
        source.tarih ? `Tarih: ${source.tarih}` : null,
        source.konu ? `Konu: ${source.konu}` : null,
    ].filter(Boolean);
    const summary = createEl("summary", "cursor-pointer break-all-words text-sm font-semibold text-slate-700", summaryParts.join(" / "));
    details.appendChild(summary);

    const grid = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2");
    [
        ["Source path", source.sourcePath],
        ["Source type", source.sourceType],
        ["Chunk", source.chunkIndex],
        ["Ozelge ID", source.ozelgeId],
        ["Sayi", source.sayi],
        ["Tarih", source.tarih],
        ["Konu", source.konu],
        ["Distance", formatMetric(source.distanceScore)],
    ].forEach(([label, value]) => {
        if (value !== undefined && value !== null && value !== "") grid.appendChild(createMetaItem(label, value));
    });
    details.appendChild(grid);

    if (source.content) {
        const preview = createEl("div", "mt-3 whitespace-pre-wrap break-all-words rounded bg-slate-50 p-3 text-xs leading-relaxed text-slate-600", source.content);
        details.appendChild(preview);
    }
    return details;
}

function renderSourceList(parent, sources) {
    const list = Array.isArray(sources) ? sources : [];
    if (list.length === 0) {
        parent.appendChild(createEl("p", "text-sm text-slate-400 italic", "No sources returned."));
        return;
    }
    const wrapper = createEl("div", "space-y-3");
    list.forEach((source, index) => wrapper.appendChild(renderSourceFields(source, index)));
    parent.appendChild(wrapper);
}

function renderRetrieveResult(data) {
    clearNode(elements.pgResult);
    const container = createEl("div", "space-y-4 font-sans");
    container.appendChild(createEl("h4", "text-sm font-bold text-slate-800", "Retrieve Result"));
    const meta = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    meta.appendChild(createMetaItem("Question", data?.question || elements.pgQuestion.value.trim(), "sm:col-span-2"));
    meta.appendChild(createMetaItem("K", data?.k));
    meta.appendChild(createMetaItem("Source count", data?.sourceCount ?? data?.sources?.length ?? 0));
    meta.appendChild(createMetaItem("Threshold", formatMetric(data?.distanceScoreThreshold)));
    meta.appendChild(createMetaItem("Collection", data?.collectionDisplayName || data?.collectionId || state.selectedCollection?.displayName));
    meta.appendChild(createMetaItem("Active version", data?.activeVersion));
    container.appendChild(meta);
    renderSourceList(container, data?.sources);
    appendJsonDetails(container, "Raw JSON", data);
    elements.pgResult.appendChild(container);
}

function renderQueryResult(data) {
    clearNode(elements.pgResult);
    const container = createEl("div", "space-y-4 font-sans");
    container.appendChild(createEl("h4", "text-sm font-bold text-slate-800", "Query Result"));
    const answer = createEl("div", "whitespace-pre-wrap break-all-words rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm leading-relaxed text-slate-800", data?.answer || "No answer returned.");
    container.appendChild(answer);
    const meta = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    meta.appendChild(createMetaItem("Threshold", formatMetric(data?.distanceScoreThreshold)));
    meta.appendChild(createMetaItem("Collection", data?.collectionDisplayName || data?.collectionId || state.selectedCollection?.displayName));
    meta.appendChild(createMetaItem("Active version", data?.activeVersion));
    meta.appendChild(createMetaItem("Sources", data?.sources?.length ?? 0));
    container.appendChild(meta);
    renderSourceList(container, data?.sources);
    appendJsonDetails(container, "Raw JSON", data);
    elements.pgResult.appendChild(container);
}

function friendlyRagMessage(code) {
    const messages = {
        NO_RELEVANT_CONTEXT: "No retrieved source passed the configured distance threshold.",
        ANSWER_NOT_IN_RETRIEVED_CONTEXT: "Sources were retrieved, but the model could not produce a grounded answer from them.",
        COLLECTION_INDEXING: "The collection is currently indexing. Try again after the job finishes.",
        COLLECTION_NOT_READY: "The collection is not ready for this operation.",
        MODEL_BACKPRESSURE: "The model service timed out or was unavailable for this request. Try again after the service is free.",
        RATE_LIMIT_EXCEEDED: "The request was rate limited. Wait and try again.",
        EMPTY_MODEL_RESPONSE: "The chat model returned an empty response.",
        DISALLOWED_FALLBACK_ANSWER: "The model returned a fallback answer that was rejected.",
    };
    return messages[code] || null;
}

function renderPlaygroundError(error) {
    clearNode(elements.pgResult);
    const normalized = normalizeError(error);
    const box = createEl("div", "rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 font-sans");
    box.appendChild(createEl("div", "font-bold", normalized.code || "RAG_ERROR"));
    box.appendChild(createEl("p", "mt-2", friendlyRagMessage(normalized.code) || normalized.message));
    if (normalized.message && friendlyRagMessage(normalized.code)) {
        box.appendChild(createEl("p", "mt-2 break-all-words text-xs", normalized.message));
    }
    const meta = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3");
    meta.appendChild(createMetaItem("Status", normalized.status || "-"));
    meta.appendChild(createMetaItem("Request ID", normalized.requestId || "-"));
    meta.appendChild(createMetaItem("Code", normalized.code || "-"));
    box.appendChild(meta);
    renderIssuesList(box, normalized.issues);
    if (normalized.details) appendJsonDetails(box, "Details", normalized.details);
    elements.pgResult.appendChild(box);
}

async function runPlayground() {
    if (!state.selectedCollection) {
        showToast("Select a collection first.", "error");
        return;
    }

    const capability = getCapabilityState(state.playgroundMode);
    if (!capability.enabled) {
        showToast(capability.reason, "error");
        return;
    }

    const question = elements.pgQuestion.value.trim();
    if (!question) {
        showToast("Question is required.", "error");
        return;
    }

    const kValue = elements.pgK?.value.trim();
    const retrieveK = kValue ? Number(kValue) : undefined;
    if (state.playgroundMode === "retrieve" && kValue && (!Number.isInteger(retrieveK) || retrieveK <= 0)) {
        showToast("Retrieve K must be a positive integer.", "error");
        return;
    }

    clearNode(elements.pgResult);
    elements.pgResult.appendChild(createEl("span", "text-slate-400 italic", "Processing..."));
    setButtonLoading(elements.btnPgRun, true, "Running...");

    try {
        if (state.playgroundMode === "retrieve") {
            const body = retrieveK ? { question, k: retrieveK } : { question };
            const data = await apiRequest(collectionRetrieveUrl(state.selectedCollection), {
                method: "POST",
                body: JSON.stringify(body),
            });
            renderRetrieveResult(data);
        } else {
            const data = await apiRequest(collectionQueryUrl(state.selectedCollection), {
                method: "POST",
                body: JSON.stringify({ question }),
            });
            renderQueryResult(data);
        }
    } catch (error) {
        renderPlaygroundError(error);
    } finally {
        setButtonLoading(elements.btnPgRun, false);
        updatePlaygroundCapabilityState();
    }
}

async function reindexCollection() {
    if (!state.selectedCollection) return;
    try {
        setButtonLoading(elements.btnReindex, true, "Starting...");
        const data = await apiRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: "POST" });
        if (data?.job) rememberJob(data.job, state.selectedCollection);
        showToast(`Re-indexing started: ${shortId(data?.job?.id || "")}`, "success");
        await Promise.all([loadCollections(), loadJobs(), updateReadinessTab()]);
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.code === "COLLECTION_INDEX_ALREADY_RUNNING") {
            showToast("A re-index job is already running for this collection. Refreshing readiness and jobs.", "error", { code: normalized.code });
            await Promise.allSettled([updateReadinessTab(), loadJobs()]);
        } else {
            showErrorToast(error, "Re-index failed");
        }
    } finally {
        setButtonLoading(elements.btnReindex, false);
    }
}

async function deleteCollection() {
    if (!state.selectedCollection) return;
    if (!confirm(`Delete collection "${state.selectedCollection.displayName || state.selectedCollection.id}"? This is a soft delete.`)) return;

    try {
        setButtonLoading(elements.btnDeleteCol, true, "Deleting...");
        await apiRequest(adminCollectionUrl(state.selectedCollection.id), { method: "DELETE" });
        showToast("Collection deleted.", "success");
        closeInspector();
        await loadCollections();
    } catch (error) {
        showErrorToast(error, "Delete failed");
    } finally {
        setButtonLoading(elements.btnDeleteCol, false);
    }
}

function loadKnownJobsFromStorage() {
    try {
        const raw = localStorage.getItem(JOB_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((job) => job?.id) : [];
    } catch (error) {
        console.warn("Failed to load known jobs", error);
        return [];
    }
}

function saveKnownJobsToStorage() {
    try {
        localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(state.knownJobs));
    } catch (error) {
        console.warn("Failed to save known jobs", error);
    }
}

function buildJobRecord(job, collection, existing = {}) {
    if (!job?.id) return;
    const collectionId = job.collectionId ?? collection?.id ?? existing.collectionId ?? null;
    return {
        ...existing,
        id: job.id,
        collectionId,
        collectionDisplayName: collection?.displayName ?? existing.collectionDisplayName ?? collectionNameById(collectionId),
        collectionStatus: collection?.status ?? existing.collectionStatus ?? null,
        status: job.status ?? existing.status ?? "queued",
        targetPhysicalCollection: job.targetPhysicalCollection ?? existing.targetPhysicalCollection ?? null,
        targetVersion: job.targetVersion ?? existing.targetVersion ?? null,
        targetEmbeddingModel: job.targetEmbeddingModel ?? existing.targetEmbeddingModel ?? null,
        startedAt: job.startedAt ?? existing.startedAt ?? null,
        finishedAt: job.finishedAt ?? existing.finishedAt ?? null,
        error: job.error ?? existing.error ?? null,
        documentCount: job.documentCount ?? existing.documentCount ?? null,
        chunkCount: job.chunkCount ?? existing.chunkCount ?? null,
        createdAt: job.createdAt ?? existing.createdAt ?? new Date().toISOString(),
        updatedAt: job.updatedAt ?? existing.updatedAt ?? new Date().toISOString(),
        notFound: false,
        localError: null,
    };
}

function rememberJob(job, collection, options = {}) {
    if (!job?.id) return null;
    const existing = state.knownJobs.find((item) => item.id === job.id) || {};
    const merged = buildJobRecord(job, collection, existing);
    const index = state.knownJobs.findIndex((item) => item.id === job.id);
    if (index >= 0) state.knownJobs[index] = merged;
    else state.knownJobs.push(merged);

    if (options.updateCurrentView !== false) {
        const viewIndex = state.jobList.findIndex((item) => item.id === job.id);
        if (viewIndex >= 0) state.jobList[viewIndex] = merged;
    }

    if (options.persist !== false) saveKnownJobsToStorage();
    if (options.render !== false) renderJobs();
    return merged;
}

function mergeActiveJobFromReadiness(readiness) {
    if (!readiness?.activeJob) return;
    rememberJob(readiness.activeJob, state.selectedCollection);
}

function markJobInaccessible(jobId, error) {
    const index = state.knownJobs.findIndex((job) => job.id === jobId);
    if (index < 0) return;
    const merged = {
        ...state.knownJobs[index],
        notFound: true,
        localError: normalizeError(error).message || "Job not found or inaccessible.",
        updatedAt: new Date().toISOString(),
    };
    state.knownJobs[index] = merged;

    const viewIndex = state.jobList.findIndex((job) => job.id === jobId);
    if (viewIndex >= 0) state.jobList[viewIndex] = merged;
    saveKnownJobsToStorage();
    renderJobs();
}

async function refreshJob(jobId) {
    try {
        const data = await apiRequest(adminJobUrl(jobId));
        if (!data?.job) throw normalizeError(null, { status: 0, code: "INVALID_JOB_RESPONSE", message: "Job response did not include data.job." });
        rememberJob(data.job, { id: data.job.collectionId, displayName: collectionNameById(data.job.collectionId) });
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status === 404) {
            markJobInaccessible(jobId, normalized);
            return;
        }
        throw error;
    }
}

function getJobViewRows() {
    const source = state.jobListSource;
    const rows = source === "server" ? state.jobList : state.knownJobs;
    if (state.jobListStatusFilter === "all") return rows;
    return rows.filter((job) => job.status === state.jobListStatusFilter);
}

function getJobViewEmptyMessage() {
    if (state.jobListSource === "server") {
        if (state.jobListError) {
            return "Could not load jobs from the server.";
        }

        if (state.jobListStatusFilter !== "all") {
            return `No jobs match the "${state.jobListStatusFilter}" filter.`;
        }

        return "No jobs returned by the server.";
    }

    if (state.jobListError) {
        return "Server job list endpoint is unavailable. Using cached jobs and per-job refresh.";
    }

    return "This monitor tracks jobs observed by this browser/admin session.";
}

function updateJobPaginationControls() {
    if (elements.jobsPrevPage) {
        elements.jobsPrevPage.disabled = state.jobListSource !== "server" || state.jobListCursorStack.length === 0 || state.isLoading.jobs;
    }
    if (elements.jobsNextPage) {
        elements.jobsNextPage.disabled = !state.jobListNextCursor || state.isLoading.jobs || state.jobListSource !== "server";
    }
    if (elements.jobsPageInfo) {
        elements.jobsPageInfo.textContent = state.jobListSource === "server"
            ? `Page ${state.jobListCursorStack.length + 1}`
            : "Legacy cache";
    }
    if (elements.jobsRefreshList) {
        setButtonLoading(elements.jobsRefreshList, state.isLoading.jobs, "Refreshing...");
    }
    if (elements.jobsStatusFilter) {
        elements.jobsStatusFilter.disabled = state.isLoading.jobs;
        elements.jobsStatusFilter.value = state.jobListStatusFilter;
    }
}

function resetJobPagination() {
    state.jobListCursor = null;
    state.jobListCursorStack = [];
}

async function loadJobs(options = {}) {
    if (state.isLoading.jobs) return;
    state.isLoading.jobs = true;
    updateJobPaginationControls();
    const cursor = options.cursor !== undefined ? options.cursor : state.jobListCursor;
    state.jobListCursor = cursor || null;
    try {
        const data = await apiRequest(adminJobsListUrl({
            status: state.jobListStatusFilter,
            cursor,
            limit: JOB_LIST_LIMIT,
        }));
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        state.jobList = jobs
            .map((entry) => rememberJob(entry?.job, entry?.collection, {
                updateCurrentView: false,
                persist: false,
                render: false,
            }))
            .filter(Boolean);
        state.jobListSource = "server";
        state.jobListError = null;
        state.jobListNextCursor = data?.nextCursor || null;
        saveKnownJobsToStorage();
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status === 404 || normalized.code === "ROUTE_NOT_FOUND") {
            state.jobListSource = "legacy";
            state.jobListNextCursor = null;
            state.jobListError = normalized;
            for (const job of [...state.knownJobs]) {
                try {
                    await refreshJob(job.id);
                } catch (jobError) {
                    const jobNormalized = normalizeError(jobError);
                    if (jobNormalized.status === 404) markJobInaccessible(job.id, jobNormalized);
                    else console.warn(`Failed to refresh legacy job ${job.id}`, jobNormalized);
                }
            }
            state.jobList = getJobViewRows();
            saveKnownJobsToStorage();
        } else {
            state.jobListSource = "local";
            state.jobList = getJobViewRows();
            state.jobListNextCursor = null;
            state.jobListError = error;
            showErrorToast(error, "Failed to load jobs");
        }
    } finally {
        state.isLoading.jobs = false;
        renderJobs();
        updateJobPaginationControls();
    }
}

async function refreshJobsList() {
    await loadJobs({ cursor: state.jobListCursor });
}

async function goToNextJobsPage() {
    if (!state.jobListNextCursor || state.isLoading.jobs) return;
    state.jobListCursorStack.push(state.jobListCursor || null);
    state.jobListCursor = state.jobListNextCursor;
    await loadJobs({ cursor: state.jobListCursor });
}

async function goToPreviousJobsPage() {
    if (state.jobListCursorStack.length === 0 || state.isLoading.jobs) return;
    const previousCursor = state.jobListCursorStack.pop() || null;
    state.jobListCursor = previousCursor;
    await loadJobs({ cursor: previousCursor });
}

async function changeJobsStatusFilter(value) {
    const nextFilter = value || "all";
    if (state.jobListStatusFilter === nextFilter && state.jobListCursorStack.length === 0 && state.jobListCursor === null) {
        return loadJobs({ cursor: null });
    }

    state.jobListStatusFilter = nextFilter;
    resetJobPagination();
    if (elements.jobsStatusFilter) {
        elements.jobsStatusFilter.value = nextFilter;
    }
    await loadJobs({ cursor: null });
}

async function cancelJob(jobId) {
    try {
        await apiRequest(`${API.admin}/jobs/${jobId}/cancel`, { method: "POST" });
        showToast("Job cancellation requested.", "success");
        await loadJobs();
        await loadCollections();
        if (state.selectedCollection) await updateReadinessTab();
    } catch (error) {
        showErrorToast(error, "Cancel failed");
        await loadJobs();
    }
}

function removeJobFromMonitor(jobId) {
    state.knownJobs = state.knownJobs.filter((job) => job.id !== jobId);
    state.jobList = state.jobList.filter((job) => job.id !== jobId);
    saveKnownJobsToStorage();
    renderJobs();
}

function appendCell(row, className, content) {
    const cell = createEl("td", `px-4 py-4 align-top text-xs ${className || ""}`);
    if (content instanceof Node) cell.appendChild(content);
    else appendText(cell, content);
    row.appendChild(cell);
    return cell;
}

function renderJobs() {
    const tbody = elements.jobsTableBody;
    clearNode(tbody);
    const jobs = getJobViewRows();

    if (jobs.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-6 py-12 text-center text-slate-400 italic");
        cell.colSpan = 8;
        cell.appendChild(createEl("div", "", getJobViewEmptyMessage()));
        if (state.jobListSource !== "server") {
            cell.appendChild(createEl("div", "mt-1 text-xs", "This monitor tracks jobs observed by this browser/admin session."));
        }
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    jobs.forEach((job) => {
        const row = createEl("tr", "hover:bg-slate-50");
        const idNode = createEl("span", "font-mono text-slate-700");
        idNode.title = job.id;
        appendText(idNode, shortId(job.id));
        appendCell(row, "", idNode);

        const collectionNode = createEl("div", "space-y-1");
        collectionNode.appendChild(createEl("div", "font-semibold text-slate-700 break-all-words", job.collectionDisplayName || "-"));
        collectionNode.appendChild(createEl("div", "font-mono text-[11px] text-slate-400 break-all-words", job.collectionId || "-"));
        if (job.collectionStatus) {
            collectionNode.appendChild(createEl("div", "text-[11px] uppercase tracking-wider text-slate-400", `Snapshot: ${job.collectionStatus}`));
        }
        appendCell(row, "", collectionNode);

        const statusText = job.notFound ? "inaccessible" : job.status;
        appendCell(row, "", createBadge(statusText, getStatusColor(statusText)));

        const target = createEl("div", "space-y-1 break-all-words text-slate-600");
        target.appendChild(createEl("div", "", `Version: ${job.targetVersion || "-"}`));
        target.appendChild(createEl("div", "", `Physical: ${job.targetPhysicalCollection || "-"}`));
        target.appendChild(createEl("div", "", `Embedding: ${job.targetEmbeddingModel || "-"}`));
        appendCell(row, "", target);

        const counts = createEl("div", "space-y-1 text-slate-600");
        counts.appendChild(createEl("div", "", `Docs: ${formatCount(job.documentCount)}`));
        counts.appendChild(createEl("div", "", `Chunks: ${formatCount(job.chunkCount)}`));
        appendCell(row, "", counts);

        const times = createEl("div", "space-y-1 text-slate-600");
        times.appendChild(createEl("div", "", `Created: ${formatDateTime(job.createdAt)}`));
        times.appendChild(createEl("div", "", `Started: ${formatDateTime(job.startedAt)}`));
        times.appendChild(createEl("div", "", `Updated: ${formatDateTime(job.updatedAt)}`));
        times.appendChild(createEl("div", "", `Finished: ${formatDateTime(job.finishedAt)}`));
        appendCell(row, "", times);

        appendCell(row, "max-w-xs break-all-words text-rose-600", job.localError || job.error || "-");

        const actions = createEl("div", "flex flex-wrap justify-end gap-2");
        actions.appendChild(createButton("Refresh", "text-xs font-medium text-indigo-600 hover:text-indigo-800", () => refreshJob(job.id).catch((error) => {
            showErrorToast(error, "Refresh failed");
            renderJobs();
        }), { title: "Refresh this job" }));
        if (job.status === "queued" || job.status === "running") {
            actions.appendChild(createButton("Cancel", "text-xs font-medium text-rose-600 hover:text-rose-800", () => cancelJob(job.id), { title: "Cancel this job" }));
        }
        if ((["succeeded", "failed", "cancelled"].includes(job.status) || job.notFound) && state.jobListSource !== "server") {
            actions.appendChild(createButton("Remove", "text-xs font-medium text-slate-500 hover:text-slate-700", () => removeJobFromMonitor(job.id), { title: "Remove from local monitor" }));
        }
        appendCell(row, "text-right", actions);
        tbody.appendChild(row);
    });
}

async function loadHealth() {
    if (state.isLoading.health) return;
    state.isLoading.health = true;

    try {
        const [healthResult, readyResult, detailsResult] = await Promise.allSettled([
            apiRequest(API.health),
            apiRequest(API.ready),
            apiRequest(`${API.ready}?details=true`),
        ]);

        state.healthStatus = healthResult.status === "fulfilled" ? healthResult.value : null;
        state.readiness = readyResult.status === "fulfilled" ? readyResult.value : null;
        state.readinessDetails = detailsResult.status === "fulfilled" ? detailsResult.value : null;

        renderHealthSummary(state.healthStatus, state.readiness, state.readinessDetails);
        renderReadinessDetail(state.readiness, state.readinessDetails, detailsResult.status === "rejected" ? detailsResult.reason : null);

        [healthResult, readyResult].forEach((result) => {
            if (result.status === "rejected") showErrorToast(result.reason, "Health summary failed");
        });
        if (detailsResult.status === "rejected") showErrorToast(detailsResult.reason, "Health details failed");
    } finally {
        state.isLoading.health = false;
    }
}

function dependencyStatus(dependency) {
    if (!dependency) return "unknown";
    if (dependency.ok === true) return "ok";
    if (dependency.ok === false) return "fail";
    return dependency.status || "unknown";
}

function renderHealthSummary(health, ready, details) {
    const grid = elements.healthGrid;
    clearNode(grid);

    if (!health && !ready && !details) {
        grid.appendChild(createEl("div", "col-span-full py-8 text-center text-slate-400 italic", "Health data unavailable."));
        return;
    }

    const processCard = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    processCard.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", "Process"));
    const processGrid = createEl("div", "grid grid-cols-1 gap-2 text-xs");
    processGrid.appendChild(createMetaItem("Status", health?.status || "-"));
    processGrid.appendChild(createMetaItem("Alive", formatBoolean(health?.alive)));
    processGrid.appendChild(createMetaItem("Uptime sec", health?.uptimeSec ? Math.round(health.uptimeSec) : "-"));
    processGrid.appendChild(createMetaItem("Timestamp", formatDateTime(health?.timestamp)));
    processGrid.appendChild(createMetaItem("Port", health?.port ?? ready?.config?.port ?? details?.port ?? "-"));
    processCard.appendChild(processGrid);
    grid.appendChild(processCard);

    const readinessCard = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    readinessCard.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", "Readiness"));
    const readinessGrid = createEl("div", "grid grid-cols-1 gap-2 text-xs");
    readinessGrid.appendChild(createMetaItem("Status", ready?.status || details?.status || "-"));
    readinessGrid.appendChild(createMetaItem("Ready", formatBoolean(ready?.ready ?? details?.ready)));
    readinessGrid.appendChild(createMetaItem("Ready for", ready?.systemReadyFor ?? details?.systemReadyFor ?? "-"));
    readinessGrid.appendChild(createMetaItem("Query ready", formatBoolean(ready?.queryReady ?? details?.queryReady)));
    readinessGrid.appendChild(createMetaItem("Index ready", formatBoolean(ready?.indexReady ?? details?.indexReady)));
    readinessGrid.appendChild(createMetaItem("Summary", ready?.overallSummary ?? details?.overallSummary ?? "-", "sm:col-span-1"));
    readinessCard.appendChild(readinessGrid);
    grid.appendChild(readinessCard);

    const depsCard = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    depsCard.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", "Dependencies"));
    const deps = details?.dependencies || ready?.dependencies || {};
    const depList = createEl("div", "space-y-2");
    ["registry", "chroma", "ollama"].forEach((key) => {
        const row = createEl("div", "flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 p-2 text-xs");
        row.appendChild(createEl("span", "font-semibold capitalize text-slate-600", key));
        row.appendChild(createBadge(dependencyStatus(deps[key]), getStatusColor(dependencyStatus(deps[key]))));
        depList.appendChild(row);
    });
    depsCard.appendChild(depList);
    grid.appendChild(depsCard);
}

function appendIssueSection(container, title, items, emptyText, colorClass) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", `mb-3 text-sm font-bold uppercase ${colorClass}`, title));
    if (!Array.isArray(items) || items.length === 0) {
        section.appendChild(createEl("p", "text-xs italic text-slate-400", emptyText));
        container.appendChild(section);
        return;
    }
    const list = createEl("div", "space-y-2");
    items.forEach((item) => {
        const row = createEl("div", "rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700");
        if (isRecord(item)) {
            row.appendChild(createEl("div", "font-semibold", item.code || item.name || "Issue"));
            row.appendChild(createEl("div", "mt-1 break-all-words", item.message || stringifyForDisplay(item)));
            if (item.recommendedAction) row.appendChild(createEl("div", "mt-1 break-all-words text-slate-500", item.recommendedAction));
        } else {
            appendText(row, item);
        }
        list.appendChild(row);
    });
    section.appendChild(list);
    container.appendChild(section);
}

function renderChecks(container, checks) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Checks"));
    if (!Array.isArray(checks) || checks.length === 0) {
        section.appendChild(createEl("p", "text-xs italic text-slate-400", "No checks available."));
        container.appendChild(section);
        return;
    }
    const list = createEl("div", "space-y-2");
    checks.forEach((check) => {
        const row = createEl("div", "rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs");
        const top = createEl("div", "flex flex-wrap items-center justify-between gap-2");
        top.appendChild(createEl("span", "font-semibold text-slate-700", check.name || check.code || "Check"));
        top.appendChild(createBadge(check.status || "unknown", getStatusColor(check.status)));
        row.appendChild(top);
        row.appendChild(createEl("div", "mt-1 break-all-words text-slate-500", check.code || ""));
        row.appendChild(createEl("div", "mt-1 break-all-words text-slate-700", check.message || "-"));
        if (Array.isArray(check.capabilities)) {
            row.appendChild(createEl("div", "mt-1 text-slate-500", `Capabilities: ${check.capabilities.join(", ")}`));
        }
        if (check.details) appendJsonDetails(row, "Check details", check.details);
        list.appendChild(row);
    });
    section.appendChild(list);
    container.appendChild(section);
}

function renderReadinessDetail(ready, details, detailsError) {
    const container = elements.readinessDetail;
    clearNode(container);

    if (detailsError) {
        const warning = createEl("div", "mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800");
        warning.appendChild(createEl("div", "font-bold", "Detailed readiness failed"));
        warning.appendChild(createEl("div", "mt-1 break-all-words", normalizeError(detailsError).message));
        container.appendChild(warning);
    }

    if (!ready && !details) {
        container.appendChild(createEl("p", "text-sm text-slate-400 italic", "No readiness details available."));
        return;
    }

    appendIssueSection(container, "Recommended Actions", details?.recommendedActions ?? ready?.recommendedActions, "No recommended actions.", "text-slate-500");
    appendIssueSection(container, "Blockers", details?.blockers ?? ready?.blockers, "No blockers.", "text-rose-600");
    appendIssueSection(container, "Warnings", details?.warnings ?? ready?.warnings, "No warnings.", "text-amber-600");
    renderChecks(container, details?.checks);

    const config = createEl("section", "mb-6");
    config.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Configuration"));
    const configGrid = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    configGrid.appendChild(createMetaItem("Chat model", details?.chatModel ?? ready?.config?.chatModel ?? "-"));
    configGrid.appendChild(createMetaItem("Embedding model", details?.embeddingModel ?? ready?.config?.embeddingModel ?? "-"));
    configGrid.appendChild(createMetaItem("Chroma URL", details?.chromaUrl ?? ready?.config?.chromaUrl ?? "-"));
    configGrid.appendChild(createMetaItem("Port", details?.port ?? ready?.config?.port ?? "-"));
    config.appendChild(configGrid);
    container.appendChild(config);

    const dataSource = details?.dataSource;
    const dataSourceSection = createEl("section", "mb-6");
    dataSourceSection.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Data Source"));
    if (dataSource) {
        const grid = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
        grid.appendChild(createMetaItem("Path", dataSource.path));
        grid.appendChild(createMetaItem("OK", formatBoolean(dataSource.ok)));
        grid.appendChild(createMetaItem("Error", dataSource.error || "-"));
        grid.appendChild(createMetaItem("Latency", dataSource.latencyMs !== undefined ? `${dataSource.latencyMs} ms` : "-"));
        dataSourceSection.appendChild(grid);
        appendJsonDetails(dataSourceSection, "Data source details", dataSource.details);
    } else {
        dataSourceSection.appendChild(createEl("p", "text-xs italic text-slate-400", "No data source details available."));
    }
    container.appendChild(dataSourceSection);

    const deps = details?.dependencies;
    if (deps) appendJsonDetails(container, "Dependency diagnostics", deps);
}

function bindEvents() {
    elements.navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            switchView(item.dataset.view);
        });
    });

    elements.btnRefresh.addEventListener("click", () => {
        loadCollections();
        loadJobs();
        loadHealth();
        if (state.selectedCollection) updateReadinessTab();
    });
    if (elements.jobsRefreshList) {
        elements.jobsRefreshList.addEventListener("click", () => {
            refreshJobsList();
        });
    }
    if (elements.jobsPrevPage) {
        elements.jobsPrevPage.addEventListener("click", () => {
            goToPreviousJobsPage();
        });
    }
    if (elements.jobsNextPage) {
        elements.jobsNextPage.addEventListener("click", () => {
            goToNextJobsPage();
        });
    }
    if (elements.jobsStatusFilter) {
        elements.jobsStatusFilter.addEventListener("change", (event) => {
            changeJobsStatusFilter(event.target.value);
        });
    }
    elements.btnCreateCollection.addEventListener("click", () => openInspector(null));
    elements.btnCloseInspector.addEventListener("click", closeInspector);
    elements.inspectorOverlay.addEventListener("click", handleOverlayClick);
    elements.btnCancelEdit.addEventListener("click", closeInspector);
    elements.colEditForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveCollection();
    });
    elements.btnReindex.addEventListener("click", reindexCollection);
    elements.btnDeleteCol.addEventListener("click", deleteCollection);
    elements.btnPgRun.addEventListener("click", runPlayground);

    elements.tabBtns.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.disabled) return;
            switchTab(button.dataset.tab);
            if (button.dataset.tab === "ready" && state.selectedCollection) updateReadinessTab();
            if (button.dataset.tab === "playground") updatePlaygroundCapabilityState();
        });
    });

    elements.pgModeBtns.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.disabled) return;
            setPlaygroundMode(button.dataset.mode);
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.inspectorOverlay.classList.contains("hidden")) closeInspector();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    switchView("collections");
    setPlaygroundMode("retrieve");
    resetReadinessAndPlayground("Select a collection to inspect readiness.");
    renderJobs();
    loadCollections();
    loadJobs();
    loadHealth();

    setInterval(() => {
        if (!document.hidden) loadJobs();
    }, 10000);

    setInterval(() => {
        if (!document.hidden) loadCollections();
    }, 10000);

    setInterval(() => {
        if (!document.hidden && state.selectedCollection) updateReadinessTab();
    }, 10000);

    setInterval(() => {
        if (!document.hidden) loadHealth();
    }, 30000);
});
