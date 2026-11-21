import { setUnauthorizedHandler } from "./api.js";
import { handleSessionExpired, loadAdminSession, loginAdmin, logoutAdmin, setDashboardVisible, syncAuthChrome } from "./auth.js";
import { initializeDashboard, runHeaderAction, switchView } from "./dashboard.js";
import { onWatchedJobFinished } from "./jobWatch.js";
import { bindRouter } from "./router.js";
import { elements, state } from "./state.js";
import { applyAuditLogFilters, auditOperationOptions, clearAuditLogFilters, closeAuditPickers, getAuditVisibleCollections, goToNextAuditLogPage, goToPreviousAuditLogPage, openAuditLogForCollection, refreshAuditLog, renderAuditCollectionPickerList, renderAuditFilterControls, renderAuditOperationPickerList, setAuditCollectionFilterValues, setAuditOperationFilterValues, toggleAuditPicker } from "./views/audit.js";
import { loadCollections } from "./views/collections.js";
import { bindDocumentsTabEvents } from "./views/documents.js";
import { loadModelDiscovery, saveCollection, syncEmbeddingReindexNote, syncModelDiscoveryPanel } from "./views/editor.js";
import { loadHealth } from "./views/health.js";
import { activateTab, deleteCollection, handleOverlayClick, reindexCollection, requestCloseInspector, updateReadinessTab } from "./views/inspector.js";
import { changeJobsStatusFilter, closeJobDetail, getVisibleSelectableJobIds, goToNextJobsPage, goToPreviousJobsPage, loadJobs, refreshJobsList, removeSelectedJobs, renderJobs } from "./views/jobs.js";
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
        if (state.inspectorOpen && state.selectedCollection) updateReadinessTab();
    });
    elements.jobDetailClose?.addEventListener("click", () => closeJobDetail());
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
    if (elements.editEmbeddingModel) {
        elements.editEmbeddingModel.addEventListener("input", () => syncModelDiscoveryPanel());
    }
    if (elements.editEmbeddingProvider) {
        elements.editEmbeddingProvider.addEventListener("change", () => syncModelDiscoveryPanel());
    }
    elements.btnCreateCollection.addEventListener("click", () => runHeaderAction());
    elements.btnCloseInspector.addEventListener("click", () => void requestCloseInspector());
    elements.inspectorOverlay.addEventListener("click", handleOverlayClick);
    elements.btnCancelEdit.addEventListener("click", () => void requestCloseInspector());
    // Any field change may add or remove a setting that applies only at the next re-index.
    elements.colEditForm.addEventListener("input", () => syncEmbeddingReindexNote());
    elements.colEditForm.addEventListener("change", () => syncEmbeddingReindexNote());
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
        button.addEventListener("click", () => activateTab(button.dataset.tab));
        button.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const tabs = [...elements.tabBtns].filter((tab) => !tab.disabled && !tab.classList.contains("hidden"));
            const index = tabs.indexOf(button);
            const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            if (!next) return;
            event.preventDefault();
            activateTab(next.dataset.tab);
            next.focus();
        });
    });
    elements.pgQuestion?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!elements.btnPgRun.disabled) runPlayground();
        }
    });
    bindRouter();

    bindDocumentsTabEvents();
    bindEmbeddingServicesEvents();

    elements.pgModeBtns.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.disabled) return;
            setPlaygroundMode(button.dataset.mode);
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && state.inspectorOpen && !document.querySelector("[role=alertdialog]")) {
            const focusable = [...elements.inspectorPanel.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")]
                .filter((element) => !element.disabled && element.tabIndex >= 0 && element.offsetParent !== null);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (first && event.shiftKey && (document.activeElement === first || !elements.inspectorPanel.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (last && !event.shiftKey && (document.activeElement === last || !elements.inspectorPanel.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
            return;
        }
        if (event.key !== "Escape") return;
        // Escape while typing in a form field does not close the inspector (it would ask about unsaved changes).
        if (event.target instanceof HTMLElement && event.target.closest("#colEditForm")) return;
        if (!elements.inspectorOverlay.classList.contains("hidden")) {
            void requestCloseInspector();
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
    onWatchedJobFinished((job) => {
        void loadCollections({ quiet: true });
        if (state.inspectorOpen && state.selectedCollection?.id === job.collectionId) void updateReadinessTab();
        if (state.currentView === "jobs") void loadJobs({ quiet: true });
    });
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
