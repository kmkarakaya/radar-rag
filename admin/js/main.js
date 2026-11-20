import { setUnauthorizedHandler } from "./api.js";
import { handleSessionExpired, loadAdminSession, loginAdmin, logoutAdmin, setDashboardVisible, syncAuthChrome } from "./auth.js";
import { initializeDashboard, switchView } from "./dashboard.js";
import { elements, state } from "./state.js";
import { applyAuditLogFilters, auditOperationOptions, clearAuditLogFilters, closeAuditPickers, getAuditVisibleCollections, goToNextAuditLogPage, goToPreviousAuditLogPage, openAuditLogForCollection, refreshAuditLog, renderAuditCollectionPickerList, renderAuditFilterControls, renderAuditOperationPickerList, setAuditCollectionFilterValues, setAuditOperationFilterValues, toggleAuditPicker } from "./views/audit.js";
import { loadCollections } from "./views/collections.js";
import { bindDocumentsTabEvents, loadCollectionFiles } from "./views/documents.js";
import { loadModelDiscovery, saveCollection, setModelFromSelect, syncModelDiscoveryPanel } from "./views/editor.js";
import { loadHealth } from "./views/health.js";
import { closeInspector, deleteCollection, handleOverlayClick, openInspector, reindexCollection, switchTab, updatePlaygroundCapabilityState, updateReadinessTab } from "./views/inspector.js";
import { changeJobsStatusFilter, getVisibleSelectableJobIds, goToNextJobsPage, goToPreviousJobsPage, loadJobs, refreshJobsList, removeSelectedJobs, renderJobs } from "./views/jobs.js";
import { runPlayground, setPlaygroundMode } from "./views/playground.js";
import { bindEmbeddingServicesEvents } from "./views/services.js";

export function bindEvents() {
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
            setAuditOperationFilterValues(auditOperationOptions().map((option) => option.value));
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
            if (button.dataset.tab === "files" && state.selectedCollection) loadCollectionFiles();
            if (button.dataset.tab === "playground") updatePlaygroundCapabilityState();
        });
    });

    bindDocumentsTabEvents();
    bindEmbeddingServicesEvents();

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
    // Every module is loaded by now: a 401 from any API call returns to the sign-in screen.
    setUnauthorizedHandler(handleSessionExpired);
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
