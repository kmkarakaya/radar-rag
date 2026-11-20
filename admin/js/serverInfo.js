import { apiRequest } from "./api.js";
import { clearNode, createEl, formatBytes } from "./dom.js";
import { API, elements, state } from "./state.js";
import { syncExternalProviderOption } from "./views/editor.js";

/**
 * Server facts from GET /v1/admin/server-info: version, upload limits, allowed values and service presets.
 * The panel keeps no copy of them; until they load (or if they cannot), the controls that need them stay generic.
 */

/** Readable labels for values the API returns; an unknown value is shown as it is. */
const PROVIDER_LABELS = {
    builtin: "Built-in (runs in the backend, downloaded on first use)",
    "openai-compatible": "External service (OpenAI-compatible API)",
};
const METRIC_LABELS = {
    l2: "L2 (Euclidean)",
    cosine: "Cosine",
    ip: "Inner product",
};

export function capitalizeWord(value) {
    const text = String(value ?? "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export async function loadServerInfo() {
    try {
        state.serverInfo = await apiRequest(`${API.admin}/server-info`);
    } catch (error) {
        console.warn("Could not load server info", error);
        state.serverInfo = null;
    }
    applyServerInfo();
}

/** Rebuilds a select's options after its fixed first options, keeping the current value when it still exists. */
function rebuildSelectOptions(select, keepFirst, values, labelFor) {
    if (!select || !Array.isArray(values)) return;
    const current = select.value;
    while (select.options.length > keepFirst) select.remove(keepFirst);
    for (const value of values) {
        const option = createEl("option", "", labelFor(value));
        option.value = value;
        select.appendChild(option);
    }
    // A value set before the options existed (it could not stick) is kept in data-value.
    const wanted = current || select.dataset.value || "";
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
}

export function applyServerInfo() {
    const info = state.serverInfo;
    if (elements.appVersion) elements.appVersion.textContent = info?.version ? `v${info.version}` : "";
    if (elements.filesInput) {
        if (info?.uploads?.extensions) elements.filesInput.setAttribute("accept", info.uploads.extensions.join(","));
        else elements.filesInput.removeAttribute("accept");
    }
    rebuildSelectOptions(elements.jobsStatusFilter, 1, info?.jobStatuses, capitalizeWord);
    if (elements.jobsStatusFilter) elements.jobsStatusFilter.value = state.jobListStatusFilter;
    rebuildSelectOptions(elements.editEmbeddingProvider, 1, info?.embeddingProviders, (value) => PROVIDER_LABELS[value] ?? value);
    rebuildSelectOptions(elements.editDistanceMetric, 1, info?.distanceMetrics, (value) => METRIC_LABELS[value] ?? value);
    syncExternalProviderOption();
    renderServicePresets();
}

/** "Examples" buttons of the service forms, from servicePresets (kinds says which form each fits). */
export function renderServicePresets() {
    for (const [kind, container] of [["embedding", elements.esPresets], ["chat", elements.csPresets]]) {
        if (!container) continue;
        clearNode(container);
        const presets = (state.serverInfo?.servicePresets ?? []).filter((preset) => preset.kinds?.includes(kind));
        container.classList.toggle("hidden", presets.length === 0);
        if (presets.length === 0) continue;
        container.appendChild(createEl("span", "text-slate-500", "Examples:"));
        for (const preset of presets) {
            const button = createEl("button", "rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50", preset.label);
            button.type = "button";
            button.dataset.presetId = preset.id;
            container.appendChild(button);
        }
    }
}

export function findServicePreset(id) {
    return (state.serverInfo?.servicePresets ?? []).find((preset) => preset.id === id) ?? null;
}

/** "Up to 20 files at a time, 50 MB each" from the server limits; empty until they are known. */
export function describeUploadLimits() {
    const uploads = state.serverInfo?.uploads;
    if (!uploads) return "";
    const parts = [];
    if (Array.isArray(uploads.extensions)) parts.push(uploads.extensions.join(", "));
    if (uploads.maxFilesPerRequest) parts.push(`up to ${uploads.maxFilesPerRequest} files at a time`);
    if (uploads.maxFileSizeBytes) parts.push(`${formatBytes(uploads.maxFileSizeBytes)} each`);
    return parts.join(" · ");
}
