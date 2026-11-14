/**
 * RAG Ops Dashboard - static admin panel.
 */

const API = {
    rag: "/v1/rag",
    admin: "/v1/admin",
    adminAuth: "/v1/admin/auth",
    health: "/health",
    ready: "/ready",
};

const JOB_STORAGE_KEY = "ragAdmin.knownJobs.v1";
const JOB_LIST_LIMIT = 25;
const AUDIT_LOG_LIMIT = 25;
const AUDIT_LOG_OPERATION_OPTIONS = [
    { value: "query", label: "Query" },
    { value: "retrieve", label: "Retrieve" },
    { value: "reindex", label: "Reindex" },
    { value: "delete", label: "Delete collection" },
    { value: "index_job", label: "Index job" },
    { value: "job_delete_batch", label: "Bulk delete jobs" },
    { value: "job_delete", label: "Delete job" },
    { value: "job", label: "Job detail" },
    { value: "job_events", label: "Job events" },
    { value: "collection_readiness", label: "Collection readiness" },
    { value: "index_build", label: "Index build" },
    { value: "cleanup", label: "Cleanup" },
    { value: "load_file", label: "Load file" },
];
const AUDIT_COLLECTION_PANEL_WIDTH_CLASS = "w-[min(92vw,34rem)]";

const EDIT_FIELD_IDS = {
    displayName: "editDisplayName",
    description: "editDescription",
    sourcePath: "editSourcePath",
    distanceMetric: "editDistanceMetric",
    chunkSize: "editChunkSize",
    chunkOverlap: "editChunkOverlap",
    retrievalK: "editRetrievalK",
    retrievalDistanceThreshold: "editRetrievalDistanceThreshold",
    embeddingProvider: "editEmbeddingProvider",
    embeddingModel: "editEmbeddingModel",
};

let state = {
    currentView: "collections",
    activeTab: "ready",
    auth: {
        enabled: false,
        authenticated: false,
        session: null,
        loading: false,
        error: null,
    },
    collections: [],
    selectedCollection: null,
    selectedReadiness: null,
    selectedPhysicalCollections: null,
    selectedPhysicalCollectionsError: null,
    // GET /v1/admin/models: embedding model suggestions per provider.
    modelDiscovery: emptyModelDiscovery(),
    configDefaults: {
        loaded: false,
        collectionDefaults: null,
        modelDefaults: null,
        chat: null,
    },
    playgroundMode: "retrieve",
    knownJobs: loadKnownJobsFromStorage(),
    jobList: [],
    jobListSource: "local",
    jobListNextCursor: null,
    jobListCursor: null,
    jobListCursorStack: [],
    jobListStatusFilter: "all",
    jobListError: null,
    auditLog: [],
    auditLogError: null,
    auditLogCollectionFilter: [],
    auditLogOperationFilter: [],
    auditLogNextCursor: null,
    auditLogCursor: null,
    auditLogCursorStack: [],
    selectedJobIds: new Set(),
    editorInitialSnapshot: null,
    isLoading: {
        collections: false,
        collectionDetail: false,
        jobs: false,
        health: false,
        readiness: false,
        physicalCollections: false,
        auditLog: false,
    },
    collectionError: null,
    healthStatus: null,
    readiness: null,
    readinessDetails: null,
    healthLastUpdatedAt: null,
};

const loadTokens = {
    configDefaults: 0,
    modelDiscovery: 0,
    auditLog: 0,
};

const elements = {
    authShell: document.getElementById("authShell"),
    authPanel: document.getElementById("authPanel"),
    authStatus: document.getElementById("authStatus"),
    authError: document.getElementById("authError"),
    authUsername: document.getElementById("authUsername"),
    authPassword: document.getElementById("authPassword"),
    authLoginForm: document.getElementById("authLoginForm"),
    authLoginButton: document.getElementById("authLoginButton"),
    authLogoutButton: document.getElementById("authLogoutButton"),
    authSessionSummary: document.getElementById("authSessionSummary"),
    authSessionRole: document.getElementById("authSessionRole"),
    authSessionTenant: document.getElementById("authSessionTenant"),
    authSessionExpiry: document.getElementById("authSessionExpiry"),
    dashboardShell: document.getElementById("dashboardShell"),
    authBar: document.getElementById("authBar"),
    authBadge: document.getElementById("authBadge"),
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
    jobsBulkActionBar: document.getElementById("jobsBulkActionBar"),
    jobsBulkSelectionCount: document.getElementById("jobsBulkSelectionCount"),
    jobsBulkRemove: document.getElementById("jobsBulkRemove"),
    jobsSelectAll: document.getElementById("jobsSelectAll"),
    auditLogTableBody: document.getElementById("auditLogTableBody"),
    auditCollectionPicker: document.getElementById("auditCollectionPicker"),
    auditCollectionToggle: document.getElementById("auditCollectionToggle"),
    auditCollectionSummary: document.getElementById("auditCollectionSummary"),
    auditCollectionDetail: document.getElementById("auditCollectionDetail"),
    auditCollectionPanel: document.getElementById("auditCollectionPanel"),
    auditCollectionSearch: document.getElementById("auditCollectionSearch"),
    auditCollectionAll: document.getElementById("auditCollectionAll"),
    auditCollectionClear: document.getElementById("auditCollectionClear"),
    auditCollectionList: document.getElementById("auditCollectionList"),
    auditCollectionMeta: document.getElementById("auditCollectionMeta"),
    auditOperationPicker: document.getElementById("auditOperationPicker"),
    auditOperationToggle: document.getElementById("auditOperationToggle"),
    auditOperationSummary: document.getElementById("auditOperationSummary"),
    auditOperationDetail: document.getElementById("auditOperationDetail"),
    auditOperationPanel: document.getElementById("auditOperationPanel"),
    auditOperationSearch: document.getElementById("auditOperationSearch"),
    auditOperationAll: document.getElementById("auditOperationAll"),
    auditOperationClear: document.getElementById("auditOperationClear"),
    auditOperationList: document.getElementById("auditOperationList"),
    auditOperationMeta: document.getElementById("auditOperationMeta"),
    auditClearFilters: document.getElementById("auditClearFilters"),
    auditRefreshList: document.getElementById("auditRefreshList"),
    auditPrevPage: document.getElementById("auditPrevPage"),
    auditNextPage: document.getElementById("auditNextPage"),
    auditPageInfo: document.getElementById("auditPageInfo"),
    healthGrid: document.getElementById("healthGrid"),
    readinessDetail: document.getElementById("readinessDetail"),
    readinessWarnings: document.getElementById("readinessWarnings"),
    warningList: document.getElementById("warningList"),
    collectionIndexState: document.getElementById("collectionIndexState"),
    collectionIndexStateTitle: document.getElementById("collectionIndexStateTitle"),
    collectionIndexStateSummary: document.getElementById("collectionIndexStateSummary"),
    collectionIndexStateBadge: document.getElementById("collectionIndexStateBadge"),
    collectionIndexStateContent: document.getElementById("collectionIndexStateContent"),
    collectionValidation: document.getElementById("collectionValidation"),
    collectionValidationTitle: document.getElementById("collectionValidationTitle"),
    collectionValidationSummary: document.getElementById("collectionValidationSummary"),
    collectionValidationBadge: document.getElementById("collectionValidationBadge"),
    collectionValidationContent: document.getElementById("collectionValidationContent"),
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
    physicalCollectionsSection: document.getElementById("physicalCollectionsSection"),
    physicalCollectionsSummary: document.getElementById("physicalCollectionsSummary"),
    physicalCollectionsActions: document.getElementById("physicalCollectionsActions"),
    physicalCollectionsList: document.getElementById("physicalCollectionsList"),

    pgModeBtns: document.querySelectorAll(".mode-btn"),
    pgQuestion: document.getElementById("pgQuestion"),
    pgK: document.getElementById("pgK"),
    pgResult: document.getElementById("pgResult"),
    btnPgRun: document.getElementById("btnPgRun"),

    colEditForm: document.getElementById("colEditForm"),
    editId: document.getElementById("editId"),
    configDefaultsPanel: document.getElementById("configDefaultsPanel"),
    configDefaultsSummary: document.getElementById("configDefaultsSummary"),
    configDefaultsStatus: document.getElementById("configDefaultsStatus"),
    editDisplayName: document.getElementById("editDisplayName"),
    editDescription: document.getElementById("editDescription"),
    editSourcePath: document.getElementById("editSourcePath"),
    editDistanceMetric: document.getElementById("editDistanceMetric"),
    editChunkSize: document.getElementById("editChunkSize"),
    editChunkOverlap: document.getElementById("editChunkOverlap"),
    editRetrievalK: document.getElementById("editRetrievalK"),
    editRetrievalDistanceThreshold: document.getElementById("editRetrievalDistanceThreshold"),
    editEmbeddingModel: document.getElementById("editEmbeddingModel"),
    editEmbeddingProvider: document.getElementById("editEmbeddingProvider"),
    chatLlmStatus: document.getElementById("chatLlmStatus"),
    modelDiscoveryPanel: document.getElementById("modelDiscoveryPanel"),
    modelDiscoverySummary: document.getElementById("modelDiscoverySummary"),
    modelDiscoveryStatus: document.getElementById("modelDiscoveryStatus"),
    embeddingModelSelect: document.getElementById("embeddingModelSelect"),
    btnCancelEdit: document.getElementById("btnCancelEdit"),
    btnSave: document.getElementById("btnSave"),

    btnReindex: document.getElementById("btnReindex"),
    btnDeleteCol: document.getElementById("btnDeleteCol"),
    btnViewHistory: document.getElementById("btnViewHistory"),

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

function adminCollectionValidateUrl(id) {
    return id ? `${API.admin}/collections/${id}/validate` : `${API.admin}/collections/validate`;
}

function adminCollectionPhysicalCollectionsUrl(id) {
    return `${API.admin}/collections/${id}/physical-collections`;
}

function adminJobUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

function adminJobDeleteUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

function adminJobsBulkDeleteUrl() {
    return `${API.admin}/jobs/bulk-delete`;
}

function adminAuthSessionUrl() {
    return `${API.adminAuth}/session`;
}

function adminAuthLoginUrl() {
    return `${API.adminAuth}/login`;
}

function adminAuthLogoutUrl() {
    return `${API.adminAuth}/logout`;
}

function adminAuthActionTokenUrl() {
    return `${API.adminAuth}/action-token`;
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

function adminAuditLogUrl(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit || AUDIT_LOG_LIMIT));
    if (options.cursor) params.set("cursor", options.cursor);
    const collectionValues = Array.isArray(options.collectionIds)
        ? options.collectionIds
        : Array.isArray(options.collectionId)
            ? options.collectionId
            : typeof options.collectionId === "string"
                ? options.collectionId.split(",")
                : [];
    const operationValues = Array.isArray(options.operations)
        ? options.operations
        : Array.isArray(options.operation)
            ? options.operation
            : typeof options.operation === "string"
                ? options.operation.split(",")
                : [];
    normalizeAuditCollectionValues(collectionValues).forEach((collectionId) => {
        params.append("collectionId", collectionId);
    });
    normalizeAuditOperationValues(operationValues).forEach((operation) => {
        params.append("operation", operation);
    });
    const query = params.toString();
    return query ? `${API.admin}/audit-log?${query}` : `${API.admin}/audit-log`;
}

function normalizeAuditSelectionValues(values = [], allowedValues = []) {
    const allowedSet = new Set(allowedValues);
    return [...new Set(
        (Array.isArray(values) ? values : values ? [values] : [])
            .flatMap((value) => String(value).split(","))
            .map((value) => value.trim())
            .filter((value) => value && allowedSet.has(value)),
    )];
}

function getAuditVisibleCollections() {
    return [...state.collections]
        .filter((collection) => collection && collection.status !== "archived")
        .sort((a, b) => {
            const primaryA = isAuditCollectionPrimary(a) ? 0 : 1;
            const primaryB = isAuditCollectionPrimary(b) ? 0 : 1;
            if (primaryA !== primaryB) return primaryA - primaryB;
            const nameA = (a.displayName || a.id || "").toLowerCase();
            const nameB = (b.displayName || b.id || "").toLowerCase();
            if (nameA !== nameB) return nameA.localeCompare(nameB);
            return String(a.id || "").localeCompare(String(b.id || ""));
        });
}

function isAuditCollectionPrimary(collection) {
    return Boolean(collection?.activePhysicalCollection) || collection?.status === "ready";
}

function normalizeAuditCollectionValues(values = []) {
    return normalizeAuditSelectionValues(values, getAuditVisibleCollections().map((collection) => collection.id));
}

function normalizeAuditOperationValues(values = []) {
    return normalizeAuditSelectionValues(values, AUDIT_LOG_OPERATION_OPTIONS.map((option) => option.value));
}

function getAuditCollectionFilterValues() {
    return normalizeAuditCollectionValues(state.auditLogCollectionFilter);
}

function getAuditOperationFilterValues() {
    return normalizeAuditOperationValues(state.auditLogOperationFilter);
}

function setAuditCollectionFilterValues(values) {
    state.auditLogCollectionFilter = normalizeAuditCollectionValues(values);
}

function setAuditOperationFilterValues(values) {
    state.auditLogOperationFilter = normalizeAuditOperationValues(values);
}

function getAuditCollectionSummaryText() {
    const visibleCount = getAuditVisibleCollections().length;
    const selectedCount = getAuditCollectionFilterValues().length;
    if (visibleCount === 0) return "No visible collections";
    if (selectedCount === 0 || selectedCount === visibleCount) return "All visible collections";
    return `${selectedCount} collection${selectedCount === 1 ? "" : "s"} selected`;
}

function getAuditCollectionDetailText() {
    const visibleCount = getAuditVisibleCollections().length;
    const selectedCount = getAuditCollectionFilterValues().length;
    if (visibleCount === 0) {
        return "Load collections to filter audit history.";
    }
    if (selectedCount === 0 || selectedCount === visibleCount) {
        return `${visibleCount} visible collection${visibleCount === 1 ? "" : "s"}`;
    }
    return `${selectedCount} of ${visibleCount} selected`;
}

function getAuditOperationSummaryText() {
    const selectedCount = getAuditOperationFilterValues().length;
    if (selectedCount === 0 || selectedCount === AUDIT_LOG_OPERATION_OPTIONS.length) return "All operations";
    return `${selectedCount} operation${selectedCount === 1 ? "" : "s"} selected`;
}

function getAuditOperationDetailText() {
    const selectedCount = getAuditOperationFilterValues().length;
    if (selectedCount === 0 || selectedCount === AUDIT_LOG_OPERATION_OPTIONS.length) {
        return `${AUDIT_LOG_OPERATION_OPTIONS.length} available operations`;
    }
    return `${selectedCount} of ${AUDIT_LOG_OPERATION_OPTIONS.length} selected`;
}

function renderAuditCollectionPickerList() {
    if (!elements.auditCollectionList) return;
    clearNode(elements.auditCollectionList);

    const search = (elements.auditCollectionSearch?.value || "").trim().toLowerCase();
    const selectedValues = new Set(getAuditCollectionFilterValues());
    const collections = getAuditVisibleCollections().filter((collection) => {
        if (!search) return true;
        return [collection.displayName, collection.id]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
    });

    if (elements.auditCollectionMeta) {
        const totalVisibleCount = getAuditVisibleCollections().length;
        elements.auditCollectionMeta.textContent = totalVisibleCount === 0
            ? "No visible collections are available for this tenant."
            : `${collections.length} visible collection${collections.length === 1 ? "" : "s"} match this search.`;
    }

    if (collections.length === 0) {
        elements.auditCollectionList.appendChild(createEl(
            "div",
            "rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500",
            getAuditVisibleCollections().length === 0 ? "No visible collections are available for this tenant." : "No collections match this search.",
        ));
        return;
    }

    collections.forEach((collection) => {
        const row = createEl(
            "label",
            `flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 shadow-sm transition-colors hover:bg-slate-50 ${isAuditCollectionPrimary(collection) ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`,
        );
        const checkbox = createEl("input", "mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500");
        checkbox.type = "checkbox";
        checkbox.value = collection.id;
        checkbox.checked = selectedValues.has(collection.id);
        checkbox.dataset.auditCollection = collection.id;
        const content = createEl("div", "min-w-0 flex-1");
        const header = createEl("div", "flex flex-wrap items-center gap-2");
        header.appendChild(createEl("div", "break-all-words text-sm font-semibold text-slate-800", collection.displayName || "Unnamed Collection"));
        if (isAuditCollectionPrimary(collection)) {
            header.appendChild(createBadge("Active", getStatusColor("active")));
        }
        content.appendChild(header);
        content.appendChild(createEl("div", "mt-1 break-all font-mono text-xs text-slate-500", collection.id));
        row.appendChild(checkbox);
        row.appendChild(content);
        elements.auditCollectionList.appendChild(row);
    });
}

function renderAuditOperationPickerList() {
    if (!elements.auditOperationList) return;
    clearNode(elements.auditOperationList);

    const search = (elements.auditOperationSearch?.value || "").trim().toLowerCase();
    const selectedValues = new Set(getAuditOperationFilterValues());
    const operations = AUDIT_LOG_OPERATION_OPTIONS.filter((option) => {
        if (!search) return true;
        return [option.label, option.value]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search));
    });

    if (elements.auditOperationMeta) {
        elements.auditOperationMeta.textContent = `${operations.length} operation option${operations.length === 1 ? "" : "s"} match this search.`;
    }

    if (operations.length === 0) {
        elements.auditOperationList.appendChild(createEl("div", "rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500", "No operations match this search."));
        return;
    }

    operations.forEach((option) => {
        const row = createEl("label", "flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition-colors hover:bg-slate-50");
        const checkbox = createEl("input", "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500");
        checkbox.type = "checkbox";
        checkbox.value = option.value;
        checkbox.checked = selectedValues.has(option.value);
        checkbox.dataset.auditOperation = option.value;
        const content = createEl("div", "min-w-0 flex-1");
        content.appendChild(createEl("div", "break-all-words text-sm font-semibold text-slate-800", option.label));
        content.appendChild(createEl("div", "mt-1 break-all font-mono text-xs text-slate-500", option.value));
        row.appendChild(checkbox);
        row.appendChild(content);
        elements.auditOperationList.appendChild(row);
    });
}

function renderAuditFilterControls() {
    if (elements.auditCollectionSummary) {
        elements.auditCollectionSummary.textContent = getAuditCollectionSummaryText();
    }
    if (elements.auditCollectionDetail) {
        elements.auditCollectionDetail.textContent = getAuditCollectionDetailText();
    }
    if (elements.auditOperationSummary) {
        elements.auditOperationSummary.textContent = getAuditOperationSummaryText();
    }
    if (elements.auditOperationDetail) {
        elements.auditOperationDetail.textContent = getAuditOperationDetailText();
    }

    renderAuditCollectionPickerList();
    renderAuditOperationPickerList();
    updateAuditLogControls();
}

function openAuditPicker(panelElement, triggerElement) {
    if (!panelElement || !triggerElement) return;
    panelElement.classList.remove("hidden");
    triggerElement.setAttribute("aria-expanded", "true");
}

function closeAuditPicker(panelElement, triggerElement) {
    if (!panelElement || !triggerElement) return;
    panelElement.classList.add("hidden");
    triggerElement.setAttribute("aria-expanded", "false");
}

function toggleAuditPicker(panelElement, triggerElement) {
    if (!panelElement || !triggerElement) return;
    if (panelElement.classList.contains("hidden")) {
        if (panelElement === elements.auditCollectionPanel) {
            closeAuditPicker(elements.auditOperationPanel, elements.auditOperationToggle);
        } else if (panelElement === elements.auditOperationPanel) {
            closeAuditPicker(elements.auditCollectionPanel, elements.auditCollectionToggle);
        }
        openAuditPicker(panelElement, triggerElement);
    } else {
        closeAuditPicker(panelElement, triggerElement);
    }
}

function closeAuditPickers() {
    closeAuditPicker(elements.auditCollectionPanel, elements.auditCollectionToggle);
    closeAuditPicker(elements.auditOperationPanel, elements.auditOperationToggle);
}

function syncAuditLogFilterInputs() {
    renderAuditFilterControls();
}

function normalizeModelList(models) {
    return [...new Set(
        (Array.isArray(models) ? models : [])
            .filter((value) => typeof value === "string" && value.trim() !== "")
            .map((value) => value.trim()),
    )];
}

function emptyModelDiscovery() {
    return {
        loaded: false,
        defaultProvider: "",
        defaultModel: "",
        builtinModels: [],
        external: { configured: false, baseUrl: "", reachable: false, models: [], error: "" },
    };
}

/** The provider the editor is about to use: the selected one, else the backend default. */
function selectedEmbeddingProvider() {
    return elements.editEmbeddingProvider?.value || state.modelDiscovery.defaultProvider || "builtin";
}

// Embedding provider and model are chosen per collection; the chat LLM is global (see renderChatLlmStatus).
function getModelDiscoveryFieldConfig(_kind) {
    const provider = selectedEmbeddingProvider();
    return {
        input: elements.editEmbeddingModel,
        select: elements.embeddingModelSelect,
        models: provider === "builtin" ? state.modelDiscovery.builtinModels : state.modelDiscovery.external.models,
    };
}

function syncModelSelect(kind) {
    const config = getModelDiscoveryFieldConfig(kind);
    if (!config.select || !config.input) return;

    const currentValue = config.input.value.trim();
    const models = normalizeModelList(config.models);

    clearNode(config.select);

    const placeholder = createEl("option");
    placeholder.value = "";
    placeholder.textContent = currentValue ? `Current: ${currentValue}` : "Select a model or type manually";
    config.select.appendChild(placeholder);

    models.forEach((model) => {
        const option = createEl("option");
        option.value = model;
        option.textContent = model;
        config.select.appendChild(option);
    });

    config.select.value = models.includes(currentValue) ? currentValue : "";
}

function setModelFromSelect(kind) {
    const config = getModelDiscoveryFieldConfig(kind);
    if (!config.input || !config.select) return;
    config.input.value = config.select.value;
    syncModelDiscoveryPanel();
}

function syncModelDiscoveryPanel() {
    if (!elements.modelDiscoveryPanel) return;

    const discovery = state.modelDiscovery;
    const provider = selectedEmbeddingProvider();
    const external = discovery.external;
    const online = provider === "builtin" ? discovery.loaded : external.configured && external.reachable;

    if (elements.modelDiscoveryStatus) {
        elements.modelDiscoveryStatus.textContent = online ? "Available" : provider === "builtin" ? "Loading" : external.configured ? "Offline" : "Not configured";
        elements.modelDiscoveryStatus.className = online
            ? "rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700"
            : "rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700";
    }

    if (elements.modelDiscoverySummary) {
        const defaultText = discovery.defaultProvider
            ? `Default for new collections: ${discovery.defaultProvider} / ${discovery.defaultModel}.`
            : "";
        let providerText;
        if (provider === "builtin") {
            providerText = `builtin: ${discovery.builtinModels.length} built-in model(s), run inside the backend and downloaded on first use.`;
        } else if (!external.configured) {
            providerText = "openai-compatible: no embedding service configured (set embedding.baseUrl with npm run onboard or RAG_EMBEDDING_BASE_URL).";
        } else if (!external.reachable) {
            providerText = `openai-compatible: ${external.baseUrl} is not reachable${external.error ? ` (${external.error})` : ""}.`;
        } else {
            providerText = `openai-compatible: ${external.models.length} model(s) at ${external.baseUrl}.`;
        }
        elements.modelDiscoverySummary.textContent = `${providerText} ${defaultText}`.trim();
    }

    syncModelSelect("embedding");
}

function describeChatLlm(chat) {
    if (!chat) return "Chat LLM status unavailable.";
    if (!chat.enabled) return "Not configured: Query is disabled (retrieve-only).";
    return `${chat.model} @ ${chat.baseUrl}${chat.apiKeyConfigured ? " (API key set)" : ""}`;
}

function renderChatLlmStatus() {
    if (!elements.chatLlmStatus) return;
    elements.chatLlmStatus.textContent = state.configDefaults.loaded
        ? describeChatLlm(state.configDefaults.chat)
        : "Loading GET /v1/admin/config/defaults...";
}

function formatConfigDefault(value) {
    if (value === undefined || value === null || value === "") return "-";
    return String(value);
}

function setCreateFieldDefault(field, value) {
    const helper = document.querySelector(`[data-default-for="${field}"]`);
    if (helper) helper.textContent = value;
}

function syncConfigDefaultsPanel() {
    renderChatLlmStatus();
    if (!elements.configDefaultsPanel) return;

    const isCreateMode = !elements.editId.value;
    elements.configDefaultsPanel.classList.toggle("hidden", !isCreateMode);

    const clearHelpers = () => {
        ["sourcePath", "distanceMetric", "chunkSize", "chunkOverlap", "retrievalK", "retrievalDistanceThreshold", "embeddingProvider", "embeddingModel"].forEach((field) => {
            setCreateFieldDefault(field, "Backend default unavailable");
        });
        if (elements.editSourcePath) elements.editSourcePath.placeholder = "";
        if (elements.editChunkSize) elements.editChunkSize.placeholder = "";
        if (elements.editChunkOverlap) elements.editChunkOverlap.placeholder = "";
        if (elements.editRetrievalK) elements.editRetrievalK.placeholder = "";
        if (elements.editRetrievalDistanceThreshold) elements.editRetrievalDistanceThreshold.placeholder = "";
        if (elements.editEmbeddingModel) elements.editEmbeddingModel.placeholder = "";
        const placeholder = elements.editDistanceMetric?.querySelector('option[value=""]');
        if (placeholder) placeholder.textContent = "Use backend default";
    };

    if (!isCreateMode) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Hidden";
            elements.configDefaultsStatus.className = "rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "";
        }
        clearHelpers();
        return;
    }

    const collectionDefaults = state.configDefaults.collectionDefaults;
    const modelDefaults = state.configDefaults.modelDefaults;

    if (!state.configDefaults.loaded) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Loading";
            elements.configDefaultsStatus.className = "rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "Loading GET /v1/admin/config/defaults...";
        }
        clearHelpers();
        return;
    }

    if (!collectionDefaults || !modelDefaults) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Unavailable";
            elements.configDefaultsStatus.className = "rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "GET /v1/admin/config/defaults is unavailable right now.";
        }
        clearHelpers();
        return;
    }

    const summaryParts = [
        `Source path: ${formatConfigDefault(collectionDefaults.sourcePath)}`,
        `Distance metric: ${formatConfigDefault(collectionDefaults.distanceMetric)}`,
        `Chunk size/overlap: ${formatConfigDefault(collectionDefaults.chunkSize)}/${formatConfigDefault(collectionDefaults.chunkOverlap)}`,
        `Retrieval K: ${formatConfigDefault(collectionDefaults.retrievalK)}`,
        `Threshold: ${formatConfigDefault(collectionDefaults.retrievalDistanceThreshold)}`,
        `Embedding: ${formatConfigDefault(modelDefaults.embeddingProvider)} / ${formatConfigDefault(modelDefaults.embeddingModel)}`,
        `Chat LLM: ${describeChatLlm(state.configDefaults.chat)}`,
    ];

    if (elements.configDefaultsStatus) {
        elements.configDefaultsStatus.textContent = "Loaded";
        elements.configDefaultsStatus.className = "rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700";
    }
    if (elements.configDefaultsSummary) {
        elements.configDefaultsSummary.textContent = summaryParts.join(" | ");
    }

    setCreateFieldDefault("sourcePath", `Backend default: ${formatConfigDefault(collectionDefaults.sourcePath)}`);
    setCreateFieldDefault("distanceMetric", `Backend default: ${formatConfigDefault(collectionDefaults.distanceMetric)}`);
    setCreateFieldDefault("chunkSize", `Backend default: ${formatConfigDefault(collectionDefaults.chunkSize)}`);
    setCreateFieldDefault("chunkOverlap", `Backend default: ${formatConfigDefault(collectionDefaults.chunkOverlap)}`);
    setCreateFieldDefault("retrievalK", `Backend default: ${formatConfigDefault(collectionDefaults.retrievalK)}`);
    setCreateFieldDefault("retrievalDistanceThreshold", `Backend default: ${formatConfigDefault(collectionDefaults.retrievalDistanceThreshold)}`);
    setCreateFieldDefault("embeddingProvider", `Backend default: ${formatConfigDefault(modelDefaults.embeddingProvider)}`);
    setCreateFieldDefault("embeddingModel", `Backend default: ${formatConfigDefault(modelDefaults.embeddingModel)}`);

    if (elements.editSourcePath) elements.editSourcePath.placeholder = formatConfigDefault(collectionDefaults.sourcePath);
    if (elements.editChunkSize) elements.editChunkSize.placeholder = String(formatConfigDefault(collectionDefaults.chunkSize));
    if (elements.editChunkOverlap) elements.editChunkOverlap.placeholder = String(formatConfigDefault(collectionDefaults.chunkOverlap));
    if (elements.editRetrievalK) elements.editRetrievalK.placeholder = String(formatConfigDefault(collectionDefaults.retrievalK));
    if (elements.editRetrievalDistanceThreshold) elements.editRetrievalDistanceThreshold.placeholder = String(formatConfigDefault(collectionDefaults.retrievalDistanceThreshold));
    if (elements.editEmbeddingModel) elements.editEmbeddingModel.placeholder = formatConfigDefault(modelDefaults.embeddingModel);

    const placeholder = elements.editDistanceMetric?.querySelector('option[value=""]');
    if (placeholder) placeholder.textContent = `Use backend default (${formatConfigDefault(collectionDefaults.distanceMetric)})`;
}

async function loadConfigDefaults() {
    const token = ++loadTokens.configDefaults;
    try {
        const data = await apiRequest(`${API.admin}/config/defaults`);
        if (token !== loadTokens.configDefaults) return;
        state.configDefaults = {
            loaded: true,
            collectionDefaults: {
                sourcePath: typeof data?.collectionDefaults?.sourcePath === "string" ? data.collectionDefaults.sourcePath : "",
                distanceMetric: typeof data?.collectionDefaults?.distanceMetric === "string" ? data.collectionDefaults.distanceMetric : "",
                chunkSize: Number.isFinite(data?.collectionDefaults?.chunkSize) ? data.collectionDefaults.chunkSize : "",
                chunkOverlap: Number.isFinite(data?.collectionDefaults?.chunkOverlap) ? data.collectionDefaults.chunkOverlap : "",
                retrievalK: Number.isFinite(data?.collectionDefaults?.retrievalK) ? data.collectionDefaults.retrievalK : "",
                retrievalDistanceThreshold: Number.isFinite(data?.collectionDefaults?.retrievalDistanceThreshold) ? data.collectionDefaults.retrievalDistanceThreshold : "",
            },
            modelDefaults: {
                embeddingProvider: typeof data?.modelDefaults?.embeddingProvider === "string" ? data.modelDefaults.embeddingProvider : "",
                embeddingModel: typeof data?.modelDefaults?.embeddingModel === "string" ? data.modelDefaults.embeddingModel : "",
            },
            chat: {
                enabled: data?.chat?.enabled === true,
                baseUrl: typeof data?.chat?.baseUrl === "string" ? data.chat.baseUrl : "",
                model: typeof data?.chat?.model === "string" ? data.chat.model : "",
                apiKeyConfigured: data?.chat?.apiKeyConfigured === true,
            },
        };
    } catch (_error) {
        if (token !== loadTokens.configDefaults) return;
        state.configDefaults = {
            loaded: true,
            collectionDefaults: null,
            modelDefaults: null,
            chat: null,
        };
    }

    if (token === loadTokens.configDefaults) {
        syncConfigDefaultsPanel();
        renderChatLlmStatus();
    }
}

async function loadModelDiscovery() {
    const token = ++loadTokens.modelDiscovery;
    try {
        const data = await apiRequest(`${API.admin}/models`);
        if (token !== loadTokens.modelDiscovery) return;
        const external = data?.providers?.["openai-compatible"] || {};
        state.modelDiscovery = {
            loaded: true,
            defaultProvider: typeof data?.default?.provider === "string" ? data.default.provider : "",
            defaultModel: typeof data?.default?.model === "string" ? data.default.model : "",
            builtinModels: normalizeModelList(data?.providers?.builtin?.models),
            external: {
                configured: external.configured === true,
                baseUrl: typeof external.baseUrl === "string" ? external.baseUrl : "",
                reachable: external.reachable === true,
                models: normalizeModelList(external.models),
                error: typeof external.error === "string" ? external.error : "",
            },
        };
    } catch (_error) {
        if (token !== loadTokens.modelDiscovery) return;
        state.modelDiscovery = emptyModelDiscovery();
    }

    if (token === loadTokens.modelDiscovery) syncModelDiscoveryPanel();
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

function formatDurationSeconds(value) {
    if (value === null || value === undefined || value === "") return "-";
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return String(value);
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    const wholeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainderSeconds = wholeSeconds % 60;
    if (minutes < 60) return `${minutes} min ${remainderSeconds} sec`;
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return `${hours} hr ${remainderMinutes} min`;
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
        info: "bg-sky-100 text-sky-700",
        ok: "bg-emerald-100 text-emerald-700",
        degraded: "bg-amber-100 text-amber-700",
        inaccessible: "bg-slate-100 text-slate-600",
        muted: "bg-slate-100 text-slate-600",
        active: "bg-emerald-100 text-emerald-700",
        building: "bg-blue-100 text-blue-700",
        delete_pending: "bg-amber-100 text-amber-700",
        cleanup_failed: "bg-rose-100 text-rose-700",
        failed_build: "bg-rose-100 text-rose-700",
        retired: "bg-slate-100 text-slate-600",
        deleted: "bg-slate-100 text-slate-600",
    };
    return colors[status] || "bg-slate-100 text-slate-600";
}

function getStatusBadge(status) {
    return createBadge(status || "unknown", getStatusColor(status));
}

function getCollectionCardStatusPresentation(status, indexState = null) {
    if (status === "indexing") {
        return {
            label: "Indexing in progress",
            note: "The collection is building a fresh index right now.",
            tone: "info",
        };
    }

    if (status === "creating") {
        return {
            label: "Indexing required",
            note: "No active index yet. Open details to re-index.",
            tone: "warn",
        };
    }

    if (status === "failed") {
        return {
            label: "Indexing failed",
            note: "Open details to inspect the latest error.",
            tone: "fail",
        };
    }

    if (status === "archived") {
        return {
            label: "Archived",
            note: "This collection is archived and not active.",
            tone: "muted",
        };
    }

    const normalizedIndexState = isRecord(indexState) ? indexState : null;
    if (!normalizedIndexState) {
        return {
            label: "Index state unavailable",
            note: "Backend did not provide a persisted index snapshot yet. Restart the backend after deploying the schema change.",
            tone: "warn",
        };
    }

    if (normalizedIndexState?.status === "no_active_index") {
        return {
            label: "Indexing required",
            note: normalizedIndexState.note || "No active index yet. Open details to re-index.",
            tone: "warn",
        };
    }

    if (normalizedIndexState?.reindexRequired) {
        return {
            label: "Re-index required",
            note: normalizedIndexState.note || "Saved settings differ from the active indexed snapshot.",
            tone: "warn",
        };
    }

    return {
        label: "Ready",
        note: normalizedIndexState?.note || "Saved settings are synced with the active index.",
        tone: "ok",
    };
}

function getCollectionCardStatusBadge(status, indexState = null) {
    const presentation = getCollectionCardStatusPresentation(status, indexState);
    return createBadge(presentation.label, getStatusColor(presentation.tone || status));
}

function getCollectionCardStatusNote(status, indexState = null) {
    const presentation = getCollectionCardStatusPresentation(status, indexState);
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

function normalizeRequestPath(url) {
    try {
        return new URL(url, window.location.origin).pathname;
    } catch {
        return String(url || "");
    }
}

function isRagRequest(url) {
    return normalizeRequestPath(url).startsWith(`${API.rag}/`);
}

function getSessionHeadersForRequest(url) {
    if (!state.auth.session || !isRagRequest(url)) {
        return {};
    }
    return {
        "x-tenant-id": state.auth.session.tenantId,
        "x-user-id": state.auth.session.username,
    };
}

async function apiRequest(url, options = {}) {
    const body = options.body;
    const headers = {
        Accept: "application/json",
        ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        ...getSessionHeadersForRequest(url),
    };

    try {
        const fetchOptions = { credentials: options.credentials || "same-origin", ...options, headers };
        if (!fetchOptions.method || fetchOptions.method === "GET") {
            fetchOptions.cache = fetchOptions.cache || "no-store";
        }
        const response = await fetch(url, fetchOptions);
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

function getAdminSessionSummary() {
    return state.auth.session;
}

function setAdminSession(session, enabled = state.auth.enabled) {
    state.auth.enabled = Boolean(enabled);
    state.auth.authenticated = Boolean(session);
    state.auth.session = session || null;
    state.auth.error = null;
    syncAuthChrome();
}

function clearAdminSession() {
    state.auth.authenticated = false;
    state.auth.session = null;
    syncAuthChrome();
}

function syncAuthChrome() {
    const session = state.auth.session;
    if (elements.authStatus) {
        elements.authStatus.textContent = state.auth.loading
            ? "Checking session..."
            : state.auth.enabled
                ? (state.auth.authenticated ? "Authenticated" : "Authentication required")
                : "Auth disabled";
    }
    if (elements.authError) {
        if (state.auth.error) {
            elements.authError.textContent = state.auth.error;
            elements.authError.classList.remove("hidden");
        } else {
            elements.authError.textContent = "";
            elements.authError.classList.add("hidden");
        }
    }
    if (elements.authSessionSummary) {
        elements.authSessionSummary.textContent = session
            ? `${session.username} on ${session.tenantId}`
            : state.auth.enabled
                ? "No active admin session"
                : "Admin auth is disabled";
    }
    if (elements.authSessionRole) {
        elements.authSessionRole.textContent = session?.role || "-";
    }
    if (elements.authSessionTenant) {
        elements.authSessionTenant.textContent = session?.tenantId || "-";
    }
    if (elements.authSessionExpiry) {
        elements.authSessionExpiry.textContent = session?.expiresAt ? formatDateTime(session.expiresAt) : "-";
    }
    if (elements.authBadge) {
        elements.authBadge.textContent = state.auth.authenticated && session
            ? `${session.role} - ${session.username}`
            : state.auth.enabled
                ? "Signed out"
                : "Auth off";
    }
    if (elements.authLogoutButton) {
        elements.authLogoutButton.disabled = !state.auth.authenticated;
    }
    if (elements.btnCreateCollection) {
        const allowed = canAdminAction("createCollection");
        elements.btnCreateCollection.disabled = !allowed;
        if (!allowed) {
            elements.btnCreateCollection.title = state.auth.enabled
                ? "Create collection requires operator access."
                : "Create collection";
        } else {
            elements.btnCreateCollection.removeAttribute("title");
        }
    }
    syncSaveButtonAccess();
}

function shouldPromptForLogin() {
    return state.auth.enabled && !state.auth.authenticated;
}

function setDashboardVisible(visible) {
    if (elements.dashboardShell) {
        elements.dashboardShell.classList.toggle("hidden", !visible);
    }
    if (elements.authShell) {
        elements.authShell.classList.toggle("hidden", visible);
    }
}

function resetAuthForm() {
    if (elements.authPassword) elements.authPassword.value = "";
}

function normalizeAdminActionPath(url) {
    return normalizeRequestPath(url);
}

function canAdminAction(capability) {
    if (!state.auth.enabled) {
        return true;
    }
    const role = state.auth.session?.role;
    if (!role) {
        return false;
    }
    const permissions = {
        viewer: ["read"],
        operator: ["read", "createCollection", "validateCollection", "updateCollection", "reindexCollection", "cancelJob"],
        admin: ["read", "createCollection", "validateCollection", "updateCollection", "reindexCollection", "cancelJob", "deleteCollection", "deleteJob", "bulkDeleteJobs"],
    };
    return (permissions[role] || []).includes(capability);
}

async function requestAdminActionToken(method, path) {
    if (!state.auth.enabled || !state.auth.authenticated) {
        return null;
    }
    const data = await apiRequest(adminAuthActionTokenUrl(), {
        method: "POST",
        body: JSON.stringify({ method, path }),
    });
    return data?.actionToken || null;
}

async function adminMutationRequest(url, options = {}) {
    const method = (options.method || "POST").toUpperCase();
    const token = await requestAdminActionToken(method, normalizeAdminActionPath(url));
    const headers = { ...(options.headers || {}) };
    if (token) {
        headers["x-admin-action-token"] = token;
    }
    return apiRequest(url, {
        ...options,
        method,
        headers,
    });
}

async function loadAdminSession() {
    state.auth.loading = true;
    state.auth.error = null;
    syncAuthChrome();
    try {
        const data = await apiRequest(adminAuthSessionUrl());
        state.auth.enabled = Boolean(data?.enabled);
        if (data?.authenticated && data?.session) {
            setAdminSession(data.session, data.enabled);
            return true;
        }
        setAdminSession(null, data?.enabled);
        return !data?.enabled;
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status === 401 || normalized.code === "UNAUTHORIZED") {
            state.auth.enabled = true;
            clearAdminSession();
            return false;
        }
        state.auth.error = normalized.message;
        syncAuthChrome();
        throw error;
    } finally {
        state.auth.loading = false;
        syncAuthChrome();
    }
}

async function loginAdmin(event) {
    event?.preventDefault?.();
    const username = elements.authUsername?.value.trim();
    const password = elements.authPassword?.value || "";
    if (!username || !password) {
        state.auth.error = "Username and password are required.";
        syncAuthChrome();
        return;
    }

    try {
        setButtonLoading(elements.authLoginButton, true, "Signing in...");
        const data = await apiRequest(adminAuthLoginUrl(), {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        if (!data?.session) {
            throw normalizeError(null, { status: 0, code: "INVALID_AUTH_RESPONSE", message: "Admin login response did not include session." });
        }
        state.auth.enabled = true;
        setAdminSession(data.session, true);
        resetAuthForm();
        resetDashboardState();
        setDashboardVisible(true);
        await initializeDashboard();
    } catch (error) {
        const normalized = normalizeError(error);
        state.auth.error = normalized.status === 401 ? "Invalid username or password." : normalized.message;
        syncAuthChrome();
    } finally {
        setButtonLoading(elements.authLoginButton, false, "Sign in");
    }
}

async function logoutAdmin() {
    try {
        setButtonLoading(elements.authLogoutButton, true, "Signing out...");
        await apiRequest(adminAuthLogoutUrl(), { method: "POST" });
    } catch (error) {
        console.warn("Logout failed", error);
    } finally {
        clearAdminSession();
        resetAuthForm();
        stopDashboardPolling();
        resetDashboardState();
        setDashboardVisible(false);
        syncAuthChrome();
        if (!state.auth.enabled) {
            setDashboardVisible(true);
            await initializeDashboard();
        }
        setButtonLoading(elements.authLogoutButton, false, "Sign out");
    }
}

let dashboardPollingHandles = [];

function stopDashboardPolling() {
    for (const handle of dashboardPollingHandles) {
        clearInterval(handle);
    }
    dashboardPollingHandles = [];
}

function startDashboardPolling() {
    if (dashboardPollingHandles.length > 0) {
        return;
    }

    dashboardPollingHandles.push(setInterval(() => {
        if (!document.hidden) loadJobs();
    }, 10000));

    dashboardPollingHandles.push(setInterval(() => {
        if (!document.hidden) loadCollections();
    }, 10000));

    dashboardPollingHandles.push(setInterval(() => {
        if (!document.hidden && state.selectedCollection) updateReadinessTab();
    }, 10000));

    dashboardPollingHandles.push(setInterval(() => {
        if (!document.hidden) loadHealth();
    }, 30000));
}

function resetDashboardState() {
    state.currentView = "collections";
    state.activeTab = "ready";
    state.collections = [];
    state.selectedCollection = null;
    state.selectedReadiness = null;
    state.selectedPhysicalCollections = null;
    state.selectedPhysicalCollectionsError = null;
    state.jobList = [];
    state.jobListSource = "local";
    state.jobListNextCursor = null;
    state.jobListCursor = null;
    state.jobListCursorStack = [];
    state.jobListError = null;
    state.auditLog = [];
    state.auditLogError = null;
    state.auditLogCollectionFilter = [];
    state.auditLogOperationFilter = [];
    state.auditLogNextCursor = null;
    state.auditLogCursor = null;
    state.auditLogCursorStack = [];
    state.selectedJobIds = new Set();
    state.editorInitialSnapshot = null;
    state.collectionError = null;
    state.healthStatus = null;
    state.readiness = null;
    state.readinessDetails = null;
    state.healthLastUpdatedAt = null;
    state.isLoading = {
        collections: false,
        collectionDetail: false,
        jobs: false,
        health: false,
        readiness: false,
        physicalCollections: false,
        auditLog: false,
    };
    clearNode(elements.collectionsGrid);
    clearNode(elements.jobsTableBody);
    clearNode(elements.auditLogTableBody);
    clearNode(elements.healthGrid);
    clearNode(elements.readinessDetail);
    clearNode(elements.readinessStatusGrid);
    clearNode(elements.blockerList);
    clearNode(elements.warningList);
    clearNode(elements.physicalCollectionsSummary);
    clearNode(elements.physicalCollectionsActions);
    clearNode(elements.physicalCollectionsList);
    clearNode(elements.pgResult);
    clearNode(elements.configDefaultsSummary);
    clearNode(elements.modelDiscoverySummary);
    clearNode(elements.collectionIndexStateContent);
    clearNode(elements.collectionValidationContent);
}

async function initializeDashboard() {
    resetDashboardState();
    renderAuditFilterControls();
    switchView("collections");
    setPlaygroundMode("retrieve");
    resetReadinessAndPlayground("Select a collection to inspect readiness.");
    renderJobs();
    loadConfigDefaults();
    loadModelDiscovery();
    loadCollections();
    loadJobs();
    loadHealth();
    startDashboardPolling();
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

const VALIDATION_FIELD_LABELS = {
    displayName: "Display name",
    description: "Description",
    sourcePath: "Source path",
    distanceMetric: "Distance metric",
    chunkSize: "Chunk size",
    chunkOverlap: "Chunk overlap",
    retrievalK: "Retrieval k",
    retrievalDistanceThreshold: "Retrieval distance threshold",
    embeddingProvider: "Embedding provider",
    embeddingModel: "Embedding model",
};

function formatValidationFieldLabel(field) {
    return VALIDATION_FIELD_LABELS[field] || field;
}

const VALIDATION_DEPENDENCY_BLOCKERS = new Set([
    "CHROMA_UNREACHABLE",
    "EMBEDDING_PROVIDER_UNREACHABLE",
    "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE",
]);

function isDependencyBlocker(issue) {
    return isRecord(issue) && VALIDATION_DEPENDENCY_BLOCKERS.has(issue.code);
}

function hasDependencyBlocker(issues) {
    return Array.isArray(issues) && issues.some((issue) => isDependencyBlocker(issue));
}

function renderValidationImpact(parent, impact) {
    if (!isRecord(impact)) return false;
    const immediateFields = Array.isArray(impact.immediateFields) ? impact.immediateFields : [];
    const reindexFields = Array.isArray(impact.reindexFields) ? impact.reindexFields : [];
    const reindexRequired = impact.reindexRequired === true;
    const hasVisibleImpact = reindexRequired || immediateFields.length > 0 || reindexFields.length > 0 || Boolean(impact.note);

    if (!hasVisibleImpact) return false;

    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Change Impact"));

    const banner = createEl(
        "div",
        `rounded-lg border p-3 text-xs ${reindexRequired ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"}`,
    );
    banner.appendChild(createEl("div", "font-semibold", reindexRequired ? "Re-index required" : "Immediate effect"));
    if (impact.note) {
        banner.appendChild(createEl("div", "mt-1 break-all-words", impact.note));
    }
    section.appendChild(banner);

    if (immediateFields.length > 0) {
        const row = createEl("div", "mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700");
        row.appendChild(createEl("div", "font-semibold text-slate-600", "Takes effect immediately"));
        const container = createEl("div", "mt-2 flex flex-wrap gap-2");
        row.appendChild(container);
        immediateFields.forEach((field) => {
            container.appendChild(createBadge(formatValidationFieldLabel(field), getStatusColor("info")));
        });
        section.appendChild(row);
    }

    if (reindexFields.length > 0) {
        const row = createEl("div", "mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700");
        row.appendChild(createEl("div", "font-semibold text-slate-600", "Requires re-index"));
        const container = createEl("div", "mt-2 flex flex-wrap gap-2");
        row.appendChild(container);
        reindexFields.forEach((field) => {
            container.appendChild(createBadge(formatValidationFieldLabel(field), getStatusColor(reindexRequired ? "warn" : "ok")));
        });
        section.appendChild(row);
    }

    parent.appendChild(section);
    return true;
}

function clearCollectionValidation() {
    if (elements.collectionValidation) {
        elements.collectionValidation.classList.add("hidden");
    }
    clearNode(elements.collectionValidationTitle);
    clearNode(elements.collectionValidationSummary);
    clearNode(elements.collectionValidationBadge);
    clearNode(elements.collectionValidationContent);
}

function clearCollectionIndexStateBanner() {
    if (elements.collectionIndexState) {
        elements.collectionIndexState.classList.add("hidden");
    }
    clearNode(elements.collectionIndexStateTitle);
    clearNode(elements.collectionIndexStateSummary);
    clearNode(elements.collectionIndexStateBadge);
    clearNode(elements.collectionIndexStateContent);
}

function renderCollectionIndexStateBanner() {
    if (!elements.collectionIndexState || !state.selectedCollection) {
        clearCollectionIndexStateBanner();
        return;
    }

    const collection = state.selectedCollection;
    const readiness = state.selectedReadiness;
    const indexState = isRecord(collection.indexState) ? collection.indexState : null;
    const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
    const dependencyDown = hasDependencyBlocker(blockers);
    const activeJob = readiness?.activeJob;
    const hasActiveJob = Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "running"));
    const isIndexing = hasActiveJob || collection.status === "indexing";
    const changedFields = Array.isArray(indexState?.changedFields) ? indexState.changedFields : [];

    let title = "Immediate effect / synced";
    let badgeLabel = "SYNCED";
    let badgeTone = "ok";
    let summary = indexState?.note || "Saved settings are aligned with the active indexed snapshot.";

    if (dependencyDown) {
        title = "Backend dependency down";
        badgeLabel = "DEPENDENCY DOWN";
        badgeTone = "fail";
        summary = "Chroma or the embedding service is unavailable. Re-index and playground actions should wait until the dependency is healthy.";
    } else if (isIndexing) {
        title = "Indexing in progress";
        badgeLabel = "INDEXING";
        badgeTone = "info";
        summary = activeJob
            ? `Active job ${shortId(activeJob.id)} is ${activeJob.status}.`
            : "The collection is currently indexing.";
    } else if (!indexState) {
        title = "Index state unavailable";
        badgeLabel = "UNKNOWN";
        badgeTone = "warn";
        summary = "Backend did not return a persisted index snapshot. Restart the backend after deploying the schema change.";
    } else if (indexState.status === "no_active_index") {
        title = "Indexing required";
        badgeLabel = "INDEXING REQUIRED";
        badgeTone = "warn";
        summary = indexState.note || "No active index exists yet. Open details to re-index.";
    } else if (indexState?.reindexRequired) {
        title = "Re-index required";
        badgeLabel = "RE-INDEX REQUIRED";
        badgeTone = "warn";
        summary = indexState.note || "Saved settings differ from the active indexed snapshot.";
    } else if (indexState?.status === "synced") {
        title = "Immediate effect / synced";
        badgeLabel = "SYNCED";
        badgeTone = "ok";
        summary = indexState.note || "Saved settings are aligned with the active indexed snapshot.";
    }

    elements.collectionIndexState.classList.remove("hidden");
    clearNode(elements.collectionIndexStateTitle);
    elements.collectionIndexStateTitle.appendChild(createEl("span", "", title));
    clearNode(elements.collectionIndexStateSummary);
    elements.collectionIndexStateSummary.appendChild(createEl("span", "", summary));
    clearNode(elements.collectionIndexStateBadge);
    elements.collectionIndexStateBadge.appendChild(createBadge(badgeLabel, getStatusColor(badgeTone)));

    clearNode(elements.collectionIndexStateContent);
    const detail = createEl("div", "rounded-lg border border-slate-100 bg-white p-3 text-xs text-slate-700");
    detail.appendChild(createEl("div", "font-semibold text-slate-800", "Index snapshot"));
    detail.appendChild(createEl("div", "mt-1 break-all-words text-slate-500", indexState?.note || "Ground truth is provided by the backend index state."));

    const snapshotGrid = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2");
    snapshotGrid.appendChild(createMetaItem("Saved source path", indexState?.desiredSnapshot?.sourcePath ?? collection.sourcePath));
    snapshotGrid.appendChild(createMetaItem("Saved chunk size", indexState?.desiredSnapshot?.chunkSize ?? collection.chunkSize));
    snapshotGrid.appendChild(createMetaItem("Saved chunk overlap", indexState?.desiredSnapshot?.chunkOverlap ?? collection.chunkOverlap));
    snapshotGrid.appendChild(createMetaItem(
        "Saved embedding",
        `${indexState?.desiredSnapshot?.embeddingProvider ?? collection.embeddingProvider ?? "-"} / ${indexState?.desiredSnapshot?.embeddingModel ?? collection.embeddingModel}`,
    ));
    snapshotGrid.appendChild(createMetaItem("Saved distance metric", indexState?.desiredSnapshot?.distanceMetric ?? collection.distanceMetric));

    detail.appendChild(snapshotGrid);

    if (indexState?.activeSnapshot) {
        const activeSection = createEl("div", "mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700");
        activeSection.appendChild(createEl("div", "font-semibold text-slate-800", "Active indexed snapshot"));
        const activeGrid = createEl("div", "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2");
        activeGrid.appendChild(createMetaItem("Active source path", indexState.activeSnapshot.sourcePath));
        activeGrid.appendChild(createMetaItem("Active chunk size", indexState.activeSnapshot.chunkSize));
        activeGrid.appendChild(createMetaItem("Active chunk overlap", indexState.activeSnapshot.chunkOverlap));
        activeGrid.appendChild(createMetaItem("Active embedding", `${indexState.activeSnapshot.embeddingProvider} / ${indexState.activeSnapshot.embeddingModel}`));
        activeGrid.appendChild(createMetaItem("Active distance metric", indexState.activeSnapshot.distanceMetric));
        activeSection.appendChild(activeGrid);
        detail.appendChild(activeSection);
    }

    if (changedFields.length > 0) {
        const fieldSection = createEl("div", "mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800");
        fieldSection.appendChild(createEl("div", "font-semibold", indexState?.status === "no_active_index" ? "Pending index fields" : "Fields requiring re-index"));
        const fieldWrap = createEl("div", "mt-2 flex flex-wrap gap-2");
        changedFields.forEach((field) => {
            fieldWrap.appendChild(createBadge(formatValidationFieldLabel(field), getStatusColor("warn")));
        });
        fieldSection.appendChild(fieldWrap);
        detail.appendChild(fieldSection);
    }

    if (dependencyDown && blockers.length > 0) {
        const blockerSection = createEl("div", "mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-800");
        blockerSection.appendChild(createEl("div", "font-semibold", "Dependency blockers"));
        const list = createEl("ul", "mt-2 list-disc space-y-1 pl-4");
        blockers.forEach((issue) => {
            const row = createEl("li", "", isRecord(issue) ? `${issue.code || "BLOCKER"}: ${issue.message || stringifyForDisplay(issue)}` : stringifyForDisplay(issue));
            list.appendChild(row);
        });
        blockerSection.appendChild(list);
        detail.appendChild(blockerSection);
    }

    elements.collectionIndexStateContent.appendChild(detail);
}

function renderCollectionValidation(validation, title) {
    if (!elements.collectionValidation || !elements.collectionValidationContent) return;

    const blockers = Array.isArray(validation?.blockers) ? validation.blockers : [];
    const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
    const recommendedActions = Array.isArray(validation?.recommendedActions) ? validation.recommendedActions : [];
    const impact = validation?.impact;
    const dependencyDown = hasDependencyBlocker(blockers);
    const hasImpact = isRecord(impact) && (
        impact.reindexRequired === true ||
        (Array.isArray(impact.immediateFields) && impact.immediateFields.length > 0) ||
        (Array.isArray(impact.reindexFields) && impact.reindexFields.length > 0)
    );

    if (blockers.length === 0 && warnings.length === 0 && recommendedActions.length === 0 && !hasImpact) {
        clearCollectionValidation();
        return;
    }

    clearNode(elements.collectionValidationTitle);
    clearNode(elements.collectionValidationSummary);
    clearNode(elements.collectionValidationBadge);
    clearNode(elements.collectionValidationContent);

    elements.collectionValidation.classList.remove("hidden");
    elements.collectionValidationTitle.appendChild(createEl("span", "", title || "Validation"));

    const hasBlockers = blockers.length > 0;
    const hasWarnings = warnings.length > 0;
    const badgeState = dependencyDown ? "fail" : hasBlockers ? "fail" : hasWarnings ? "warn" : hasImpact && impact?.reindexRequired ? "warn" : hasImpact ? "info" : "ok";
    const badgeLabel = dependencyDown
        ? "DEPENDENCY DOWN"
        : hasBlockers
            ? "BLOCKED"
            : hasWarnings
                ? "WARNINGS"
                : hasImpact && impact?.reindexRequired
                    ? "RE-INDEX REQUIRED"
                    : hasImpact
                        ? "IMMEDIATE EFFECT"
                        : "PASS";
    elements.collectionValidationBadge.appendChild(createBadge(badgeLabel, getStatusColor(badgeState)));

    const summaryText = dependencyDown
        ? "A backend dependency is unavailable. Fix it before saving or re-indexing."
        : hasBlockers
            ? "Blocking issues were found. Fix them before saving or re-indexing."
        : hasWarnings
            ? "Warnings were found. Review them before continuing."
            : hasImpact
                ? (impact?.reindexRequired ? "These changes were saved. Some settings require re-index to take effect." : "These changes were saved and take effect immediately.")
            : "Validation passed.";
    elements.collectionValidationSummary.appendChild(createEl("span", "", summaryText));

    if (dependencyDown) {
        const banner = createEl("div", "mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800");
        banner.appendChild(createEl("div", "font-semibold", "Backend dependency down"));
        banner.appendChild(createEl("div", "mt-1 break-all-words", "Chroma or the embedding service is not reachable. Validation can still report local issues, but backend-dependent actions should wait until the dependency is healthy."));
        elements.collectionValidationContent.appendChild(banner);
    }
    if (recommendedActions.length > 0) {
        appendIssueSection(elements.collectionValidationContent, "Recommended Actions", recommendedActions, "No recommended actions.", "text-slate-500");
    }
    if (blockers.length > 0) {
        appendIssueSection(elements.collectionValidationContent, "Blockers", blockers, "No blockers.", "text-rose-600");
    }
    if (warnings.length > 0) {
        appendIssueSection(elements.collectionValidationContent, "Warnings", warnings, "No warnings.", "text-amber-600");
    }
    if (hasImpact) {
        renderValidationImpact(elements.collectionValidationContent, impact);
    }
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
    if (state.selectedCollection?.id === collection.id) renderCollectionIndexStateBanner();
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
    closeAuditPickers();
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
        audit: "Audit Log",
        health: "System Health",
    };
    elements.viewTitle.textContent = titles[viewId] || "Dashboard";

    if (viewId === "jobs") loadJobs();
    if (viewId === "audit") loadAuditLog({ cursor: state.auditLogCursor, resetHistory: false });
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
        state.auditLogCollectionFilter = normalizeAuditCollectionValues(state.auditLogCollectionFilter);
        renderAuditFilterControls();
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
        const statusBadge = getCollectionCardStatusBadge(collection.status, collection.indexState);
        const statusNote = getCollectionCardStatusNote(collection.status, collection.indexState);
        const title = createEl("h3", "mt-3 break-all-words font-bold text-slate-800 transition-colors group-hover:text-indigo-600", collection.displayName || "Unnamed Collection");
        const desc = createEl("p", "mt-1 line-clamp-2 min-h-[2rem] text-xs text-slate-500", collection.description || "No description provided.");
        const footer = createEl("div", "mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:grid-cols-3");
        footer.appendChild(createEl("span", "", `Chunks: ${formatCount(collection.chunkCount)}`));
        footer.appendChild(createEl("span", "", `Version: ${formatCount(collection.activeVersion)}`));
        footer.appendChild(createEl("span", "", formatDateTime(collection.updatedAt)));

        appendChildren(card, [icon, statusBadge, statusNote, title, desc, footer]);
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
        resetPhysicalCollectionsSection({ hide: true });
        clearCollectionIndexStateBanner();
        clearCollectionValidation();
        clearEditorForm();
        elements.inspectorTitle.textContent = "Create Collection";
        clearNode(elements.inspectorStatusBadge);
        elements.inspectorStatusBadge.classList.add("hidden");
        elements.btnViewHistory?.classList.add("hidden");
        setInspectorActionsEnabled(false, "Save the collection before using this action.");
        setCollectionTabsEnabled(false);
        switchTab("editor");
        await Promise.all([loadConfigDefaults(), loadModelDiscovery()]);
        syncSaveButtonAccess();
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
    resetPhysicalCollectionsSection({ message: "Loading physical collection lifecycle..." });
    renderCollectionIndexStateBanner();
    clearCollectionValidation();
    elements.inspectorTitle.textContent = collection.displayName || collection.id;
    clearNode(elements.inspectorStatusBadge);
    elements.inspectorStatusBadge.classList.remove("hidden");
    elements.inspectorStatusBadge.appendChild(getStatusBadge(collection.status));
    elements.btnViewHistory?.classList.remove("hidden");
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
        renderCollectionIndexStateBanner();
    } catch (error) {
        showErrorToast(error, "Failed to load editable collection settings");
    } finally {
        state.isLoading.collectionDetail = false;
        setButtonLoading(elements.btnSave, false);
        syncSaveButtonAccess();
    }
    await updateReadinessTab();
}

function closeInspector() {
    elements.inspectorPanel.classList.add("translate-x-full");
    elements.inspectorOverlay.classList.remove("opacity-100");
    clearCollectionIndexStateBanner();
    clearCollectionValidation();
    resetPhysicalCollectionsSection({ hide: true });
    elements.btnViewHistory?.classList.add("hidden");
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
    const actionStates = [
        [elements.btnReindex, enabled && canAdminAction("reindexCollection"), "Re-index requires operator access."],
        [elements.btnDeleteCol, enabled && canAdminAction("deleteCollection"), "Delete requires admin access."],
        [elements.btnViewHistory, enabled, reason],
    ];
    actionStates.forEach(([button, isEnabled, fallbackReason]) => {
        if (!button) return;
        button.disabled = !isEnabled;
        button.classList.toggle("opacity-50", !isEnabled);
        button.classList.toggle("cursor-not-allowed", !isEnabled);
        if (!isEnabled && (fallbackReason || reason)) button.title = fallbackReason || reason;
        if (isEnabled) button.removeAttribute("title");
    });
}

function syncSaveButtonAccess() {
    if (!elements.btnSave || state.isLoading.collectionDetail) {
        return;
    }
    const mode = elements.editId?.value ? "update" : "create";
    const capability = mode === "create" ? "createCollection" : "updateCollection";
    const allowed = canAdminAction(capability);
    elements.btnSave.disabled = !allowed;
    if (!allowed) {
        elements.btnSave.title = state.auth.enabled
            ? `${mode === "create" ? "Create" : "Update"} collection requires operator access.`
            : "";
    } else {
        elements.btnSave.removeAttribute("title");
    }
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

function renderPhysicalCollectionsPlaceholder(message) {
    if (!elements.physicalCollectionsSection || !elements.physicalCollectionsList) return;
    elements.physicalCollectionsSection.classList.remove("hidden");
    clearNode(elements.physicalCollectionsList);
    elements.physicalCollectionsList.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500", message));
}

function resetPhysicalCollectionsSection({ hide = false, message = "Physical collection lifecycle has not been loaded yet." } = {}) {
    state.selectedPhysicalCollections = null;
    state.selectedPhysicalCollectionsError = null;
    clearNode(elements.physicalCollectionsSummary);
    clearNode(elements.physicalCollectionsActions);
    clearNode(elements.physicalCollectionsList);
    if (elements.physicalCollectionsSection) {
        elements.physicalCollectionsSection.classList.toggle("hidden", hide);
    }
    if (!hide) {
        renderPhysicalCollectionsPlaceholder(message);
    }
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

function getPhysicalCollectionsSummary(records) {
    return {
        active: records.filter((item) => item?.status === "active").length,
        cleanupPending: records.filter((item) => item?.status === "delete_pending").length,
        failed: records.filter((item) => item?.status === "failed_build" || item?.status === "cleanup_failed").length,
    };
}

function createSummaryChip(label, value, tone = "muted") {
    const chip = createEl("div", "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs");
    chip.appendChild(createBadge(label, getStatusColor(tone)));
    chip.appendChild(createEl("span", "font-semibold text-slate-700", formatCount(value)));
    return chip;
}

function getAuditStatusTone(status) {
    const tones = {
        succeeded: "active",
        started: "info",
        failed: "failed",
        rejected: "fail",
        skipped: "muted",
        cancelled: "muted",
    };
    return tones[status] || "muted";
}

function formatAuditCollection(record) {
    if (!record?.collectionId) return "-";
    const name = collectionNameById(record.collectionId);
    return name ? `${name} (${record.collectionId})` : record.collectionId;
}

function formatAuditCorrelation(record) {
    const parts = [];
    if (record?.requestId) parts.push(`req ${shortId(record.requestId)}`);
    if (record?.jobId) parts.push(`job ${shortId(record.jobId)}`);
    if (record?.physicalCollection) parts.push(`pc ${shortId(record.physicalCollection)}`);
    return parts.length > 0 ? parts.join(" / ") : "-";
}

function createAuditDetailsBlock(details) {
    const wrapper = createEl("details", "rounded-lg border border-slate-200 bg-white p-3");
    const summary = createEl("summary", "cursor-pointer text-xs font-bold text-slate-500", "View details");
    const pre = createEl("pre", "mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600");
    try {
        pre.textContent = JSON.stringify(details, null, 2);
    } catch {
        pre.textContent = stringifyForDisplay(details);
    }
    appendChildren(wrapper, [summary, pre]);
    return wrapper;
}

function createAuditLogRow(record) {
    const isError = ["failed", "rejected"].includes(record?.status);
    const row = createEl("tr", isError ? "bg-rose-50/60" : "");
    const cells = [];

    const timeCell = createEl("td", "px-4 py-4 align-top");
    timeCell.appendChild(createEl("div", "font-medium text-slate-700", formatDateTime(record?.timestamp)));
    timeCell.appendChild(createEl("div", "mt-1 text-xs text-slate-400", record?.timestamp || "-"));
    cells.push(timeCell);

    const collectionCell = createEl("td", "px-4 py-4 align-top");
    collectionCell.appendChild(createEl("div", "break-all-words font-medium text-slate-700", formatAuditCollection(record)));
    if (record?.collectionId) {
        collectionCell.appendChild(createEl("div", "mt-1 text-xs text-slate-400 break-all-words", record.collectionId));
    }
    cells.push(collectionCell);

    const operationCell = createEl("td", "px-4 py-4 align-top");
    operationCell.appendChild(createBadge(record?.operation || "unknown", "bg-slate-100 text-slate-700"));
    cells.push(operationCell);

    const statusCell = createEl("td", "px-4 py-4 align-top");
    statusCell.appendChild(createBadge(record?.status || "unknown", getStatusColor(getAuditStatusTone(record?.status))));
    cells.push(statusCell);

    const correlationCell = createEl("td", "px-4 py-4 align-top text-xs text-slate-600");
    correlationCell.appendChild(createEl("div", "break-all-words", formatAuditCorrelation(record)));
    cells.push(correlationCell);

    const errorCell = createEl("td", "px-4 py-4 align-top text-xs text-slate-700");
    errorCell.appendChild(createEl("div", "break-all-words", record?.errorCode || "-"));
    cells.push(errorCell);

    const messageCell = createEl("td", "px-4 py-4 align-top text-xs text-slate-700");
    messageCell.appendChild(createEl("div", `break-all-words ${isError ? "font-semibold text-rose-700" : "text-slate-700"}`, record?.message || "-"));
    cells.push(messageCell);

    const detailsCell = createEl("td", "px-4 py-4 align-top");
    if (record?.details && isRecord(record.details)) {
        detailsCell.appendChild(createAuditDetailsBlock(record.details));
    } else {
        detailsCell.appendChild(createEl("span", "text-xs text-slate-400", "-"));
    }
    cells.push(detailsCell);

    cells.forEach((cell) => row.appendChild(cell));
    return row;
}

function updateAuditLogControls() {
    if (elements.auditPageInfo) {
        const pageNumber = state.auditLogCursorStack.length + 1;
        const suffix = state.auditLog.length > 0 ? ` · ${state.auditLog.length} rows` : "";
        elements.auditPageInfo.textContent = `Page ${pageNumber}${suffix}`;
    }

    if (elements.auditPrevPage) {
        elements.auditPrevPage.disabled = state.isLoading.auditLog || state.auditLogCursorStack.length === 0;
    }

    if (elements.auditNextPage) {
        elements.auditNextPage.disabled = state.isLoading.auditLog || !state.auditLogNextCursor;
    }

    if (elements.auditClearFilters) {
        const hasFilters = getAuditCollectionFilterValues().length > 0 || getAuditOperationFilterValues().length > 0;
        elements.auditClearFilters.disabled = state.isLoading.auditLog || !hasFilters;
    }

    if (elements.auditRefreshList) {
        elements.auditRefreshList.disabled = state.isLoading.auditLog;
    }
}

function getAuditLogEmptyMessage() {
    if (getAuditCollectionFilterValues().length > 0 || getAuditOperationFilterValues().length > 0) {
        return "No audit log entries found for the current filters.";
    }
    return "No audit log entries have been recorded since this deployment.";
}

function renderAuditLogTable() {
    if (!elements.auditLogTableBody) return;
    clearNode(elements.auditLogTableBody);

    updateAuditLogControls();
    syncAuditLogFilterInputs();

    if (state.isLoading.auditLog) {
        const row = createEl("tr");
        const cell = createEl("td", "px-4 py-8 text-center text-sm text-slate-500", "Loading audit log...");
        cell.colSpan = 8;
        row.appendChild(cell);
        elements.auditLogTableBody.appendChild(row);
        return;
    }

    if (state.auditLogError && state.auditLog.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-4 py-4");
        cell.colSpan = 8;
        renderApiErrorContent(cell, state.auditLogError, "Failed to load audit log");
        row.appendChild(cell);
        elements.auditLogTableBody.appendChild(row);
        return;
    }

    if (state.auditLogError) {
        const row = createEl("tr");
        const cell = createEl("td", "px-4 py-4");
        cell.colSpan = 8;
        renderApiErrorContent(cell, state.auditLogError, "Audit log refresh failed");
        row.appendChild(cell);
        elements.auditLogTableBody.appendChild(row);
    }

    if (!state.auditLog || state.auditLog.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-4 py-8 text-center text-sm text-slate-500 italic", getAuditLogEmptyMessage());
        cell.colSpan = 8;
        row.appendChild(cell);
        elements.auditLogTableBody.appendChild(row);
        return;
    }

    state.auditLog.forEach((record) => {
        elements.auditLogTableBody.appendChild(createAuditLogRow(record));
    });
}

function getPhysicalCollectionStatusTone(status) {
    const tones = {
        active: "active",
        building: "building",
        delete_pending: "delete_pending",
        cleanup_failed: "cleanup_failed",
        failed_build: "failed_build",
        retired: "retired",
        deleted: "deleted",
    };
    return tones[status] || "muted";
}

function createPhysicalCollectionCard(record) {
    const card = createEl("article", "rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
    const header = createEl("div", "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between");
    const titleGroup = createEl("div", "space-y-1");
    titleGroup.appendChild(createEl("div", "text-sm font-semibold text-slate-800", record.version || "Unknown version"));
    titleGroup.appendChild(createEl("div", "break-all font-mono text-xs text-slate-500", record.name || "-"));
    header.appendChild(titleGroup);
    header.appendChild(createBadge(record.status || "unknown", getStatusColor(getPhysicalCollectionStatusTone(record.status))));
    card.appendChild(header);

    const meta = createEl("div", "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3");
    meta.appendChild(createMetaItem("Documents", formatCount(record.documentCount)));
    meta.appendChild(createMetaItem("Chunks", formatCount(record.chunkCount)));
    meta.appendChild(createMetaItem("Created", formatDateTime(record.createdAt)));
    meta.appendChild(createMetaItem("Activated", formatDateTime(record.activatedAt)));
    meta.appendChild(createMetaItem("Retired", formatDateTime(record.retiredAt)));
    meta.appendChild(createMetaItem("Delete After", formatDateTime(record.deleteAfter)));
    meta.appendChild(createMetaItem("Deleted", formatDateTime(record.deletedAt)));

    const hnswSpace = record?.chromaConfiguration?.hnsw?.space;
    if (hnswSpace !== undefined) {
        meta.appendChild(createMetaItem("HNSW Space", hnswSpace));
    }

    card.appendChild(meta);

    if (record.cleanupError) {
        const errorBox = createEl("div", "mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800");
        errorBox.appendChild(createEl("div", "font-semibold", "Cleanup Error"));
        errorBox.appendChild(createEl("div", "mt-1 break-all-words", record.cleanupError));
        card.appendChild(errorBox);
    }

    return card;
}

function renderPhysicalCollectionsData(records) {
    if (!elements.physicalCollectionsSection || !elements.physicalCollectionsSummary || !elements.physicalCollectionsList) return;
    elements.physicalCollectionsSection.classList.remove("hidden");
    clearNode(elements.physicalCollectionsSummary);
    clearNode(elements.physicalCollectionsActions);
    clearNode(elements.physicalCollectionsList);

    const summary = getPhysicalCollectionsSummary(records);
    appendChildren(elements.physicalCollectionsSummary, [
        createSummaryChip("Active", summary.active, "active"),
        createSummaryChip("Cleanup Pending", summary.cleanupPending, "delete_pending"),
        createSummaryChip("Failed", summary.failed, summary.failed > 0 ? "failed_build" : "muted"),
    ]);

    const cleanupButton = createButton("View cleanup backlog", "inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50", () => {
        switchView("health");
        requestAnimationFrame(() => {
            document.querySelector(".health-cleanup-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
    elements.physicalCollectionsActions.appendChild(cleanupButton);
    elements.physicalCollectionsActions.appendChild(createEl("span", "text-xs text-slate-500", "Health view shows aggregate cleanup backlog and oldest due delete time."));

    if (records.length === 0) {
        renderPhysicalCollectionsPlaceholder("No physical collection lifecycle records found for this collection.");
        return;
    }

    records.forEach((record) => {
        elements.physicalCollectionsList.appendChild(createPhysicalCollectionCard(record));
    });
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

async function loadPhysicalCollections(collectionId) {
    const data = await apiRequest(adminCollectionPhysicalCollectionsUrl(collectionId));
    if (!Array.isArray(data?.physicalCollections)) {
        throw normalizeError(null, {
            status: 0,
            code: "INVALID_PHYSICAL_COLLECTIONS_RESPONSE",
            message: "Physical collection lifecycle response did not include data.physicalCollections.",
        });
    }
    return data.physicalCollections;
}

async function loadAuditLog(options = {}) {
    const token = ++loadTokens.auditLog;
    const cursor = Object.prototype.hasOwnProperty.call(options, "cursor") ? options.cursor : state.auditLogCursor;
    const resetHistory = options.resetHistory !== false;

    if (resetHistory) {
        state.auditLogCursorStack = [];
        state.auditLog = [];
        state.auditLogNextCursor = null;
    }

    state.auditLogCursor = cursor ?? null;
    state.isLoading.auditLog = true;
    state.auditLogError = null;
    renderAuditLogTable();

    try {
        const data = await apiRequest(adminAuditLogUrl({
            limit: AUDIT_LOG_LIMIT,
            cursor: state.auditLogCursor || undefined,
            collectionIds: getAuditCollectionFilterValues(),
            operations: getAuditOperationFilterValues(),
        }));

        if (token !== loadTokens.auditLog) return;
        state.auditLog = Array.isArray(data?.auditLog) ? data.auditLog : [];
        state.auditLogNextCursor = typeof data?.nextCursor === "string" && data.nextCursor ? data.nextCursor : null;
    } catch (error) {
        if (token !== loadTokens.auditLog) return;
        state.auditLogError = normalizeError(error);
    } finally {
        if (token !== loadTokens.auditLog) return;
        state.isLoading.auditLog = false;
        renderAuditLogTable();
    }
}

async function refreshAuditLog() {
    await loadAuditLog({ cursor: state.auditLogCursor, resetHistory: false });
}

async function applyAuditLogFilters() {
    await loadAuditLog({ cursor: null, resetHistory: true });
}

async function clearAuditLogFilters() {
    setAuditCollectionFilterValues([]);
    setAuditOperationFilterValues([]);
    syncAuditLogFilterInputs();
    await loadAuditLog({ cursor: null, resetHistory: true });
}

async function goToNextAuditLogPage() {
    if (!state.auditLogNextCursor) return;
    state.auditLogCursorStack.push(state.auditLogCursor);
    await loadAuditLog({ cursor: state.auditLogNextCursor, resetHistory: false });
}

async function goToPreviousAuditLogPage() {
    if (state.auditLogCursorStack.length === 0) return;
    const previousCursor = state.auditLogCursorStack.pop() ?? null;
    await loadAuditLog({ cursor: previousCursor, resetHistory: false });
}

async function openAuditLogForCollection(collectionId) {
    if (!collectionId) return;
    setAuditCollectionFilterValues([collectionId]);
    setAuditOperationFilterValues([]);
    state.auditLogCursor = null;
    state.auditLogCursorStack = [];
    syncAuditLogFilterInputs();
    closeAuditPickers();
    closeInspector();
    switchView("audit");
}

async function updateReadinessTab() {
    if (!state.selectedCollection || state.isLoading.readiness || state.isLoading.physicalCollections) return;
    const collectionId = state.selectedCollection.id;
    const hasSnapshot = Boolean(state.selectedReadiness);
    const hasPhysicalSnapshot = Array.isArray(state.selectedPhysicalCollections);
    state.isLoading.readiness = true;
    state.isLoading.physicalCollections = true;
    if (hasSnapshot) {
        setReadinessRefreshNotice("Refreshing readiness snapshot...", "warning");
    } else {
        clearReadinessRefreshNotice();
        clearNode(elements.readinessStatusGrid);
        elements.readinessStatusGrid.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500", "Loading readiness..."));
    }
    if (!hasPhysicalSnapshot) {
        renderPhysicalCollectionsPlaceholder("Loading physical collection lifecycle...");
    }
    updatePlaygroundCapabilityState(hasSnapshot ? "Refreshing readiness snapshot..." : "Readiness is loading.");

    try {
        const results = await Promise.allSettled([
            apiRequest(collectionReadyUrl(state.selectedCollection)),
            loadPhysicalCollections(collectionId),
        ]);

        if (state.selectedCollection?.id !== collectionId) return;

        const [readinessResult, physicalCollectionsResult] = results;

        if (readinessResult.status === "fulfilled") {
            state.selectedReadiness = readinessResult.value;
            renderReadinessData(readinessResult.value);
            clearReadinessRefreshNotice();
            mergeActiveJobFromReadiness(readinessResult.value);
        } else {
            const error = readinessResult.reason;
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
        }

        if (physicalCollectionsResult.status === "fulfilled") {
            state.selectedPhysicalCollections = physicalCollectionsResult.value;
            state.selectedPhysicalCollectionsError = null;
            renderPhysicalCollectionsData(physicalCollectionsResult.value);
        } else {
            state.selectedPhysicalCollections = hasPhysicalSnapshot ? state.selectedPhysicalCollections : null;
            state.selectedPhysicalCollectionsError = normalizeError(physicalCollectionsResult.reason);
            if (elements.physicalCollectionsSection) {
                elements.physicalCollectionsSection.classList.remove("hidden");
            }
            clearNode(elements.physicalCollectionsSummary);
            renderApiErrorContent(elements.physicalCollectionsList, physicalCollectionsResult.reason, "Failed to load physical collection lifecycle");
        }
    } finally {
        state.isLoading.readiness = false;
        state.isLoading.physicalCollections = false;
        renderCollectionIndexStateBanner();
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
        createReadinessRow(
            `Embedding: ${availability.embeddingProvider || "-"} / ${availability.embeddingModel || "-"}`,
            availability.embeddingModelAvailable,
            Boolean(availability.embeddingModelAvailable),
        ),
        // The chat LLM is global and optional; "not configured" is a valid retrieve-only setup, not a failure.
        availability.chatModel
            ? createReadinessRow(`Chat LLM: ${availability.chatModel}`, availability.chatModelAvailable, Boolean(availability.chatModelAvailable))
            : createReadinessRow("Chat LLM", "not configured (retrieve-only)"),
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
    renderCollectionIndexStateBanner();
}

function getCapabilityState(mode) {
    if (!state.selectedCollection) return { enabled: false, reason: "Select and save a collection first." };
    if (!state.selectedReadiness) return { enabled: false, reason: "Readiness is not available." };
    const enabled = state.selectedReadiness.capabilities?.[mode] === true;
    if (enabled) return { enabled, reason: "" };
    if (mode === "query") {
        const issues = [...(state.selectedReadiness.blockers || []), ...(state.selectedReadiness.warnings || [])];
        const chatIssue = issues.find((issue) => typeof issue?.code === "string" && issue.code.startsWith("CHAT_"));
        if (chatIssue?.code === "CHAT_NOT_CONFIGURED") {
            return { enabled, reason: "Query is disabled: no chat LLM is configured (retrieve-only). Use Retrieve, or set one with npm run onboard." };
        }
        if (chatIssue?.message) return { enabled, reason: chatIssue.message };
    }
    return {
        enabled,
        reason: `${mode === "query" ? "Query" : "Retrieve"} is not available for this collection.`,
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
    syncModelDiscoveryPanel();
    syncConfigDefaultsPanel();
}

function fieldValueFromCollection(collection, field) {
    if (!Object.prototype.hasOwnProperty.call(collection, field)) return "";
    return collection[field] ?? "";
}

function hasUnsavedCollectionChanges() {
    if (!state.editorInitialSnapshot) return false;
    const current = readEditorValues();
    return Object.keys({ ...state.editorInitialSnapshot, ...current }).some((key) => current[key] !== state.editorInitialSnapshot[key]);
}

function setupEditorTab(collection) {
    elements.editId.value = collection.id || "";
    elements.editDisplayName.value = fieldValueFromCollection(collection, "displayName");
    elements.editDescription.value = fieldValueFromCollection(collection, "description");
    elements.editSourcePath.value = fieldValueFromCollection(collection, "sourcePath");
    elements.editDistanceMetric.value = collection.distanceMetric || "";
    elements.editChunkSize.value = collection.chunkSize ?? "";
    elements.editChunkOverlap.value = collection.chunkOverlap ?? "";
    elements.editRetrievalK.value = collection.retrievalK ?? "";
    elements.editRetrievalDistanceThreshold.value = collection.retrievalDistanceThreshold ?? "";
    if (elements.editEmbeddingProvider) elements.editEmbeddingProvider.value = collection.embeddingProvider || "";
    elements.editEmbeddingModel.value = fieldValueFromCollection(collection, "embeddingModel");
    state.editorInitialSnapshot = readEditorValues();
    syncModelDiscoveryPanel();
    syncConfigDefaultsPanel();
    syncSaveButtonAccess();
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
        distanceMetric: readTrimmed(EDIT_FIELD_IDS.distanceMetric),
        chunkSize: readOptionalInteger(EDIT_FIELD_IDS.chunkSize),
        chunkOverlap: readOptionalInteger(EDIT_FIELD_IDS.chunkOverlap),
        retrievalK: readOptionalInteger(EDIT_FIELD_IDS.retrievalK),
        retrievalDistanceThreshold: readOptionalNumber(EDIT_FIELD_IDS.retrievalDistanceThreshold),
        embeddingProvider: readTrimmed(EDIT_FIELD_IDS.embeddingProvider),
        embeddingModel: readTrimmed(EDIT_FIELD_IDS.embeddingModel),
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
        if (values.distanceMetric) payload.distanceMetric = values.distanceMetric;
        addIfNumber(payload, "chunkSize", values.chunkSize);
        addIfNumber(payload, "chunkOverlap", values.chunkOverlap);
        addIfNumber(payload, "retrievalK", values.retrievalK);
        addIfNumber(payload, "retrievalDistanceThreshold", values.retrievalDistanceThreshold);
        addIfText(payload, "embeddingProvider", values.embeddingProvider);
        addIfText(payload, "embeddingModel", values.embeddingModel);
        return payload;
    }

    const initial = state.editorInitialSnapshot || {};
    if (values.displayName && values.displayName !== initial.displayName) payload.displayName = values.displayName;

    if (values.description !== initial.description) {
        if (values.description) payload.description = values.description;
        else if (initial.description) payload.description = null;
    }

    ["sourcePath", "embeddingProvider", "embeddingModel"].forEach((key) => {
        if (values[key] && values[key] !== initial[key]) payload[key] = values[key];
    });

    if (values.distanceMetric && values.distanceMetric !== initial.distanceMetric) payload.distanceMetric = values.distanceMetric;

    ["chunkSize", "chunkOverlap", "retrievalK", "retrievalDistanceThreshold"].forEach((key) => {
        if (values[key] !== undefined && Number.isFinite(values[key]) && values[key] !== initial[key]) payload[key] = values[key];
    });

    return payload;
}

function getValidationTitle(mode) {
    return mode === "create" ? "Create validation" : "Update validation";
}

function hasValidationBlockers(validation) {
    return Array.isArray(validation?.blockers) && validation.blockers.length > 0;
}

function hasValidationWarnings(validation) {
    return Array.isArray(validation?.warnings) && validation.warnings.length > 0;
}

function validateCollectionOnServer(mode, collectionId, payload = buildCollectionPayload(mode)) {
    const url = mode === "create" ? adminCollectionValidateUrl() : adminCollectionValidateUrl(collectionId);
    return apiRequest(url, {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

async function saveCollection() {
    const id = elements.editId.value;
    const mode = id ? "update" : "create";
    if (mode === "create" && !canAdminAction("createCollection")) {
        showToast("Create collection requires operator access.", "error");
        return;
    }
    if (mode === "update" && !canAdminAction("updateCollection")) {
        showToast("Update collection requires operator access.", "error");
        return;
    }
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
        const validation = await validateCollectionOnServer(mode, id, payload);
        if (hasValidationBlockers(validation)) {
            renderCollectionValidation(validation, getValidationTitle(mode));
            showToast("Validation blocked the save.", "error", {
                issues: validation.blockers,
            });
            return;
        }
        const hasWarnings = hasValidationWarnings(validation);
        const hasImpact = Boolean(validation?.impact?.reindexRequired) ||
            (Array.isArray(validation?.impact?.immediateFields) && validation.impact.immediateFields.length > 0) ||
            (Array.isArray(validation?.impact?.reindexFields) && validation.impact.reindexFields.length > 0);
        const shouldKeepOpen = hasWarnings || hasImpact;
        if (mode === "create") {
            const data = await adminMutationRequest(`${API.admin}/collections`, { method: "POST", body: JSON.stringify(payload) });
            showToast(`Collection created: ${data?.collection?.id || payload.displayName}`, "success");
            await loadCollections();
            if (shouldKeepOpen) {
                const createdId = data?.collection?.id;
                if (createdId) {
                    const refreshed = await loadAdminCollectionDetail(createdId);
                    state.selectedCollection = mergeCollectionIntoState(refreshed);
                    elements.inspectorTitle.textContent = refreshed.displayName || refreshed.id;
                    clearNode(elements.inspectorStatusBadge);
                    elements.inspectorStatusBadge.classList.remove("hidden");
                    elements.inspectorStatusBadge.appendChild(getStatusBadge(refreshed.status));
                    setInspectorActionsEnabled(true);
                    setCollectionTabsEnabled(true);
                    setupEditorTab(refreshed);
                }
                renderCollectionValidation(validation, getValidationTitle(mode));
                showToast(
                    validation.impact.reindexRequired
                        ? "Collection saved. Initial re-index is required before it can be used."
                        : "Collection saved. Review the validation warnings.",
                    "info",
                );
                return;
            }
        } else {
            await adminMutationRequest(adminCollectionUrl(id), { method: "PATCH", body: JSON.stringify(payload) });
            showToast("Collection updated.", "success");
            await loadCollections();
            if (shouldKeepOpen) {
                const refreshed = await loadAdminCollectionDetail(id);
                state.selectedCollection = mergeCollectionIntoState(refreshed);
                elements.inspectorTitle.textContent = refreshed.displayName || refreshed.id;
                clearNode(elements.inspectorStatusBadge);
                elements.inspectorStatusBadge.classList.remove("hidden");
                elements.inspectorStatusBadge.appendChild(getStatusBadge(refreshed.status));
                setInspectorActionsEnabled(true);
                setCollectionTabsEnabled(true);
                setupEditorTab(refreshed);
                renderCollectionValidation(validation, getValidationTitle(mode));
                showToast(validation.impact.reindexRequired
                    ? "Collection saved. Re-index is required to apply indexed settings."
                    : "Collection saved. Immediate settings are now active. Review warnings if present.", "info");
                return;
            }
        }
        closeInspector();
    } catch (error) {
        showErrorToast(error, "Save failed");
    } finally {
        setButtonLoading(elements.btnSave, false);
        syncSaveButtonAccess();
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
    ].filter(Boolean);
    const summary = createEl("summary", "cursor-pointer break-all-words text-sm font-semibold text-slate-700", summaryParts.join(" / "));
    details.appendChild(summary);

    const grid = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2");
    [
        ["Source path", source.sourcePath],
        ["Source type", source.sourceType],
        ["Chunk", source.chunkIndex],
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
    meta.appendChild(createMetaItem("Embedding", `${data?.embeddingProvider || "-"} / ${data?.embeddingModel || "-"}`));
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
    meta.appendChild(createMetaItem("Embedding", `${data?.embeddingProvider || "-"} / ${data?.embeddingModel || "-"}`));
    meta.appendChild(createMetaItem("Chat model", data?.chatModel || "-"));
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
        CHAT_NOT_CONFIGURED: "Answer generation is disabled because no chat LLM is configured. Use Retrieve, or set one with npm run onboard (or RAG_CHAT_BASE_URL / RAG_CHAT_MODEL).",
        CHAT_PROVIDER_UNREACHABLE: "The chat LLM could not be reached. Check that it is running and that chat.baseUrl is correct.",
        CHAT_PROVIDER_ERROR: "The chat LLM returned an error (for example a wrong API key or an unknown model). See the details below.",
        EMBEDDING_PROVIDER_NOT_CONFIGURED: "This collection uses the openai-compatible embedding service, but none is configured (embedding.baseUrl).",
        EMBEDDING_PROVIDER_UNREACHABLE: "The embedding service (or the built-in model download) is not reachable right now.",
        EMBEDDING_PROVIDER_ERROR: "The embedding service returned an error (for example a wrong API key or an unknown model).",
        EMBEDDING_DIMENSION_MISMATCH: "The collection was indexed with a different embedding model. Re-index the collection.",
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
    if (!canAdminAction("reindexCollection")) {
        showToast("Re-index requires operator access.", "error");
        return;
    }
    if (hasUnsavedCollectionChanges()) {
        showToast("Save the collection changes before re-indexing.", "error");
        return;
    }
    try {
        setButtonLoading(elements.btnReindex, true, "Starting...");
        const validation = await validateCollectionOnServer("update", state.selectedCollection.id, {});
        if (hasValidationBlockers(validation)) {
            renderCollectionValidation(validation, "Re-index validation");
            showToast("Validation blocked the re-index.", "error", {
                issues: validation.blockers,
            });
            return;
        }
        if (hasValidationWarnings(validation)) {
            renderCollectionValidation(validation, "Re-index validation");
        } else {
            clearCollectionValidation();
        }

        const data = await adminMutationRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: "POST" });
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
    if (!canAdminAction("deleteCollection")) {
        showToast("Delete collection requires admin access.", "error");
        return;
    }
    if (!confirm(`Delete collection "${state.selectedCollection.displayName || state.selectedCollection.id}"? This is a soft delete.`)) return;

    try {
        setButtonLoading(elements.btnDeleteCol, true, "Deleting...");
        await adminMutationRequest(adminCollectionUrl(state.selectedCollection.id), { method: "DELETE" });
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
        targetEmbeddingProvider: job.targetEmbeddingProvider ?? existing.targetEmbeddingProvider ?? null,
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

async function deleteJob(jobId) {
    if (!canAdminAction("deleteJob")) {
        showToast("Delete job requires admin access.", "error");
        return;
    }
    if (state.jobListSource !== "server") {
        removeJobFromMonitor(jobId);
        showToast("Job removed from local monitor.", "success");
        return;
    }

    if (state.selectedJobIds.size > 0 && state.selectedJobIds.has(jobId)) {
        await removeSelectedJobs();
        return;
    }

    try {
        await adminMutationRequest(adminJobDeleteUrl(jobId), { method: "DELETE" });
        removeJobFromMonitor(jobId);
        showToast("Job removed.", "success");
        resetJobPagination();
        await loadJobs({ cursor: null });
    } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status === 404 || normalized.code === "ROUTE_NOT_FOUND") {
            removeJobFromMonitor(jobId);
            showToast("Job was already removed.", "info");
            resetJobPagination();
            await loadJobs({ cursor: null });
            return;
        }
        showErrorToast(error, "Remove failed");
        await loadJobs({ cursor: null });
    }
}

function isTerminalJobStatus(status) {
    return ["succeeded", "failed", "cancelled"].includes(status);
}

function getVisibleSelectableJobIds(jobs = getJobViewRows()) {
    if (state.jobListSource !== "server") return [];
    return jobs
        .filter((job) => job?.id && !job.notFound && isTerminalJobStatus(job.status))
        .map((job) => job.id);
}

function pruneSelectedJobIds(jobIds = getVisibleSelectableJobIds()) {
    const visibleIds = new Set(jobIds);
    let changed = false;
    for (const jobId of [...state.selectedJobIds]) {
        if (!visibleIds.has(jobId)) {
            state.selectedJobIds.delete(jobId);
            changed = true;
        }
    }
    return changed;
}

function updateJobSelectionControls(jobs = getJobViewRows()) {
    const selectableJobIds = getVisibleSelectableJobIds(jobs);
    pruneSelectedJobIds(selectableJobIds);
    const selectableSet = new Set(selectableJobIds);
    const selectedCount = [...state.selectedJobIds].filter((jobId) => selectableSet.has(jobId)).length;
    const hasSelectableJobs = selectableJobIds.length > 0;
    const allSelected = hasSelectableJobs && selectedCount === selectableJobIds.length;

    if (elements.jobsBulkActionBar) {
        elements.jobsBulkActionBar.classList.toggle("hidden", state.jobListSource !== "server" || !hasSelectableJobs || !canAdminAction("bulkDeleteJobs"));
    }
    if (elements.jobsBulkSelectionCount) {
        elements.jobsBulkSelectionCount.textContent = selectedCount === 0
            ? `${selectableJobIds.length} terminal job${selectableJobIds.length === 1 ? "" : "s"} on this page`
            : selectedCount === 1
                ? "1 job selected"
                : `${selectedCount} jobs selected`;
    }
    if (elements.jobsBulkRemove) {
        elements.jobsBulkRemove.disabled = selectedCount === 0 || state.isLoading.jobs || state.jobListSource !== "server" || !canAdminAction("bulkDeleteJobs");
        elements.jobsBulkRemove.textContent = selectedCount === 0 ? "Select jobs to remove" : "Remove selected";
        if (!canAdminAction("bulkDeleteJobs")) {
            elements.jobsBulkRemove.title = state.auth.enabled ? "Bulk delete requires admin access." : "";
        } else {
            elements.jobsBulkRemove.removeAttribute("title");
        }
    }
    if (elements.jobsSelectAll) {
        elements.jobsSelectAll.disabled = !hasSelectableJobs || state.isLoading.jobs || state.jobListSource !== "server";
        elements.jobsSelectAll.checked = allSelected;
        elements.jobsSelectAll.indeterminate = selectedCount > 0 && !allSelected;
    }
}

function clearJobSelection({ render = true } = {}) {
    state.selectedJobIds.clear();
    if (render) renderJobs();
    else updateJobSelectionControls();
}

async function removeSelectedJobs() {
    if (state.jobListSource !== "server") {
        showToast("Bulk remove is only available for the server job list.", "error");
        return;
    }
    if (!canAdminAction("bulkDeleteJobs")) {
        showToast("Bulk delete requires admin access.", "error");
        return;
    }

    const jobIds = getVisibleSelectableJobIds().filter((jobId) => state.selectedJobIds.has(jobId));
    if (jobIds.length === 0) {
        showToast("Select one or more terminal jobs to remove.", "info");
        return;
    }

    try {
        await adminMutationRequest(adminJobsBulkDeleteUrl(), {
            method: "POST",
            body: JSON.stringify({ jobIds }),
        });
        removeJobsFromMonitor(jobIds, { render: false });
        clearJobSelection({ render: false });
        resetJobPagination();
        showToast(`${jobIds.length} job${jobIds.length === 1 ? "" : "s"} removed.`, "success");
        await loadJobs({ cursor: null });
    } catch (error) {
        const normalized = normalizeError(error);
        removeJobsFromMonitor(jobIds, { render: false });
        clearJobSelection({ render: false });
        resetJobPagination();
        if (normalized.status === 404 || normalized.code === "ROUTE_NOT_FOUND") {
            showToast("One or more selected jobs were already removed.", "info");
            await loadJobs({ cursor: null });
            return;
        }
        showErrorToast(error, "Bulk remove failed");
        await loadJobs({ cursor: null });
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
    if (!canAdminAction("cancelJob")) {
        showToast("Cancel requires operator access.", "error");
        return;
    }
    try {
        await adminMutationRequest(`${API.admin}/jobs/${jobId}/cancel`, { method: "POST" });
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
    removeJobsFromMonitor([jobId]);
}

function removeJobsFromMonitor(jobIds, { render = true } = {}) {
    const ids = new Set((jobIds || []).filter(Boolean));
    if (ids.size === 0) return;

    state.knownJobs = state.knownJobs.filter((job) => !ids.has(job.id));
    state.jobList = state.jobList.filter((job) => !ids.has(job.id));
    for (const jobId of ids) {
        state.selectedJobIds.delete(jobId);
    }
    saveKnownJobsToStorage();
    if (render) renderJobs();
    else updateJobSelectionControls();
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
    pruneSelectedJobIds(getVisibleSelectableJobIds(jobs));

    if (jobs.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-6 py-12 text-center text-slate-400 italic");
        cell.colSpan = 9;
        cell.appendChild(createEl("div", "", getJobViewEmptyMessage()));
        if (state.jobListSource !== "server") {
            cell.appendChild(createEl("div", "mt-1 text-xs", "This monitor tracks jobs observed by this browser/admin session."));
        }
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    jobs.forEach((job) => {
        const isSelectable = state.jobListSource === "server" && !job.notFound && isTerminalJobStatus(job.status);
        const isSelected = state.selectedJobIds.has(job.id) && isSelectable;
        const canCancelJob = canAdminAction("cancelJob");
        const canDeleteJob = canAdminAction("deleteJob");
        const row = createEl("tr", isSelected ? "bg-indigo-50/50 hover:bg-slate-50" : "hover:bg-slate-50");

        const selectionCell = createEl("td", "px-4 py-4 align-top");
        const checkbox = createEl("input", "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed");
        checkbox.type = "checkbox";
        checkbox.disabled = !isSelectable || state.isLoading.jobs;
        checkbox.checked = isSelected;
        checkbox.title = isSelectable ? "Select this job" : "Only terminal jobs can be selected";
        checkbox.setAttribute("aria-label", `Select job ${shortId(job.id)}`);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                state.selectedJobIds.add(job.id);
            } else {
                state.selectedJobIds.delete(job.id);
            }
            renderJobs();
        });
        selectionCell.appendChild(checkbox);
        row.appendChild(selectionCell);

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
        target.appendChild(createEl("div", "", `Embedding: ${job.targetEmbeddingProvider || "-"} / ${job.targetEmbeddingModel || "-"}`));
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
        if ((job.status === "queued" || job.status === "running") && canCancelJob) {
            actions.appendChild(createButton("Cancel", "text-xs font-medium text-rose-600 hover:text-rose-800", () => cancelJob(job.id), { title: "Cancel this job" }));
        }
        if ((job.notFound || ["succeeded", "failed", "cancelled"].includes(job.status)) && canDeleteJob) {
            actions.appendChild(createButton("Remove", "text-xs font-medium text-slate-500 hover:text-slate-700", () => deleteJob(job.id), { title: "Delete terminal job from the server" }));
        }
        if (state.auth.enabled && !canCancelJob && !canDeleteJob) {
            actions.appendChild(createEl("span", "text-xs text-slate-400", "Read-only role"));
        }
        appendCell(row, "text-right", actions);
        tbody.appendChild(row);
    });

    updateJobSelectionControls(jobs);
}

async function loadHealth() {
    if (state.isLoading.health) return;
    const hasSnapshot = Boolean(state.healthStatus || state.readiness || state.readinessDetails);
    state.isLoading.health = true;

    if (hasSnapshot) {
        renderHealthSummary(state.healthStatus, state.readiness, state.readinessDetails, { refreshing: true });
        renderReadinessDetail(state.readiness, state.readinessDetails, null, { refreshing: true });
    } else {
        renderHealthLoadingState();
        renderReadinessLoadingState();
    }

    try {
        const [healthResult, readyResult, detailsResult] = await Promise.allSettled([
            apiRequest(API.health),
            apiRequest(API.ready),
            apiRequest(`${API.ready}?details=true`),
        ]);

        state.healthStatus = healthResult.status === "fulfilled" ? healthResult.value : state.healthStatus;
        state.readiness = readyResult.status === "fulfilled" ? readyResult.value : state.readiness;
        state.readinessDetails = detailsResult.status === "fulfilled" ? detailsResult.value : state.readinessDetails;
        if (
            healthResult.status === "fulfilled"
            || readyResult.status === "fulfilled"
            || detailsResult.status === "fulfilled"
        ) {
            state.healthLastUpdatedAt = new Date().toISOString();
        }

        renderHealthSummary(state.healthStatus, state.readiness, state.readinessDetails, {
            lastUpdatedAt: state.healthLastUpdatedAt,
        });
        renderReadinessDetail(state.readiness, state.readinessDetails, detailsResult.status === "rejected" ? detailsResult.reason : null, {
            lastUpdatedAt: state.healthLastUpdatedAt,
        });

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

function createInlineLoadingBar() {
    const track = createEl("div", "mt-3 h-2 overflow-hidden rounded-full bg-slate-200");
    const fill = createEl("div", "h-full w-2/3 rounded-full bg-sky-500/80 animate-pulse");
    track.appendChild(fill);
    return track;
}

function createHealthStatusBanner(message, options = {}) {
    const tone = options.tone || "info";
    const toneClasses = tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
    const banner = createEl("div", `col-span-full rounded-lg border p-4 text-sm ${toneClasses}`);
    banner.appendChild(createEl("div", "font-semibold", message));
    if (options.detail) {
        banner.appendChild(createEl("div", "mt-1 text-xs opacity-90", options.detail));
    }
    if (options.showBar) {
        banner.appendChild(createInlineLoadingBar());
    }
    return banner;
}

function createLoadingSkeletonCard(title) {
    const card = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    card.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", title));
    const stack = createEl("div", "space-y-3");
    for (let index = 0; index < 4; index += 1) {
        const line = createEl("div", "animate-pulse rounded-md bg-slate-100");
        line.style.height = index === 0 ? "2.75rem" : "2.25rem";
        stack.appendChild(line);
    }
    card.appendChild(stack);
    return card;
}

function renderHealthLoadingState() {
    const grid = elements.healthGrid;
    clearNode(grid);
    grid.appendChild(createHealthStatusBanner("Loading system health...", {
        detail: "Fetching liveness, readiness summary, and diagnostics.",
        showBar: true,
    }));
    grid.appendChild(createLoadingSkeletonCard("Process"));
    grid.appendChild(createLoadingSkeletonCard("Readiness"));
    grid.appendChild(createLoadingSkeletonCard("Dependencies"));
}

function renderReadinessLoadingState() {
    const container = elements.readinessDetail;
    clearNode(container);
    const notice = createEl("div", "rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800");
    notice.appendChild(createEl("div", "font-semibold", "Loading system health details..."));
    notice.appendChild(createEl("div", "mt-1 text-xs text-sky-700", "Detailed checks and operational diagnostics will appear here shortly."));
    notice.appendChild(createInlineLoadingBar());
    container.appendChild(notice);
}

function getOperationsSnapshot(ready, details) {
    return details?.operations || ready?.operations || null;
}

function createSummaryListCard(title, entries) {
    const card = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    card.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", title));
    const list = createEl("div", "space-y-2");
    entries.forEach(([label, value]) => {
        const row = createEl("div", "flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs");
        row.appendChild(createEl("span", "font-semibold text-slate-600", label));
        row.appendChild(createEl("span", "text-right font-semibold text-slate-700", stringifyForDisplay(value)));
        list.appendChild(row);
    });
    card.appendChild(list);
    return card;
}

function createSummaryListCardWithId(id, title, entries) {
    const card = createSummaryListCard(title, entries);
    card.id = id;
    card.classList.add("health-cleanup-summary");
    return card;
}

function renderOperationsSummaryCards(grid, operations) {
    if (!operations) return;

    grid.appendChild(createSummaryListCard("Collections", [
        ["Total", formatCount(operations.collections?.total)],
        ["Creating", formatCount(operations.collections?.creating)],
        ["Indexing", formatCount(operations.collections?.indexing)],
        ["Ready", formatCount(operations.collections?.ready)],
        ["Failed", formatCount(operations.collections?.failed)],
        ["Archived", formatCount(operations.collections?.archived)],
    ]));

    grid.appendChild(createSummaryListCard("Jobs", [
        ["Total", formatCount(operations.jobs?.total)],
        ["Active", formatCount(operations.jobs?.active)],
        ["Queued", formatCount(operations.jobs?.queued)],
        ["Running", formatCount(operations.jobs?.running)],
        ["Failed", formatCount(operations.jobs?.failed)],
        ["Cancelled", formatCount(operations.jobs?.cancelled)],
    ]));

    grid.appendChild(createSummaryListCardWithId("healthCleanupSummary", "Cleanup", [
        ["Backlog", formatCount(operations.physicalCollections?.cleanupBacklog)],
        ["Delete pending", formatCount(operations.physicalCollections?.deletePending)],
        ["Cleanup failed", formatCount(operations.physicalCollections?.cleanupFailed)],
        ["Failed build", formatCount(operations.physicalCollections?.failedBuild)],
        ["Active physical", formatCount(operations.physicalCollections?.active)],
        ["Oldest due", formatDateTime(operations.physicalCollections?.oldestDueDeleteAt)],
    ]));
}

function appendMetricSection(container, title, entries) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", title));
    const grid = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    entries.forEach(([label, value]) => {
        grid.appendChild(createMetaItem(label, value));
    });
    section.appendChild(grid);
    container.appendChild(section);
}

function renderOperationsDetail(container, operations) {
    if (!operations) return;

    appendMetricSection(container, "Collection Operations", [
        ["Observed at", formatDateTime(operations.observedAt)],
        ["Total collections", formatCount(operations.collections?.total)],
        ["Creating", formatCount(operations.collections?.creating)],
        ["Indexing", formatCount(operations.collections?.indexing)],
        ["Ready", formatCount(operations.collections?.ready)],
        ["Failed", formatCount(operations.collections?.failed)],
        ["Archived", formatCount(operations.collections?.archived)],
    ]);

    appendMetricSection(container, "Job Operations", [
        ["Total jobs", formatCount(operations.jobs?.total)],
        ["Active jobs", formatCount(operations.jobs?.active)],
        ["Queued", formatCount(operations.jobs?.queued)],
        ["Running", formatCount(operations.jobs?.running)],
        ["Terminal", formatCount(operations.jobs?.terminal)],
        ["Succeeded", formatCount(operations.jobs?.succeeded)],
        ["Failed", formatCount(operations.jobs?.failed)],
        ["Cancelled", formatCount(operations.jobs?.cancelled)],
        ["Oldest active update", formatDateTime(operations.jobs?.oldestActiveUpdatedAt)],
        ["Oldest active age", formatDurationSeconds(operations.jobs?.oldestActiveAgeSec)],
        ["Latest failure", formatDateTime(operations.jobs?.newestFailureAt)],
    ]);

    appendMetricSection(container, "Physical Collection Operations", [
        ["Total physical", formatCount(operations.physicalCollections?.total)],
        ["Building", formatCount(operations.physicalCollections?.building)],
        ["Active", formatCount(operations.physicalCollections?.active)],
        ["Failed build", formatCount(operations.physicalCollections?.failedBuild)],
        ["Delete pending", formatCount(operations.physicalCollections?.deletePending)],
        ["Cleanup failed", formatCount(operations.physicalCollections?.cleanupFailed)],
        ["Deleted", formatCount(operations.physicalCollections?.deleted)],
        ["Cleanup backlog", formatCount(operations.physicalCollections?.cleanupBacklog)],
        ["Oldest due delete", formatDateTime(operations.physicalCollections?.oldestDueDeleteAt)],
    ]);

    appendMetricSection(container, "Runtime Limits", [
        ["Rate limit enabled", formatBoolean(operations.runtime?.rateLimit?.enabled)],
        ["Rate limit window", operations.runtime?.rateLimit?.windowMs !== undefined ? `${operations.runtime.rateLimit.windowMs} ms` : "-"],
        ["Max requests / window", formatCount(operations.runtime?.rateLimit?.maxRequestsPerWindow)],
        ["Max concurrent embeddings", formatCount(operations.runtime?.concurrency?.maxConcurrentEmbeddings)],
        ["Max concurrent generations", formatCount(operations.runtime?.concurrency?.maxConcurrentGenerations)],
        ["Readiness timeout", operations.runtime?.timeouts?.readinessMs !== undefined ? `${operations.runtime.timeouts.readinessMs} ms` : "-"],
        ["RAG timeout", operations.runtime?.timeouts?.ragMs !== undefined ? `${operations.runtime.timeouts.ragMs} ms` : "-"],
    ]);
}

function renderHealthSummary(health, ready, details, options = {}) {
    const grid = elements.healthGrid;
    clearNode(grid);

    if (!health && !ready && !details) {
        grid.appendChild(createEl("div", "col-span-full py-8 text-center text-slate-400 italic", "Health data unavailable."));
        return;
    }

    if (options.refreshing) {
        grid.appendChild(createHealthStatusBanner("Refreshing system health...", {
            detail: state.healthLastUpdatedAt ? `Showing last successful snapshot from ${formatDateTime(state.healthLastUpdatedAt)}.` : "Keeping the last successful snapshot visible while new diagnostics load.",
            tone: "warning",
            showBar: true,
        }));
    } else if (options.lastUpdatedAt) {
        grid.appendChild(createHealthStatusBanner("System health loaded.", {
            detail: `Last updated ${formatDateTime(options.lastUpdatedAt)}.`,
        }));
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
    readinessGrid.appendChild(createMetaItem("Retrieve ready", formatBoolean(ready?.retrieveReady ?? details?.retrieveReady)));
    readinessGrid.appendChild(createMetaItem("Query enabled", formatBoolean(ready?.queryEnabled ?? details?.queryEnabled)));
    readinessGrid.appendChild(createMetaItem("Query ready", formatBoolean(ready?.queryReady ?? details?.queryReady)));
    readinessGrid.appendChild(createMetaItem("Index ready", formatBoolean(ready?.indexReady ?? details?.indexReady)));
    readinessGrid.appendChild(createMetaItem("Summary", ready?.overallSummary ?? details?.overallSummary ?? "-", "sm:col-span-1"));
    readinessCard.appendChild(readinessGrid);
    grid.appendChild(readinessCard);

    const depsCard = createEl("div", "rounded-lg border border-slate-200 bg-white p-6 shadow-sm");
    depsCard.appendChild(createEl("h3", "mb-3 text-sm font-bold uppercase text-slate-500", "Dependencies"));
    const deps = details?.dependencies || ready?.dependencies || {};
    const depList = createEl("div", "space-y-2");
    ["registry", "chroma", "embedding", "chat"].forEach((key) => {
        const row = createEl("div", "flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 p-2 text-xs");
        row.appendChild(createEl("span", "font-semibold capitalize text-slate-600", key === "chat" ? "chat LLM" : key));
        // An unconfigured chat LLM is a valid retrieve-only setup, not a failure.
        const status = key === "chat" && deps.chat && deps.chat.configured === false ? "disabled" : dependencyStatus(deps[key]);
        row.appendChild(createBadge(status, getStatusColor(status)));
        depList.appendChild(row);
    });
    depsCard.appendChild(depList);
    grid.appendChild(depsCard);

    renderOperationsSummaryCards(grid, getOperationsSnapshot(ready, details));
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
            const header = createEl("div", "flex flex-wrap items-center justify-between gap-2");
            header.appendChild(createEl("div", "font-semibold", item.code || item.name || "Issue"));
            if (item.severity) {
                header.appendChild(createBadge(item.severity, getStatusColor(item.severity)));
            }
            row.appendChild(header);
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

function renderReadinessDetail(ready, details, detailsError, options = {}) {
    const container = elements.readinessDetail;
    clearNode(container);
    const operations = getOperationsSnapshot(ready, details);

    if (options.refreshing) {
        const refreshNotice = createEl("div", "mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800");
        refreshNotice.appendChild(createEl("div", "font-semibold", "Refreshing health diagnostics..."));
        refreshNotice.appendChild(createEl("div", "mt-1 text-xs text-amber-700", state.healthLastUpdatedAt ? `Showing last successful snapshot from ${formatDateTime(state.healthLastUpdatedAt)}.` : "Current diagnostics stay visible until the refresh completes."));
        refreshNotice.appendChild(createInlineLoadingBar());
        container.appendChild(refreshNotice);
    } else if (options.lastUpdatedAt) {
        const snapshotNotice = createEl("div", "mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700");
        snapshotNotice.appendChild(createEl("div", "font-semibold", "Diagnostics snapshot"));
        snapshotNotice.appendChild(createEl("div", "mt-1 text-xs text-slate-500", `Last updated ${formatDateTime(options.lastUpdatedAt)}.`));
        container.appendChild(snapshotNotice);
    }

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
    appendIssueSection(container, "Operational Alerts", details?.operationalAlerts ?? ready?.operationalAlerts, "No operational alerts.", "text-sky-600");
    renderChecks(container, details?.checks);

    const config = createEl("section", "mb-6");
    config.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Configuration"));
    const configGrid = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    configGrid.appendChild(createMetaItem("Chat LLM", details?.chatModel ?? ready?.config?.chatModel ?? "not configured (retrieve-only)"));
    configGrid.appendChild(createMetaItem(
        "Embedding (new collections)",
        `${details?.embeddingProvider ?? ready?.config?.embeddingProvider ?? "-"} / ${details?.embeddingModel ?? ready?.config?.embeddingModel ?? "-"}`,
    ));
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

    renderOperationsDetail(container, operations);

    const deps = details?.dependencies;
    if (deps) appendJsonDetails(container, "Dependency diagnostics", deps);
}

function bindEvents() {
    elements.authLoginForm?.addEventListener("submit", (event) => {
        void loginAdmin(event);
    });
    elements.authLogoutButton?.addEventListener("click", () => {
        void logoutAdmin();
    });
    elements.navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            switchView(item.dataset.view);
        });
    });

    elements.btnRefresh.addEventListener("click", () => {
        loadModelDiscovery();
        loadCollections();
        if (state.currentView === "audit") {
            refreshAuditLog();
        } else {
            loadJobs();
            loadHealth();
        }
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
    if (elements.jobsSelectAll) {
        elements.jobsSelectAll.addEventListener("change", () => {
            const selectableJobIds = getVisibleSelectableJobIds();
            if (elements.jobsSelectAll.checked) {
                selectableJobIds.forEach((jobId) => state.selectedJobIds.add(jobId));
            } else {
                selectableJobIds.forEach((jobId) => state.selectedJobIds.delete(jobId));
            }
            renderJobs();
        });
    }
    if (elements.jobsBulkRemove) {
        elements.jobsBulkRemove.addEventListener("click", () => {
            removeSelectedJobs();
        });
    }
    if (elements.auditCollectionToggle) {
        elements.auditCollectionToggle.addEventListener("click", () => {
            toggleAuditPicker(elements.auditCollectionPanel, elements.auditCollectionToggle);
        });
    }
    if (elements.auditOperationToggle) {
        elements.auditOperationToggle.addEventListener("click", () => {
            toggleAuditPicker(elements.auditOperationPanel, elements.auditOperationToggle);
        });
    }
    if (elements.auditCollectionSearch) {
        elements.auditCollectionSearch.addEventListener("input", () => {
            renderAuditCollectionPickerList();
        });
    }
    if (elements.auditOperationSearch) {
        elements.auditOperationSearch.addEventListener("input", () => {
            renderAuditOperationPickerList();
        });
    }
    if (elements.auditCollectionAll) {
        elements.auditCollectionAll.addEventListener("click", () => {
            setAuditCollectionFilterValues(getAuditVisibleCollections().map((collection) => collection.id));
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditCollectionClear) {
        elements.auditCollectionClear.addEventListener("click", () => {
            setAuditCollectionFilterValues([]);
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditOperationAll) {
        elements.auditOperationAll.addEventListener("click", () => {
            setAuditOperationFilterValues(AUDIT_LOG_OPERATION_OPTIONS.map((option) => option.value));
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditOperationClear) {
        elements.auditOperationClear.addEventListener("click", () => {
            setAuditOperationFilterValues([]);
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditCollectionList) {
        elements.auditCollectionList.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.auditCollection) return;
            const selectedValues = [...elements.auditCollectionList.querySelectorAll('input[type="checkbox"][data-audit-collection]')]
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.dataset.auditCollection || "")
                .filter(Boolean);
            setAuditCollectionFilterValues(selectedValues);
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditOperationList) {
        elements.auditOperationList.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.auditOperation) return;
            const selectedValues = [...elements.auditOperationList.querySelectorAll('input[type="checkbox"][data-audit-operation]')]
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.dataset.auditOperation || "")
                .filter(Boolean);
            setAuditOperationFilterValues(selectedValues);
            renderAuditFilterControls();
            if (state.currentView === "audit") void applyAuditLogFilters();
        });
    }
    if (elements.auditClearFilters) {
        elements.auditClearFilters.addEventListener("click", () => {
            clearAuditLogFilters();
        });
    }
    if (elements.auditRefreshList) {
        elements.auditRefreshList.addEventListener("click", () => {
            applyAuditLogFilters();
        });
    }
    if (elements.auditPrevPage) {
        elements.auditPrevPage.addEventListener("click", () => {
            goToPreviousAuditLogPage();
        });
    }
    if (elements.auditNextPage) {
        elements.auditNextPage.addEventListener("click", () => {
            goToNextAuditLogPage();
        });
    }
    if (elements.embeddingModelSelect) {
        elements.embeddingModelSelect.addEventListener("change", () => setModelFromSelect("embedding"));
    }
    if (elements.editEmbeddingModel) {
        elements.editEmbeddingModel.addEventListener("input", () => syncModelDiscoveryPanel());
    }
    if (elements.editEmbeddingProvider) {
        elements.editEmbeddingProvider.addEventListener("change", () => syncModelDiscoveryPanel());
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
    elements.btnViewHistory?.addEventListener("click", () => {
        if (state.selectedCollection?.id) {
            openAuditLogForCollection(state.selectedCollection.id);
        }
    });
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
        if (event.key !== "Escape") return;
        if (!elements.inspectorOverlay.classList.contains("hidden")) {
            closeInspector();
            return;
        }
        closeAuditPickers();
    });
    document.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const insideCollection = Boolean(elements.auditCollectionPicker?.contains(event.target));
        const insideOperation = Boolean(elements.auditOperationPicker?.contains(event.target));
        if (!insideCollection && !insideOperation) {
            closeAuditPickers();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    syncAuthChrome();
    try {
        const canOpenDashboard = await loadAdminSession();
        if (canOpenDashboard || state.auth.authenticated) {
            setDashboardVisible(true);
            await initializeDashboard();
        } else {
            setDashboardVisible(false);
            elements.authUsername?.focus();
        }
    } catch (error) {
        console.error("Failed to bootstrap admin auth", error);
        setDashboardVisible(false);
        elements.authUsername?.focus();
    }
});
