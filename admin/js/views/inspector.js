import { adminCollectionPhysicalCollectionsUrl, adminCollectionUrl, adminMutationRequest, apiRequest, collectionReadyUrl, normalizeError } from "../api.js";
import { canAdminAction } from "../auth.js";
import { switchView } from "../dashboard.js";
import { confirmDialog } from "../dialog.js";
import { appendChildren, appendText, clearNode, createBadge, createButton, createEl, createMetaItem, formatCount, formatDateTime, getStatusBadge, getStatusColor, isRecord, renderApiErrorContent, setButtonLoading, shortId, showErrorToast, showToast, stringifyForDisplay } from "../dom.js";
import { loadJobProgress, watchJob } from "../jobWatch.js";
import { recordRoute } from "../router.js";
import { API, elements, state } from "../state.js";
import { chatServiceName, loadChatSettings } from "./chatSettings.js";
import { loadAdminCollectionDetail, loadCollections, mergeCollectionIntoState } from "./collections.js";
import { loadCollectionFiles, resetFilesTab } from "./documents.js";
import { clearEditorForm, embeddingServiceName, hasUnsavedCollectionChanges, hasValidationBlockers, hasValidationWarnings, loadConfigDefaults, loadModelDiscovery, setupEditorTab, validateCollectionOnServer, viaEmbeddingService } from "./editor.js";
import { appendIssueSection } from "./health.js";
import { loadJobs } from "./jobs.js";

export const VALIDATION_FIELD_LABELS = {
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
    embeddingServiceId: "Embedding service",
};

export function formatValidationFieldLabel(field) {
    return VALIDATION_FIELD_LABELS[field] || field;
}

export const VALIDATION_DEPENDENCY_BLOCKERS = new Set([
    "CHROMA_UNREACHABLE",
    "EMBEDDING_PROVIDER_UNREACHABLE",
    "COLLECTION_ACTIVE_PHYSICAL_UNREADABLE",
]);

export function isDependencyBlocker(issue) {
    return isRecord(issue) && VALIDATION_DEPENDENCY_BLOCKERS.has(issue.code);
}

export function hasDependencyBlocker(issues) {
    return Array.isArray(issues) && issues.some((issue) => isDependencyBlocker(issue));
}

export function renderValidationImpact(parent, impact) {
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

export function clearCollectionValidation() {
    if (elements.collectionValidation) {
        elements.collectionValidation.classList.add("hidden");
    }
    clearNode(elements.collectionValidationTitle);
    clearNode(elements.collectionValidationSummary);
    clearNode(elements.collectionValidationBadge);
    clearNode(elements.collectionValidationContent);
}

export function clearCollectionIndexStateBanner() {
    if (elements.collectionIndexState) {
        elements.collectionIndexState.classList.add("hidden");
    }
    clearNode(elements.collectionIndexStateTitle);
    clearNode(elements.collectionIndexStateSummary);
    clearNode(elements.collectionIndexStateBadge);
    clearNode(elements.collectionIndexStateContent);
}

export function renderCollectionIndexStateBanner() {
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

    let title = "Up to date";
    let badgeLabel = "UP TO DATE";
    let badgeTone = "ok";
    let summary = "The index matches the saved settings.";

    if (dependencyDown) {
        title = "A service is not available";
        badgeLabel = "UNAVAILABLE";
        badgeTone = "fail";
        summary = "The vector store or the embedding service cannot be reached. Searching and re-indexing wait until it is back.";
    } else if (isIndexing) {
        title = "Indexing";
        badgeLabel = "INDEXING";
        badgeTone = "info";
        summary = activeJob
            ? `Indexing is ${activeJob.status === "queued" ? "queued" : "running"} (job ${shortId(activeJob.id)}). Searches use the previous index until it finishes.`
            : "Indexing is running. Searches use the previous index until it finishes.";
    } else if (!indexState) {
        title = "Index state unknown";
        badgeLabel = "UNKNOWN";
        badgeTone = "warn";
        summary = "The server did not return the index state of this collection.";
    } else if (indexState.status === "no_active_index") {
        title = "Not indexed yet";
        badgeLabel = "NOT INDEXED";
        badgeTone = "warn";
        summary = indexState.note || "Nothing can be searched until the collection is indexed. Add documents, then re-index.";
    } else if (indexState.reindexRequired) {
        title = "Re-index needed";
        badgeLabel = "RE-INDEX NEEDED";
        badgeTone = "warn";
        summary = indexState.note || "The saved settings or documents changed since the last index. Searches use the previous index until you re-index.";
    }

    elements.collectionIndexState.classList.remove("hidden");
    clearNode(elements.collectionIndexStateTitle);
    elements.collectionIndexStateTitle.appendChild(createEl("span", "", title));
    clearNode(elements.collectionIndexStateSummary);
    elements.collectionIndexStateSummary.appendChild(createEl("span", "", summary));
    clearNode(elements.collectionIndexStateBadge);
    elements.collectionIndexStateBadge.appendChild(createBadge(badgeLabel, getStatusColor(badgeTone)));

    clearNode(elements.collectionIndexStateContent);

    // What needs attention stays visible: the fields that need a re-index and the unavailable services.
    // Before the first index every field is "pending"; listing them all says nothing, so only after one.
    if (changedFields.length > 0 && indexState?.status === "reindex_required") {
        const fieldSection = createEl("div", "rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800");
        fieldSection.appendChild(createEl("div", "font-semibold", "Changed since the last index"));
        const fieldWrap = createEl("div", "mt-2 flex flex-wrap gap-2");
        changedFields.forEach((field) => {
            fieldWrap.appendChild(createBadge(formatValidationFieldLabel(field), getStatusColor("warn")));
        });
        fieldSection.appendChild(fieldWrap);
        elements.collectionIndexStateContent.appendChild(fieldSection);
    }

    if (dependencyDown && blockers.length > 0) {
        const blockerSection = createEl("div", "rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs text-rose-800");
        const list = createEl("ul", "list-disc space-y-1 pl-4");
        blockers.forEach((issue) => {
            list.appendChild(createEl("li", "", isRecord(issue) ? issue.message || stringifyForDisplay(issue) : stringifyForDisplay(issue)));
        });
        blockerSection.appendChild(list);
        elements.collectionIndexStateContent.appendChild(blockerSection);
    }

    // The saved and the indexed settings side by side, folded away.
    const details = createEl("details", "rounded-lg border border-slate-100 bg-white p-3 text-xs text-slate-700");
    details.appendChild(createEl("summary", "cursor-pointer font-semibold text-slate-700", "Indexed settings"));
    const snapshotGrid = createEl("div", "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2");
    const saved = indexState?.desiredSnapshot ?? {};
    const active = indexState?.activeSnapshot ?? null;
    const describeEmbedding = (snapshot) => (snapshot
        ? `${snapshot.embeddingProvider ?? "-"} / ${snapshot.embeddingModel ?? "-"}${viaEmbeddingService(snapshot.embeddingServiceId)}`
        : "-");
    [
        ["Documents", saved.sourcePath ?? collection.sourcePath, active?.sourcePath],
        ["Chunk size", saved.chunkSize ?? collection.chunkSize, active?.chunkSize],
        ["Chunk overlap", saved.chunkOverlap ?? collection.chunkOverlap, active?.chunkOverlap],
        ["Embedding", describeEmbedding({ ...saved, embeddingProvider: saved.embeddingProvider ?? collection.embeddingProvider, embeddingModel: saved.embeddingModel ?? collection.embeddingModel }), active ? describeEmbedding(active) : null],
        ["Distance metric", saved.distanceMetric ?? collection.distanceMetric, active?.distanceMetric],
    ].forEach(([label, savedValue, activeValue]) => {
        snapshotGrid.appendChild(createMetaItem(`${label} (saved)`, savedValue));
        snapshotGrid.appendChild(createMetaItem(`${label} (in the index)`, active ? activeValue : "Not indexed yet"));
    });
    details.appendChild(snapshotGrid);
    elements.collectionIndexStateContent.appendChild(details);

    if (isIndexing) {
        elements.collectionIndexStateContent.prepend(createJobProgress(state.activeJobProgress));
    }
}

/** A progress bar for the running job (phase of the build and the last step it reported). */
export function createJobProgress(progress) {
    const box = createEl("div", "rounded-lg border border-sky-100 bg-sky-50 p-3 text-xs text-sky-900");
    const percent = progress?.fraction === null || progress?.fraction === undefined ? null : Math.round(progress.fraction * 100);
    const bar = createEl("div", "h-2 w-full overflow-hidden rounded-full bg-sky-100");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Indexing progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = createEl("div", `h-full rounded-full bg-sky-500 transition-all ${percent === null ? "w-1/4 animate-pulse" : ""}`);
    if (percent !== null) {
        bar.setAttribute("aria-valuenow", String(percent));
        fill.style.width = `${Math.max(percent, 3)}%`;
    }
    bar.appendChild(fill);
    box.appendChild(bar);
    const step = progress?.phase && progress?.phaseCount ? `Step ${progress.phase} of ${progress.phaseCount}: ` : "";
    box.appendChild(createEl("div", "mt-2", `${step}${progress?.message || "Starting..."}`));
    return box;
}

export function renderCollectionValidation(validation, title) {
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

export function openPanel() {
    state.inspectorOpen = true;
    recordRoute();
    elements.inspectorOverlay.classList.remove("hidden");
    requestAnimationFrame(() => elements.inspectorOverlay.classList.add("opacity-100"));
    elements.inspectorPanel.classList.remove("translate-x-full");
}

export async function openInspector(id, options = {}) {
    if (id === null) {
        state.selectedCollection = null;
        state.editorInitialSnapshot = null;
        resetReadinessAndPlayground("Save the collection before checking readiness.");
        resetPhysicalCollectionsSection({ hide: true });
        clearCollectionIndexStateBanner();
        clearCollectionValidation();
        clearEditorForm();
        resetFilesTab();
        elements.inspectorTitle.textContent = "New collection";
        clearNode(elements.inspectorStatusBadge);
        elements.inspectorStatusBadge.classList.add("hidden");
        elements.btnViewHistory?.classList.add("hidden");
        setInspectorActionsEnabled(false, "Save the collection before using this action.");
        setCollectionTabsEnabled(false);
        // Creating: only the form, no tabs or collection actions yet.
        elements.inspectorTabs?.classList.add("hidden");
        elements.inspectorFooter?.classList.add("hidden");
        elements.btnSave.textContent = "Create collection";
        switchTab("editor");
        openPanel();
        syncSaveButtonAccess();
        elements.editDisplayName?.focus();
        // The form is usable at once; defaults and model suggestions fill in when they arrive.
        Promise.all([loadConfigDefaults(), loadModelDiscovery(), loadChatSettings()]).then(() => syncSaveButtonAccess());
        return;
    }

    const collection = state.collections.find((item) => item.id === id);
    if (!collection) {
        showToast("Collection was not found in the current list. Refresh and try again.", "error");
        return;
    }

    state.selectedCollection = collection;
    state.editorInitialSnapshot = null;
    elements.inspectorTabs?.classList.remove("hidden");
    elements.inspectorFooter?.classList.remove("hidden");
    elements.btnSave.textContent = "Save changes";
    resetFilesTab();
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
    if (options.tab && options.tab !== "ready") activateTab(options.tab);
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

export function closeInspector() {
    state.inspectorOpen = false;
    recordRoute();
    elements.inspectorPanel.classList.add("translate-x-full");
    elements.inspectorOverlay.classList.remove("opacity-100");
    clearCollectionIndexStateBanner();
    clearCollectionValidation();
    resetPhysicalCollectionsSection({ hide: true });
    elements.btnViewHistory?.classList.add("hidden");
    setTimeout(() => elements.inspectorOverlay.classList.add("hidden"), 200);
}

export function handleOverlayClick(event) {
    if (event.target === elements.inspectorOverlay) void requestCloseInspector();
}

/** Closes the inspector the user asked to close; asks first when the settings form has unsaved changes. */
export async function requestCloseInspector() {
    if (!state.inspectorOpen) return true;
    const dirty = state.selectedCollection ? hasUnsavedCollectionChanges() : Boolean(elements.editDisplayName?.value.trim());
    if (dirty) {
        const discard = await confirmDialog({
            title: "Discard your changes?",
            message: "The settings you changed have not been saved.",
            confirmLabel: "Discard changes",
            cancelLabel: "Keep editing",
            danger: true,
        });
        if (!discard) return false;
    }
    closeInspector();
    return true;
}

/** Switches to a tab and loads what it shows. */
export function activateTab(tabName) {
    const button = [...elements.tabBtns].find((item) => item.dataset.tab === tabName);
    if (!button || button.disabled) return;
    switchTab(tabName);
    if (tabName === "ready" && state.selectedCollection) updateReadinessTab();
    if (tabName === "files" && state.selectedCollection) loadCollectionFiles();
    if (tabName === "playground") updatePlaygroundCapabilityState();
}

export function switchTab(tabName) {
    state.activeTab = tabName;
    if (state.inspectorOpen) recordRoute();
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

export function setCollectionTabsEnabled(enabled) {
    [elements.readyTabBtn, elements.filesTabBtn, elements.playgroundTabBtn].forEach((button) => {
        if (!button) return;
        button.classList.toggle("hidden", !enabled);
        button.disabled = !enabled;
        if (!enabled) button.title = "Save the collection before using this tab.";
        else button.removeAttribute("title");
    });
}

export function setInspectorActionsEnabled(enabled, reason = "") {
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

export function syncSaveButtonAccess() {
    if (!elements.btnSave || state.isLoading.collectionDetail) {
        return;
    }
    const mode = elements.editId?.value ? "update" : "create";
    const capability = mode === "create" ? "createCollection" : "updateCollection";
    const allowed = canAdminAction(capability);
    // A role that cannot change the settings sees them read-only.
    if (elements.editFieldset) elements.editFieldset.disabled = !allowed;
    elements.editReadonlyNote?.classList.toggle("hidden", allowed);
    elements.btnSave.classList.toggle("hidden", !allowed);
    elements.btnSave.disabled = !allowed;
    if (!allowed) {
        elements.btnSave.title = state.auth.enabled
            ? `${mode === "create" ? "Create" : "Update"} collection requires operator access.`
            : "";
    } else {
        elements.btnSave.removeAttribute("title");
    }
}

export function resetPlaygroundResult(message = "Results will appear here...") {
    clearNode(elements.pgResult);
    elements.pgResult.appendChild(createEl("span", "text-slate-400 italic", message));
}

export function clearReadinessRefreshNotice() {
    if (!elements.readinessRefreshNotice) return;
    clearNode(elements.readinessRefreshNotice);
    elements.readinessRefreshNotice.className = "hidden rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800";
}

export function setReadinessRefreshNotice(message, tone = "warning") {
    if (!elements.readinessRefreshNotice) return;
    clearNode(elements.readinessRefreshNotice);
    const toneClasses = tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-amber-200 bg-amber-50 text-amber-800";
    elements.readinessRefreshNotice.className = `rounded-lg border p-3 text-xs ${toneClasses}`;
    elements.readinessRefreshNotice.textContent = message || "";
    elements.readinessRefreshNotice.classList.remove("hidden");
}

export function renderPhysicalCollectionsPlaceholder(message) {
    if (!elements.physicalCollectionsSection || !elements.physicalCollectionsList) return;
    elements.physicalCollectionsSection.classList.remove("hidden");
    clearNode(elements.physicalCollectionsList);
    elements.physicalCollectionsList.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500", message));
}

export function resetPhysicalCollectionsSection({ hide = false, message = "Physical collection lifecycle has not been loaded yet." } = {}) {
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

export function resetReadinessAndPlayground(message) {
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

export function getPhysicalCollectionsSummary(records) {
    return {
        active: records.filter((item) => item?.status === "active").length,
        cleanupPending: records.filter((item) => item?.status === "delete_pending").length,
        failed: records.filter((item) => item?.status === "failed_build" || item?.status === "cleanup_failed").length,
    };
}

export function createSummaryChip(label, value, tone = "muted") {
    const chip = createEl("div", "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs");
    chip.appendChild(createBadge(label, getStatusColor(tone)));
    chip.appendChild(createEl("span", "font-semibold text-slate-700", formatCount(value)));
    return chip;
}

export function getPhysicalCollectionStatusTone(status) {
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

export function createPhysicalCollectionCard(record) {
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

export function renderPhysicalCollectionsData(records) {
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

export function renderReadinessIssueList(listElement, items) {
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

export async function loadPhysicalCollections(collectionId) {
    const data = await apiRequest(adminCollectionPhysicalCollectionsUrl(collectionId));
    if (!Array.isArray(data?.physicalCollections)) {
        throw normalizeError(null, {
            status: 0,
            code: "INVALID_PHYSICAL_COLLECTIONS_RESPONSE",
            message: "The server did not return the index versions of this collection.",
        });
    }
    return data.physicalCollections;
}

/** `quiet` (background refresh): no loading notices, and nothing is redrawn when the data did not change. */
export async function updateReadinessTab({ quiet = false } = {}) {
    if (!state.selectedCollection || state.isLoading.readiness || state.isLoading.physicalCollections) return;
    const collectionId = state.selectedCollection.id;
    const hasSnapshot = Boolean(state.selectedReadiness);
    const hasPhysicalSnapshot = Array.isArray(state.selectedPhysicalCollections);
    const previousReadiness = JSON.stringify(state.selectedReadiness);
    const previousPhysical = JSON.stringify(state.selectedPhysicalCollections);
    state.isLoading.readiness = true;
    state.isLoading.physicalCollections = true;
    if (hasSnapshot) {
        if (!quiet) setReadinessRefreshNotice("Refreshing readiness...", "warning");
    } else {
        clearReadinessRefreshNotice();
        clearNode(elements.readinessStatusGrid);
        elements.readinessStatusGrid.appendChild(createEl("div", "rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500", "Loading readiness..."));
    }
    if (!hasPhysicalSnapshot) {
        renderPhysicalCollectionsPlaceholder("Loading physical collection lifecycle...");
    }
    if (!quiet || !hasSnapshot) updatePlaygroundCapabilityState(hasSnapshot ? "Refreshing readiness..." : "Readiness is loading.");

    try {
        const results = await Promise.allSettled([
            apiRequest(collectionReadyUrl(state.selectedCollection)),
            loadPhysicalCollections(collectionId),
        ]);

        if (state.selectedCollection?.id !== collectionId) return;

        const [readinessResult, physicalCollectionsResult] = results;

        if (readinessResult.status === "fulfilled") {
            state.selectedReadiness = readinessResult.value;
            const activeJob = readinessResult.value?.activeJob;
            if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
                watchJob({ ...activeJob, collectionId }, state.selectedCollection?.displayName);
                state.activeJobProgress = await loadJobProgress(activeJob.id);
            } else {
                state.activeJobProgress = null;
            }
            if (!quiet || JSON.stringify(readinessResult.value) !== previousReadiness) renderReadinessData(readinessResult.value);
            else updatePlaygroundCapabilityState();
            clearReadinessRefreshNotice();
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
                setReadinessRefreshNotice(`Could not refresh readiness (${normalizeError(error).message}). Showing the last loaded state.`, "error");
                updatePlaygroundCapabilityState("Could not refresh. Showing the last loaded readiness.");
            }
        }

        if (physicalCollectionsResult.status === "fulfilled") {
            state.selectedPhysicalCollections = physicalCollectionsResult.value;
            state.selectedPhysicalCollectionsError = null;
            if (!quiet || JSON.stringify(physicalCollectionsResult.value) !== previousPhysical) renderPhysicalCollectionsData(physicalCollectionsResult.value);
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

export function createReadinessRow(label, value, ok) {
    const row = createEl("div", "flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3");
    row.appendChild(createEl("span", "text-xs font-medium text-slate-600", label));
    if (typeof ok === "boolean") row.appendChild(createBadge(ok ? "READY" : "NOT READY", ok ? getStatusColor("ready") : getStatusColor("failed")));
    else row.appendChild(createEl("span", "break-all-words text-right text-xs font-semibold text-slate-600", stringifyForDisplay(value)));
    return row;
}

export function renderReadinessData(readiness) {
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
            `Embedding: ${availability.embeddingProvider || "-"} / ${availability.embeddingModel || "-"}`
                + (availability.embeddingServiceId ? ` via ${embeddingServiceName(availability.embeddingServiceId)}` : ""),
            availability.embeddingModelAvailable,
            Boolean(availability.embeddingModelAvailable),
        ),
        // The chat LLM is per tenant and optional; "not configured" is a valid retrieve-only setup, not a failure.
        availability.chatModel
            ? createReadinessRow(
                `Chat LLM: ${availability.chatModel}` + (availability.chatServiceId ? ` via ${chatServiceName(availability.chatServiceId)}` : ""),
                availability.chatModelAvailable,
                Boolean(availability.chatModelAvailable),
            )
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

export function getCapabilityState(mode) {
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

export function updatePlaygroundCapabilityState(fallbackReason) {
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

export async function reindexCollection() {
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
        watchJob(data?.job, state.selectedCollection.displayName);
        showToast("Re-indexing started. You can keep working; a message appears when it finishes.", "success");
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

export async function deleteCollection() {
    if (!state.selectedCollection) return;
    if (!canAdminAction("deleteCollection")) {
        showToast("Delete collection requires admin access.", "error");
        return;
    }
    const deleteNote = state.selectedCollection.sourceKind === "uploads"
        ? "Its uploaded documents are deleted too."
        : "This is a soft delete; the files in its folder are not touched.";
    const name = state.selectedCollection.displayName || state.selectedCollection.id;
    const confirmed = await confirmDialog({
        title: `Delete "${name}"?`,
        message: `${deleteNote} This cannot be undone from the panel.`,
        confirmLabel: "Delete collection",
        danger: true,
        requireText: name,
    });
    if (!confirmed) return;

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
