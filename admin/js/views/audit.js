import { adminAuditLogUrl, apiRequest, normalizeError } from "../api.js";
import { switchView } from "../dashboard.js";
import { appendChildren, clearNode, createBadge, createEl, formatDateTime, getStatusColor, isRecord, renderApiErrorContent, shortId, stringifyForDisplay } from "../dom.js";
import { capitalizeWord } from "../serverInfo.js";
import { API, AUDIT_LOG_LIMIT, elements, loadTokens, state } from "../state.js";
import { collectionNameById } from "./collections.js";
import { closeInspector } from "./inspector.js";

export function normalizeAuditSelectionValues(values = [], allowedValues = []) {
    const allowedSet = new Set(allowedValues);
    return [...new Set(
        (Array.isArray(values) ? values : values ? [values] : [])
            .flatMap((value) => String(value).split(","))
            .map((value) => value.trim())
            .filter((value) => value && allowedSet.has(value)),
    )];
}

export function getAuditVisibleCollections() {
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

export function isAuditCollectionPrimary(collection) {
    return Boolean(collection?.activePhysicalCollection) || collection?.status === "ready";
}

export function normalizeAuditCollectionValues(values = []) {
    return normalizeAuditSelectionValues(values, getAuditVisibleCollections().map((collection) => collection.id));
}

/** Readable names for a few operation names that are unclear on their own; others are shown from the name. */
const AUDIT_OPERATION_LABELS = {
    delete: "Delete collection",
    job: "Job detail",
};

/** The operations in this tenant's log (GET /v1/admin/audit-log/operations), with readable labels. */
export function auditOperationOptions() {
    return state.auditOperations.map((value) => ({
        value,
        label: AUDIT_OPERATION_LABELS[value] ?? capitalizeWord(String(value).replace(/_/g, " ")),
    }));
}

export async function loadAuditOperations() {
    try {
        const data = await apiRequest(`${API.admin}/audit-log/operations`);
        state.auditOperations = Array.isArray(data?.operations) ? data.operations : [];
    } catch (error) {
        console.warn("Could not load the audit operations", error);
    }
    renderAuditFilterControls();
}

export function normalizeAuditOperationValues(values = []) {
    // Until the operations are known, keep the selection as it is.
    if (state.auditOperations.length === 0) return normalizeAuditSelectionValues(values, values.flatMap((value) => String(value).split(",")).map((value) => value.trim()));
    return normalizeAuditSelectionValues(values, auditOperationOptions().map((option) => option.value));
}

export function getAuditCollectionFilterValues() {
    return normalizeAuditCollectionValues(state.auditLogCollectionFilter);
}

export function getAuditOperationFilterValues() {
    return normalizeAuditOperationValues(state.auditLogOperationFilter);
}

export function setAuditCollectionFilterValues(values) {
    state.auditLogCollectionFilter = normalizeAuditCollectionValues(values);
}

export function setAuditOperationFilterValues(values) {
    state.auditLogOperationFilter = normalizeAuditOperationValues(values);
}

export function getAuditCollectionSummaryText() {
    const visibleCount = getAuditVisibleCollections().length;
    const selectedCount = getAuditCollectionFilterValues().length;
    if (visibleCount === 0) return "No visible collections";
    if (selectedCount === 0 || selectedCount === visibleCount) return "All visible collections";
    return `${selectedCount} collection${selectedCount === 1 ? "" : "s"} selected`;
}

export function getAuditCollectionDetailText() {
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

export function getAuditOperationSummaryText() {
    const selectedCount = getAuditOperationFilterValues().length;
    if (selectedCount === 0 || selectedCount === state.auditOperations.length) return "All operations";
    return `${selectedCount} operation${selectedCount === 1 ? "" : "s"} selected`;
}

export function getAuditOperationDetailText() {
    const selectedCount = getAuditOperationFilterValues().length;
    const total = state.auditOperations.length;
    if (selectedCount === 0 || selectedCount === total) {
        return `${total} operation${total === 1 ? "" : "s"} in the log`;
    }
    return `${selectedCount} of ${total} selected`;
}

export function renderAuditCollectionPickerList() {
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

export function renderAuditOperationPickerList() {
    if (!elements.auditOperationList) return;
    clearNode(elements.auditOperationList);

    const search = (elements.auditOperationSearch?.value || "").trim().toLowerCase();
    const selectedValues = new Set(getAuditOperationFilterValues());
    const operations = auditOperationOptions().filter((option) => {
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

export function renderAuditFilterControls() {
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

export function openAuditPicker(panelElement, triggerElement) {
    if (!panelElement || !triggerElement) return;
    panelElement.classList.remove("hidden");
    triggerElement.setAttribute("aria-expanded", "true");
}

export function closeAuditPicker(panelElement, triggerElement) {
    if (!panelElement || !triggerElement) return;
    panelElement.classList.add("hidden");
    triggerElement.setAttribute("aria-expanded", "false");
}

export function toggleAuditPicker(panelElement, triggerElement) {
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

export function closeAuditPickers() {
    closeAuditPicker(elements.auditCollectionPanel, elements.auditCollectionToggle);
    closeAuditPicker(elements.auditOperationPanel, elements.auditOperationToggle);
}

export function syncAuditLogFilterInputs() {
    renderAuditFilterControls();
}

export function getAuditStatusTone(status) {
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

export function formatAuditCollection(record) {
    if (!record?.collectionId) return "-";
    const name = collectionNameById(record.collectionId);
    return name ? `${name} (${record.collectionId})` : record.collectionId;
}

export function formatAuditCorrelation(record) {
    const parts = [];
    if (record?.requestId) parts.push(`Request ${shortId(record.requestId)}`);
    if (record?.jobId) parts.push(`Job ${shortId(record.jobId)}`);
    if (record?.physicalCollection) parts.push(`Index ${shortId(record.physicalCollection)}`);
    return parts.length > 0 ? parts.join(", ") : "-";
}

export function createAuditDetailsBlock(details) {
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

export function createAuditLogRow(record) {
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

export function updateAuditLogControls() {
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

export function getAuditLogEmptyMessage() {
    if (getAuditCollectionFilterValues().length > 0 || getAuditOperationFilterValues().length > 0) {
        return "No audit log entries found for the current filters.";
    }
    return "No audit log entries have been recorded since this deployment.";
}

export function renderAuditLogTable() {
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

export async function loadAuditLog(options = {}) {
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

export async function refreshAuditLog() {
    await loadAuditLog({ cursor: state.auditLogCursor, resetHistory: false });
}

export async function applyAuditLogFilters() {
    await loadAuditLog({ cursor: null, resetHistory: true });
}

export async function clearAuditLogFilters() {
    setAuditCollectionFilterValues([]);
    setAuditOperationFilterValues([]);
    syncAuditLogFilterInputs();
    await loadAuditLog({ cursor: null, resetHistory: true });
}

export async function goToNextAuditLogPage() {
    if (!state.auditLogNextCursor) return;
    state.auditLogCursorStack.push(state.auditLogCursor);
    await loadAuditLog({ cursor: state.auditLogNextCursor, resetHistory: false });
}

export async function goToPreviousAuditLogPage() {
    if (state.auditLogCursorStack.length === 0) return;
    const previousCursor = state.auditLogCursorStack.pop() ?? null;
    await loadAuditLog({ cursor: previousCursor, resetHistory: false });
}

export async function openAuditLogForCollection(collectionId) {
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
