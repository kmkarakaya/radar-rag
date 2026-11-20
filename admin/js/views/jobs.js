import { adminJobDeleteUrl, adminJobUrl, adminJobsBulkDeleteUrl, adminJobsListUrl, adminMutationRequest, apiRequest, normalizeError } from "../api.js";
import { canAdminAction } from "../auth.js";
import { confirmDialog } from "../dialog.js";
import { appendText, clearNode, createBadge, createButton, createEl, formatCount, formatDateTime, getStatusColor, setButtonLoading, shortId, showErrorToast, showToast } from "../dom.js";
import { watchJob } from "../jobWatch.js";
import { API, JOB_LIST_LIMIT, elements, state } from "../state.js";
import { collectionNameById, loadCollections } from "./collections.js";
import { updateReadinessTab } from "./inspector.js";

/** A row of the jobs table: the job as the server returned it, plus the collection's display name. */
export function toJobRow(job, collection) {
    if (!job?.id) return null;
    return {
        ...job,
        collectionDisplayName: collection?.displayName ?? collectionNameById(job.collectionId) ?? null,
    };
}

export async function refreshJob(jobId) {
    try {
        const data = await apiRequest(adminJobUrl(jobId));
        const row = toJobRow(data?.job);
        const index = state.jobList.findIndex((job) => job.id === jobId);
        if (row && index >= 0) state.jobList[index] = row;
        renderJobs();
    } catch (error) {
        if (normalizeError(error).status === 404) {
            showToast("This job no longer exists.", "info");
            await loadJobs();
            return;
        }
        throw error;
    }
}

export async function deleteJob(jobId) {
    if (!canAdminAction("deleteJob")) {
        showToast("Removing a job needs the admin role.", "error");
        return;
    }
    if (state.selectedJobIds.size > 0 && state.selectedJobIds.has(jobId)) {
        await removeSelectedJobs();
        return;
    }

    const confirmed = await confirmDialog({
        title: "Remove this job from the list?",
        message: "Only the job record is removed; the collection and its index stay as they are.",
        confirmLabel: "Remove",
    });
    if (!confirmed) return;

    try {
        await adminMutationRequest(adminJobDeleteUrl(jobId), { method: "DELETE" });
        dropJobsFromList([jobId]);
        showToast("Job removed.", "success");
    } catch (error) {
        if (normalizeError(error).status === 404) showToast("The job was already removed.", "info");
        else showErrorToast(error, "Remove failed");
    }
    resetJobPagination();
    await loadJobs({ cursor: null });
}

export function isTerminalJobStatus(status) {
    return ["succeeded", "failed", "cancelled"].includes(status);
}

export function getVisibleSelectableJobIds(jobs = getJobViewRows()) {
    return jobs
        .filter((job) => job?.id && isTerminalJobStatus(job.status))
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
        elements.jobsBulkActionBar.classList.toggle("hidden", !hasSelectableJobs || !canAdminAction("bulkDeleteJobs"));
    }
    if (elements.jobsBulkSelectionCount) {
        elements.jobsBulkSelectionCount.textContent = selectedCount === 0
            ? `${selectableJobIds.length} terminal job${selectableJobIds.length === 1 ? "" : "s"} on this page`
            : selectedCount === 1
                ? "1 job selected"
                : `${selectedCount} jobs selected`;
    }
    if (elements.jobsBulkRemove) {
        elements.jobsBulkRemove.disabled = selectedCount === 0 || state.isLoading.jobs || !canAdminAction("bulkDeleteJobs");
        elements.jobsBulkRemove.textContent = selectedCount === 0 ? "Select jobs to remove" : "Remove selected";
        if (!canAdminAction("bulkDeleteJobs")) {
            elements.jobsBulkRemove.title = state.auth.enabled ? "Bulk delete requires admin access." : "";
        } else {
            elements.jobsBulkRemove.removeAttribute("title");
        }
    }
    if (elements.jobsSelectAll) {
        elements.jobsSelectAll.disabled = !hasSelectableJobs || state.isLoading.jobs;
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
    if (!canAdminAction("bulkDeleteJobs")) {
        showToast("Bulk delete requires admin access.", "error");
        return;
    }

    const jobIds = getVisibleSelectableJobIds().filter((jobId) => state.selectedJobIds.has(jobId));
    if (jobIds.length === 0) {
        showToast("Select one or more terminal jobs to remove.", "info");
        return;
    }
    const confirmed = await confirmDialog({
        title: `Remove ${jobIds.length} job${jobIds.length === 1 ? "" : "s"} from the list?`,
        message: "Only the job records are removed; collections and their indexes stay as they are.",
        confirmLabel: "Remove",
    });
    if (!confirmed) return;

    try {
        await adminMutationRequest(adminJobsBulkDeleteUrl(), {
            method: "POST",
            body: JSON.stringify({ jobIds }),
        });
        showToast(`${jobIds.length} job${jobIds.length === 1 ? "" : "s"} removed.`, "success");
    } catch (error) {
        if (normalizeError(error).status === 404) showToast("One or more selected jobs were already removed.", "info");
        else showErrorToast(error, "Bulk remove failed");
    }
    clearJobSelection({ render: false });
    resetJobPagination();
    await loadJobs({ cursor: null });
}

export function getJobViewRows() {
    // The server filters by status (GET /v1/admin/jobs?status=...).
    return state.jobList;
}

export function getJobViewEmptyMessage() {
    if (state.jobListError) {
        return `Could not load jobs: ${normalizeError(state.jobListError).message}`;
    }
    if (!state.jobListLoadedAt) {
        return "Loading jobs...";
    }
    if (state.jobListStatusFilter !== "all") {
        return `No ${state.jobListStatusFilter} jobs.`;
    }
    return "No jobs yet. Re-indexing a collection creates one.";
}

/** When a refresh failed but an older list is still shown, say so and when that list was loaded. */
export function renderJobListNotice() {
    const notice = elements.jobsListNotice;
    if (!notice) return;
    const stale = Boolean(state.jobListError) && state.jobList.length > 0;
    notice.classList.toggle("hidden", !stale);
    notice.textContent = stale
        ? `Could not refresh the job list (${normalizeError(state.jobListError).message}). Showing the list loaded at ${formatDateTime(state.jobListLoadedAt)}.`
        : "";
}

export function updateJobPaginationControls() {
    if (elements.jobsPrevPage) {
        elements.jobsPrevPage.disabled = state.jobListCursorStack.length === 0 || state.isLoading.jobs;
    }
    if (elements.jobsNextPage) {
        elements.jobsNextPage.disabled = !state.jobListNextCursor || state.isLoading.jobs;
    }
    if (elements.jobsPageInfo) {
        elements.jobsPageInfo.textContent = `Page ${state.jobListCursorStack.length + 1}`;
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

/**
 * Loads one page of GET /v1/admin/jobs. `quiet` (background refresh) shows no toast; a failure keeps the
 * previous page on screen with a notice saying when it was loaded.
 */
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
        state.jobList = jobs.map((entry) => toJobRow(entry?.job, entry?.collection)).filter(Boolean);
        // Running jobs seen here are followed too, so their end is announced wherever the user is.
        state.jobList.forEach((job) => watchJob(job, job.collectionDisplayName));
        state.jobListError = null;
        state.jobListNextCursor = data?.nextCursor || null;
        state.jobListLoadedAt = new Date().toISOString();
    } catch (error) {
        state.jobListError = error;
        state.jobListNextCursor = null;
        if (!options.quiet) showErrorToast(error, "Failed to load jobs");
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
        showToast("Cancelling a job needs the operator role.", "error");
        return;
    }
    const confirmed = await confirmDialog({
        title: "Cancel this job?",
        message: "Indexing stops; the collection keeps serving its previous index.",
        confirmLabel: "Cancel job",
        cancelLabel: "Keep running",
        danger: true,
    });
    if (!confirmed) return;
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

/** Drops jobs the server just deleted from the page on screen, before the list reloads. */
export function dropJobsFromList(jobIds) {
    const ids = new Set((jobIds || []).filter(Boolean));
    state.jobList = state.jobList.filter((job) => !ids.has(job.id));
    for (const jobId of ids) state.selectedJobIds.delete(jobId);
    renderJobs();
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

    renderJobListNotice();

    if (jobs.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-6 py-12 text-center text-slate-500 italic");
        cell.colSpan = 9;
        cell.appendChild(createEl("div", "", getJobViewEmptyMessage()));
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    jobs.forEach((job) => {
        const isSelectable = isTerminalJobStatus(job.status);
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
        appendCell(row, "", collectionNode);

        appendCell(row, "", createBadge(job.status, getStatusColor(job.status)));

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

        appendCell(row, "max-w-xs break-all-words text-rose-600", job.error || "-");

        const actions = createEl("div", "flex flex-wrap justify-end gap-2");
        actions.appendChild(createButton("Refresh", "text-xs font-medium text-indigo-600 hover:text-indigo-800", () => refreshJob(job.id).catch((error) => {
            showErrorToast(error, "Refresh failed");
            renderJobs();
        }), { title: "Refresh this job" }));
        if ((job.status === "queued" || job.status === "running") && canCancelJob) {
            actions.appendChild(createButton("Cancel", "text-xs font-medium text-rose-600 hover:text-rose-800", () => cancelJob(job.id), { title: "Cancel this job" }));
        }
        if (isTerminalJobStatus(job.status) && canDeleteJob) {
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
