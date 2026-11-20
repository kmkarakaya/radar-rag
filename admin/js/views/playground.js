import { apiRequest, collectionQueryUrl, collectionRetrieveUrl, normalizeError } from "../api.js";
import { appendJsonDetails, clearNode, createEl, createMetaItem, formatMetric, renderErrorBox, setButtonLoading, showToast } from "../dom.js";
import { elements, state } from "../state.js";
import { chatServiceName } from "./chatSettings.js";
import { getCapabilityState, updatePlaygroundCapabilityState } from "./inspector.js";

export function setPlaygroundMode(mode) {
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

export function renderSourceFields(source, index) {
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

export function renderSourceList(parent, sources) {
    const list = Array.isArray(sources) ? sources : [];
    if (list.length === 0) {
        parent.appendChild(createEl("p", "text-sm text-slate-400 italic", "No sources returned."));
        return;
    }
    const wrapper = createEl("div", "space-y-3");
    list.forEach((source, index) => wrapper.appendChild(renderSourceFields(source, index)));
    parent.appendChild(wrapper);
}

export function renderRetrieveResult(data) {
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
    appendJsonDetails(container, "Technical details (JSON)", data);
    elements.pgResult.appendChild(container);
}

export function renderQueryResult(data) {
    clearNode(elements.pgResult);
    const container = createEl("div", "space-y-4 font-sans");
    container.appendChild(createEl("h4", "text-sm font-bold text-slate-800", "Query Result"));
    const answer = createEl("div", "whitespace-pre-wrap break-all-words rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm leading-relaxed text-slate-800", data?.answer || "No answer returned.");
    container.appendChild(answer);
    const meta = createEl("div", "grid grid-cols-1 gap-3 sm:grid-cols-2");
    meta.appendChild(createMetaItem("Threshold", formatMetric(data?.distanceScoreThreshold)));
    meta.appendChild(createMetaItem("Embedding", `${data?.embeddingProvider || "-"} / ${data?.embeddingModel || "-"}`));
    meta.appendChild(createMetaItem("Chat model", data?.chatModel
        ? `${data.chatModel}${data.chatServiceId ? ` via ${chatServiceName(data.chatServiceId)}` : ""}`
        : "-"));
    meta.appendChild(createMetaItem("Collection", data?.collectionDisplayName || data?.collectionId || state.selectedCollection?.displayName));
    meta.appendChild(createMetaItem("Active version", data?.activeVersion));
    meta.appendChild(createMetaItem("Sources", data?.sources?.length ?? 0));
    container.appendChild(meta);
    renderSourceList(container, data?.sources);
    appendJsonDetails(container, "Technical details (JSON)", data);
    elements.pgResult.appendChild(container);
}

export function renderPlaygroundError(error) {
    clearNode(elements.pgResult);
    const status = normalizeError(error).status;
    // 422: the question ran but there was nothing to answer from; 503: a dependency is not available now.
    const title = status === 422 ? "No answer" : status === 503 ? "Not available right now" : "Request failed";
    renderErrorBox(elements.pgResult, error, title);
}

export async function runPlayground() {
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
