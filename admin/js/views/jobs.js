import { adminJobDeleteUrl, adminJobUrl, adminJobsBulkDeleteUrl, adminJobsListUrl, adminMutationRequest, apiRequest, normalizeError } from "../api.js";
import { canAdminAction } from "../auth.js";
import { appendText, clearNode, createBadge, createButton, createEl, formatCount, formatDateTime, getStatusColor, setButtonLoading, shortId, showErrorToast, showToast } from "../dom.js";
import { API, JOB_LIST_LIMIT, elements, saveKnownJobsToStorage, state } from "../state.js";
import { collectionNameById, loadCollections } from "./collections.js";
import { updateReadinessTab } from "./inspector.js";

export function buildJobRecord(job, collection, existing = {}) {
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

export function rememberJob(job, collection, options = {}) {
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

export function mergeActiveJobFromReadiness(readiness) {
    if (!readiness?.activeJob) return;
    rememberJob(readiness.activeJob, state.selectedCollection);
}

export function markJobInaccessible(jobId, error) {
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

export async function refreshJob(jobId) {
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

export async function deleteJob(jobId) {
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

export function isTerminalJobStatus(status) {
    return ["succeeded", "failed", "cancelled"].includes(status);
}

export function getVisibleSelectableJobIds(jobs = getJobViewRows()) {
    if (state.jobListSource !== "server") return [];
    return jobs
        .filter((job) => job?.id && !job.notFound && isTerminalJobStatus(job.status))
        .map((job) => job.id);
}

export function pruneSelectedJobIds(jobIds = getVisibleSelectableJobIds()) {
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

export function updateJobSelectionControls(jobs = getJobViewRows()) {
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

export function clearJobSelection({ render = true } = {}) {
    state.selectedJobIds.clear();
    if (render) renderJobs();
    else updateJobSelectionControls();
}

export async function removeSelectedJobs() {
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

export function getJobViewRows() {
    const source = state.jobListSource;
    const rows = source === "server" ? state.jobList : state.knownJobs;
    if (state.jobListStatusFilter === "all") return rows;
    return rows.filter((job) => job.status === state.jobListStatusFilter);
}

export function getJobViewEmptyMessage() {
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

export function updateJobPaginationControls() {
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

export function resetJobPagination() {
    state.jobListCursor = null;
    state.jobListCursorStack = [];
}

export async function loadJobs(options = {}) {
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

export async function refreshJobsList() {
    await loadJobs({ cursor: state.jobListCursor });
}

export async function goToNextJobsPage() {
    if (!state.jobListNextCursor || state.isLoading.jobs) return;
    state.jobListCursorStack.push(state.jobListCursor || null);
    state.jobListCursor = state.jobListNextCursor;
    await loadJobs({ cursor: state.jobListCursor });
}

export async function goToPreviousJobsPage() {
    if (state.jobListCursorStack.length === 0 || state.isLoading.jobs) return;
    const previousCursor = state.jobListCursorStack.pop() || null;
    state.jobListCursor = previousCursor;
    await loadJobs({ cursor: previousCursor });
}

export async function changeJobsStatusFilter(value) {
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

export async function cancelJob(jobId) {
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

export function removeJobFromMonitor(jobId) {
    removeJobsFromMonitor([jobId]);
}

export function removeJobsFromMonitor(jobIds, { render = true } = {}) {
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

export function appendCell(row, className, content) {
    const cell = createEl("td", `px-4 py-4 align-top text-xs ${className || ""}`);
    if (content instanceof Node) cell.appendChild(content);
    else appendText(cell, content);
    row.appendChild(cell);
    return cell;
}

export function renderJobs() {
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
