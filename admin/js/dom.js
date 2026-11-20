import { normalizeError } from "./api.js";
import { elements } from "./state.js";

export function clearNode(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

export function appendText(node, text) {
    if (!node) return node;
    node.appendChild(document.createTextNode(String(text ?? "")));
    return node;
}

export function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) appendText(node, text);
    return node;
}

export function appendChildren(parent, children) {
    children.filter(Boolean).forEach((child) => parent.appendChild(child));
    return parent;
}

export function createButton(label, className, onClick, attrs = {}) {
    const button = createEl("button", className, label);
    button.type = attrs.type || "button";
    if (attrs.title) button.title = attrs.title;
    if (attrs.ariaLabel) button.setAttribute("aria-label", attrs.ariaLabel);
    if (attrs.disabled) button.disabled = true;
    if (onClick) button.addEventListener("click", onClick);
    return button;
}

export function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
}

export function formatCount(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

export function formatBoolean(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "-";
}

export function formatMetric(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(value);
}

export function formatDurationSeconds(value) {
    if (value === null || value === undefined || value === "") return "-";
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return String(value);
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    const wholeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainderSeconds = wholeSeconds % 60;
    if (minutes < 60) return `${minutes} min ${remainderSeconds} sec`;
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return `${hours} hr ${remainderMinutes} min`;
}

export function stringifyForDisplay(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function shortId(value, length = 12) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

export function createBadge(text, colorClass) {
    return createEl(
        "span",
        `inline-flex items-center whitespace-nowrap px-2 py-1 text-xs font-bold rounded-full uppercase ${colorClass || "bg-slate-100 text-slate-600"}`,
        text || "unknown",
    );
}

export function getStatusColor(status) {
    const colors = {
        ready: "bg-emerald-100 text-emerald-700",
        indexing: "bg-blue-100 text-blue-700",
        creating: "bg-amber-100 text-amber-700",
        failed: "bg-rose-100 text-rose-700",
        archived: "bg-slate-100 text-slate-600",
        queued: "bg-blue-100 text-blue-700",
        running: "bg-indigo-100 text-indigo-700",
        succeeded: "bg-emerald-100 text-emerald-700",
        cancelled: "bg-slate-100 text-slate-600",
        pass: "bg-emerald-100 text-emerald-700",
        warn: "bg-amber-100 text-amber-700",
        fail: "bg-rose-100 text-rose-700",
        info: "bg-sky-100 text-sky-700",
        ok: "bg-emerald-100 text-emerald-700",
        degraded: "bg-amber-100 text-amber-700",
        inaccessible: "bg-slate-100 text-slate-600",
        muted: "bg-slate-100 text-slate-600",
        active: "bg-emerald-100 text-emerald-700",
        building: "bg-blue-100 text-blue-700",
        delete_pending: "bg-amber-100 text-amber-700",
        cleanup_failed: "bg-rose-100 text-rose-700",
        failed_build: "bg-rose-100 text-rose-700",
        retired: "bg-slate-100 text-slate-600",
        deleted: "bg-slate-100 text-slate-600",
    };
    return colors[status] || "bg-slate-100 text-slate-600";
}

export function getStatusBadge(status) {
    return createBadge(status || "unknown", getStatusColor(status));
}

export function getCollectionCardStatusPresentation(status, indexState = null) {
    if (status === "indexing") {
        return {
            label: "Indexing",
            note: "A new index is being built; searches use the previous one until it finishes.",
            tone: "info",
        };
    }

    if (status === "creating") {
        return {
            label: "Not indexed yet",
            note: "Add documents, then re-index to make it searchable.",
            tone: "warn",
        };
    }

    if (status === "failed") {
        return {
            label: "Indexing failed",
            note: "Open it to see the error.",
            tone: "fail",
        };
    }

    if (status === "archived") {
        return {
            label: "Archived",
            note: "This collection is archived and cannot be searched.",
            tone: "muted",
        };
    }

    const normalizedIndexState = isRecord(indexState) ? indexState : null;
    if (!normalizedIndexState) {
        return {
            label: "Index state unknown",
            note: "The server did not return the index state of this collection.",
            tone: "warn",
        };
    }

    if (normalizedIndexState?.status === "no_active_index") {
        return {
            label: "Not indexed yet",
            note: normalizedIndexState.note || "Add documents, then re-index to make it searchable.",
            tone: "warn",
        };
    }

    if (normalizedIndexState?.reindexRequired) {
        return {
            label: "Re-index needed",
            note: normalizedIndexState.note || "Settings or documents changed since the last index.",
            tone: "warn",
        };
    }

    return {
        label: "Ready",
        note: "Searchable and up to date.",
        tone: "ok",
    };
}

export function getCollectionCardStatusBadge(status, indexState = null) {
    const presentation = getCollectionCardStatusPresentation(status, indexState);
    return createBadge(presentation.label, getStatusColor(presentation.tone || status));
}

export function getCollectionCardStatusNote(status, indexState = null) {
    const presentation = getCollectionCardStatusPresentation(status, indexState);
    if (!presentation.note) return null;
    return createEl("p", "mt-2 text-xs text-slate-500", presentation.note);
}

export function createMetaItem(label, value, className = "") {
    const item = createEl("div", `rounded border border-slate-100 bg-white p-3 ${className}`);
    const labelNode = createEl("div", "text-[10px] font-bold uppercase tracking-wider text-slate-500", label);
    const valueNode = createEl("div", "mt-1 text-sm font-semibold text-slate-700 break-all-words", stringifyForDisplay(value));
    appendChildren(item, [labelNode, valueNode]);
    return item;
}

export function appendJsonDetails(parent, label, value) {
    if (value === null || value === undefined) return;
    const details = createEl("details", "mt-3 rounded border border-slate-200 bg-white p-3");
    const summary = createEl("summary", "cursor-pointer text-xs font-bold text-slate-500", label);
    const pre = createEl("pre", "mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600");
    try {
        pre.textContent = JSON.stringify(value, null, 2);
    } catch {
        pre.textContent = String(value);
    }
    appendChildren(details, [summary, pre]);
    parent.appendChild(details);
}

/**
 * Shows a loading text on a button and restores it afterwards: its original content (icons included) and the
 * disabled state it had before, so a button disabled for the session's role stays disabled.
 */
export function setButtonLoading(button, loading, loadingText = "Loading...") {
    if (!button) return;
    if (loading) {
        if (!button.loadingSnapshot) {
            button.loadingSnapshot = { nodes: [...button.childNodes], disabled: button.disabled };
        }
        button.disabled = true;
        button.textContent = loadingText;
        return;
    }
    const snapshot = button.loadingSnapshot;
    if (!snapshot) return;
    button.replaceChildren(...snapshot.nodes);
    button.disabled = snapshot.disabled;
    delete button.loadingSnapshot;
}

export function renderIssuesList(parent, issues) {
    if (!Array.isArray(issues) || issues.length === 0) return;
    const list = createEl("ul", "mt-2 list-disc space-y-1 pl-5 text-xs");
    issues.forEach((issue) => {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
        const message = issue.message || stringifyForDisplay(issue);
        const item = createEl("li", "", path ? `${path}: ${message}` : message);
        list.appendChild(item);
    });
    parent.appendChild(list);
}

/**
 * An error box: a title, the server's message and any field issues; code, status, request id and details
 * are folded under "Technical details".
 */
export function renderErrorBox(parent, error, title = "Request failed") {
    const normalized = normalizeError(error);
    const box = createEl("div", "rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800");
    appendChildren(box, [
        createEl("div", "font-bold", title),
        createEl("div", "mt-1 break-all-words", normalized.message),
    ]);
    renderIssuesList(box, normalized.issues);

    const technical = createEl("details", "mt-3 text-xs text-slate-600");
    technical.appendChild(createEl("summary", "cursor-pointer font-semibold text-rose-700", "Technical details"));
    const meta = createEl("div", "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3");
    meta.appendChild(createMetaItem("Code", normalized.code));
    meta.appendChild(createMetaItem("Status", normalized.status || "-"));
    meta.appendChild(createMetaItem("Request ID", normalized.requestId || "-"));
    technical.appendChild(meta);
    if (normalized.details && !normalized.issues) appendJsonDetails(technical, "Details", normalized.details);
    box.appendChild(technical);
    parent.appendChild(box);
}

export function renderApiErrorContent(parent, error, title = "Request failed") {
    clearNode(parent);
    renderErrorBox(parent, error, title);
}

export function showToast(message, type = "info", options = {}) {
    if (!elements.toastContainer) return;
    const toast = createEl(
        "div",
        `pointer-events-auto max-w-full rounded-lg p-4 text-sm font-medium shadow-lg transition-all duration-300 animate-in ${
            type === "success"
                ? "bg-emerald-600 text-white"
                : type === "error"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-800 text-white"
        }`,
    );
    const messageNode = createEl("div", "break-all-words pr-5", message || "");
    toast.classList.add("relative");
    const close = createEl("button", "absolute right-2 top-2 rounded px-1 text-white/80 hover:text-white", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => toast.remove());
    toast.append(close, messageNode);
    if (options.requestId) {
        toast.appendChild(createEl("div", "mt-1 text-xs opacity-80", `Request ID: ${options.requestId}`));
    }
    renderIssuesList(toast, options.issues);
    if (options.action) {
        const action = createEl("button", "mt-2 rounded bg-white/20 px-2 py-1 text-xs font-semibold hover:bg-white/30", options.action.label);
        action.type = "button";
        action.addEventListener("click", () => {
            options.action.onClick();
            toast.remove();
        });
        toast.appendChild(action);
    }
    elements.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("opacity-0", "translate-x-4");
        setTimeout(() => toast.remove(), 300);
    }, options.durationMs || 5000);
}

export function showErrorToast(error, fallback = "Request failed") {
    const normalized = normalizeError(error, { message: fallback });
    // A request that failed because the session ended already sent the user to the sign-in screen.
    if (normalized.sessionExpired) return;
    showToast(normalized.message, "error", {
        requestId: normalized.requestId,
        issues: normalized.issues,
        durationMs: 7000,
    });
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "-";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
