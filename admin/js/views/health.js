import { apiRequest, normalizeError } from "../api.js";
import { appendJsonDetails, appendText, clearNode, createBadge, createEl, createMetaItem, formatBoolean, formatCount, formatDateTime, formatDurationSeconds, getStatusColor, isRecord, showErrorToast, stringifyForDisplay } from "../dom.js";
import { API, elements, state } from "../state.js";
import { renderCollections } from "./collections.js";

/** `quiet` (background refresh): no "refreshing" banners and no toasts. */
export async function loadHealth({ quiet = false } = {}) {
    if (state.isLoading.health) return;
    const hasSnapshot = Boolean(state.healthStatus || state.readiness || state.readinessDetails);
    state.isLoading.health = true;

    if (hasSnapshot) {
        if (quiet) {
            // Keep the current view; it is redrawn when the results arrive.
        } else {
        renderHealthSummary(state.healthStatus, state.readiness, state.readinessDetails, { refreshing: true });
        renderReadinessDetail(state.readiness, state.readinessDetails, null, { refreshing: true });
        }
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
        // The getting-started card on an empty collections view reads this readiness.
        if (state.collections.length === 0 && !state.isLoading.collections) renderCollections();
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

        if (!quiet) {
            [healthResult, readyResult].forEach((result) => {
                if (result.status === "rejected") showErrorToast(result.reason, "Health summary failed");
            });
            if (detailsResult.status === "rejected") showErrorToast(detailsResult.reason, "Health details failed");
        }
    } finally {
        state.isLoading.health = false;
    }
}

export function dependencyStatus(dependency) {
    if (!dependency) return "unknown";
    if (dependency.ok === true) return "ok";
    if (dependency.ok === false) return "fail";
    return dependency.status || "unknown";
}

export function createInlineLoadingBar() {
    const track = createEl("div", "mt-3 h-2 overflow-hidden rounded-full bg-slate-200");
    const fill = createEl("div", "h-full w-2/3 rounded-full bg-sky-500/80 animate-pulse");
    track.appendChild(fill);
    return track;
}

export function createHealthStatusBanner(message, options = {}) {
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

export function createLoadingSkeletonCard(title) {
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

export function renderHealthLoadingState() {
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

export function renderReadinessLoadingState() {
    const container = elements.readinessDetail;
    clearNode(container);
    const notice = createEl("div", "rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800");
    notice.appendChild(createEl("div", "font-semibold", "Loading system health details..."));
    notice.appendChild(createEl("div", "mt-1 text-xs text-sky-700", "Detailed checks and operational diagnostics will appear here shortly."));
    notice.appendChild(createInlineLoadingBar());
    container.appendChild(notice);
}

export function getOperationsSnapshot(ready, details) {
    return details?.operations || ready?.operations || null;
}

export function createSummaryListCard(title, entries) {
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

export function createSummaryListCardWithId(id, title, entries) {
    const card = createSummaryListCard(title, entries);
    card.id = id;
    card.classList.add("health-cleanup-summary");
    return card;
}

export function renderOperationsSummaryCards(grid, operations) {
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

export function appendMetricSection(container, title, entries) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", title));
    const grid = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    entries.forEach(([label, value]) => {
        grid.appendChild(createMetaItem(label, value));
    });
    section.appendChild(grid);
    container.appendChild(section);
}

export function renderOperationsDetail(container, operations) {
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

    appendMetricSection(container, "Index versions", [
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

export function renderHealthSummary(health, ready, details, options = {}) {
    const grid = elements.healthGrid;
    clearNode(grid);

    if (!health && !ready && !details) {
        grid.appendChild(createEl("div", "col-span-full py-8 text-center text-slate-500 italic", "Health data unavailable."));
        return;
    }

    if (options.refreshing) {
        grid.appendChild(createHealthStatusBanner("Refreshing system health...", {
            detail: state.healthLastUpdatedAt ? `Showing the data loaded at ${formatDateTime(state.healthLastUpdatedAt)}.` : "Showing the last loaded data while it refreshes.",
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
    processGrid.appendChild(createMetaItem("Uptime (seconds)", health?.uptimeSec ? Math.round(health.uptimeSec) : "-"));
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

export function appendIssueSection(container, title, items, emptyText, colorClass) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", `mb-3 text-sm font-bold uppercase ${colorClass}`, title));
    if (!Array.isArray(items) || items.length === 0) {
        section.appendChild(createEl("p", "text-xs italic text-slate-500", emptyText));
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

export function renderChecks(container, checks) {
    const section = createEl("section", "mb-6");
    section.appendChild(createEl("h4", "mb-3 text-sm font-bold uppercase text-slate-500", "Checks"));
    if (!Array.isArray(checks) || checks.length === 0) {
        section.appendChild(createEl("p", "text-xs italic text-slate-500", "No checks available."));
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

export function renderReadinessDetail(ready, details, detailsError, options = {}) {
    const container = elements.readinessDetail;
    clearNode(container);
    const operations = getOperationsSnapshot(ready, details);

    if (options.refreshing) {
        const refreshNotice = createEl("div", "mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800");
        refreshNotice.appendChild(createEl("div", "font-semibold", "Refreshing health diagnostics..."));
        refreshNotice.appendChild(createEl("div", "mt-1 text-xs text-amber-700", state.healthLastUpdatedAt ? `Showing the data loaded at ${formatDateTime(state.healthLastUpdatedAt)}.` : "Current diagnostics stay visible until the refresh completes."));
        refreshNotice.appendChild(createInlineLoadingBar());
        container.appendChild(refreshNotice);
    } else if (options.lastUpdatedAt) {
        const snapshotNotice = createEl("div", "mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700");
        snapshotNotice.appendChild(createEl("div", "font-semibold", "Diagnostics"));
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
        container.appendChild(createEl("p", "text-sm text-slate-500 italic", "No readiness details available."));
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
    configGrid.appendChild(createMetaItem("Vector store URL (Chroma)", details?.chromaUrl ?? ready?.config?.chromaUrl ?? "-"));
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
        dataSourceSection.appendChild(createEl("p", "text-xs italic text-slate-500", "No data source details available."));
    }
    container.appendChild(dataSourceSection);

    renderOperationsDetail(container, operations);

    const deps = details?.dependencies;
    if (deps) appendJsonDetails(container, "Dependency diagnostics", deps);
}
