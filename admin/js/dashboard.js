import { clearNode } from "./dom.js";
import { elements, state } from "./state.js";
import { closeAuditPickers, loadAuditLog, loadAuditOperations, renderAuditFilterControls } from "./views/audit.js";
import { loadServerInfo } from "./serverInfo.js";
import { emptyChatSettingsState, loadChatServicesView, loadChatSettings } from "./views/chatSettings.js";
import { loadCollections } from "./views/collections.js";
import { loadCollectionFiles } from "./views/documents.js";
import { loadConfigDefaults, loadModelDiscovery } from "./views/editor.js";
import { loadHealth } from "./views/health.js";
import { resetReadinessAndPlayground, updateReadinessTab } from "./views/inspector.js";
import { loadJobs, renderJobs } from "./views/jobs.js";
import { setPlaygroundMode } from "./views/playground.js";
import { SERVICE_VIEWS, closeServiceForm, emptyEmbeddingServicesState, emptyServiceViewState, loadServices, serviceEl } from "./views/services.js";

export let dashboardPollingHandles = [];

export function stopDashboardPolling() {
    for (const handle of dashboardPollingHandles) {
        clearInterval(handle);
    }
    dashboardPollingHandles = [];
}

export function startDashboardPolling() {
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
        if (!document.hidden && state.selectedCollection && state.activeTab === "files") loadCollectionFiles({ quiet: true });
    }, 10000));

    dashboardPollingHandles.push(setInterval(() => {
        if (!document.hidden) loadHealth();
    }, 30000));
}

export function resetDashboardState() {
    state.currentView = "collections";
    state.activeTab = "ready";
    state.collections = [];
    state.selectedCollection = null;
    state.selectedReadiness = null;
    state.selectedPhysicalCollections = null;
    state.selectedPhysicalCollectionsError = null;
    state.embeddingServices = emptyEmbeddingServicesState();
    state.chatServices = emptyServiceViewState();
    state.chatSettings = emptyChatSettingsState();
    Object.values(SERVICE_VIEWS).forEach((view) => {
        closeServiceForm(view);
        clearNode(serviceEl(view, "TableBody"));
    });
    state.jobList = [];
    state.jobListLoadedAt = null;
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

export async function initializeDashboard() {
    resetDashboardState();
    renderAuditFilterControls();
    switchView("collections");
    setPlaygroundMode("retrieve");
    resetReadinessAndPlayground("Select a collection to inspect readiness.");
    renderJobs();
    loadServerInfo();
    loadConfigDefaults();
    loadModelDiscovery();
    loadChatSettings();
    loadCollections();
    loadJobs();
    loadHealth();
    startDashboardPolling();
}

export function switchView(viewId) {
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
        "embedding-services": "Embedding services",
        "chat-services": "Chat services",
        audit: "Audit Log",
        health: "System Health",
    };
    elements.viewTitle.textContent = titles[viewId] || "Dashboard";

    if (viewId === "jobs") loadJobs();
    if (viewId === "embedding-services") loadServices(SERVICE_VIEWS.embedding);
    if (viewId === "chat-services") loadChatServicesView();
    if (viewId === "audit") {
        loadAuditOperations();
        loadAuditLog({ cursor: state.auditLogCursor, resetHistory: false });
    }
    if (viewId === "health") loadHealth();
}
