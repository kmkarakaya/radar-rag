import { adminCollectionUrl, apiRequest, normalizeError } from "../api.js";
import { canAdminAction } from "../auth.js";
import { appendChildren, clearNode, createEl, formatCount, formatDateTime, getCollectionCardStatusBadge, getCollectionCardStatusNote, renderApiErrorContent, showErrorToast } from "../dom.js";
import { API, elements, state } from "../state.js";
import { normalizeAuditCollectionValues, renderAuditFilterControls } from "./audit.js";
import { openInspector, renderCollectionIndexStateBanner } from "./inspector.js";

export function collectionNameById(collectionId) {
    return state.collections.find((collection) => collection.id === collectionId)?.displayName || null;
}

export function mergeCollectionIntoState(collection) {
    if (!collection?.id) return state.selectedCollection;
    const index = state.collections.findIndex((item) => item.id === collection.id);
    const existing = index >= 0 ? state.collections[index] : {};
    const merged = { ...existing, ...collection };
    if (index >= 0) state.collections[index] = merged;
    else state.collections.push(merged);
    if (state.selectedCollection?.id === collection.id) state.selectedCollection = merged;
    if (state.selectedCollection?.id === collection.id) renderCollectionIndexStateBanner();
    return merged;
}

export async function loadAdminCollectionDetail(collectionId) {
    const data = await apiRequest(adminCollectionUrl(collectionId));
    if (!data?.collection) {
        throw normalizeError(null, {
            status: 0,
            code: "INVALID_COLLECTION_RESPONSE",
            message: "The server did not return this collection.",
        });
    }
    return data.collection;
}

/**
 * Loads GET /v1/rag/collections. `quiet` (background refresh): no loading state or toast, nothing redrawn when
 * the list did not change, and a failure keeps the last list with a notice saying when it was loaded.
 */
let collectionsRequest = null;

/** One request at a time: a call while the list is loading waits for that request instead of returning early. */
export function loadCollections(options = {}) {
    if (!collectionsRequest) {
        collectionsRequest = fetchCollections(options).finally(() => {
            collectionsRequest = null;
        });
    }
    return collectionsRequest;
}

async function fetchCollections({ quiet = false } = {}) {
    const previous = JSON.stringify(state.collections);
    const hadError = Boolean(state.collectionError);
    state.isLoading.collections = true;
    if (!quiet) {
        state.collectionError = null;
        renderCollections();
    }

    let changed = true;
    try {
        const data = await apiRequest(`${API.rag}/collections`);
        state.collections = Array.isArray(data?.collections) ? data.collections : [];
        state.collectionError = null;
        state.collectionsLoadedAt = new Date().toISOString();
        changed = !quiet || hadError || JSON.stringify(state.collections) !== previous;
    } catch (error) {
        state.collectionError = error;
        if (!quiet) {
            state.collections = [];
            showErrorToast(error, "Failed to load collections");
        }
    } finally {
        state.isLoading.collections = false;
        if (changed) {
            state.auditLogCollectionFilter = normalizeAuditCollectionValues(state.auditLogCollectionFilter);
            renderAuditFilterControls();
            renderCollections();
        }
    }
}

export function renderCollections() {
    const grid = elements.collectionsGrid;
    clearNode(grid);

    if (state.isLoading.collections && state.collections.length === 0) {
        grid.appendChild(createEl("div", "col-span-full py-12 text-center text-slate-500 italic", "Loading collections..."));
        return;
    }

    if (state.collectionError && state.collections.length > 0) {
        grid.appendChild(createEl(
            "div",
            "col-span-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800",
            `Could not refresh the collections (${normalizeError(state.collectionError).message}). Showing the list loaded at ${formatDateTime(state.collectionsLoadedAt)}.`,
        ));
    } else if (state.collectionError) {
        const errorBox = createEl("div", "col-span-full");
        renderApiErrorContent(errorBox, state.collectionError, "Failed to load collections");
        grid.appendChild(errorBox);
        return;
    }

    if (state.collections.length === 0) {
        grid.appendChild(renderGettingStarted());
        return;
    }

    state.collections.forEach((collection) => {
        const card = createEl("button", "group relative rounded-lg border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600");
        card.type = "button";
        card.addEventListener("click", () => openInspector(collection.id));

        const icon = createEl("div", "mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 font-bold text-indigo-600", (collection.displayName || "?").charAt(0).toUpperCase());
        const statusBadge = getCollectionCardStatusBadge(collection.status, collection.indexState);
        const statusNote = getCollectionCardStatusNote(collection.status, collection.indexState);
        const title = createEl("h3", "mt-3 break-all-words font-bold text-slate-800 transition-colors group-hover:text-indigo-600", collection.displayName || "Unnamed Collection");
        const desc = createEl("p", "mt-1 line-clamp-2 min-h-[2rem] text-xs text-slate-500", collection.description || "No description provided.");
        const footer = createEl("div", "mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:grid-cols-3");
        footer.appendChild(createEl("span", "", `Chunks: ${formatCount(collection.chunkCount)}`));
        footer.appendChild(createEl("span", "", `Version: ${formatCount(collection.activeVersion)}`));
        footer.appendChild(createEl("span", "", formatDateTime(collection.updatedAt)));

        appendChildren(card, [icon, statusBadge, statusNote, title, desc, footer]);
        grid.appendChild(card);
    });
}

/** No collections yet: what is ready, what is optional, and the first step (from GET /ready). */
export function renderGettingStarted() {
    const box = createEl("section", "col-span-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm");
    box.appendChild(createEl("h3", "text-lg font-semibold text-slate-800", "Get started"));
    box.appendChild(createEl("p", "mt-1 text-sm text-slate-600", "A collection is a set of documents you can search (Retrieve) and ask questions about (Query)."));

    const dependencies = state.readiness?.dependencies;
    const searchReady = dependencies ? Boolean(dependencies.chroma?.ok && dependencies.embedding?.ok) : null;
    const answersReady = dependencies ? Boolean(dependencies.chat?.ok) : null;
    const list = createEl("ol", "mt-4 space-y-3");
    const item = (done, title, text, link) => {
        const row = createEl("li", "flex items-start gap-3");
        const mark = createEl("span", `mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done === true ? "bg-emerald-100 text-emerald-700" : done === false ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`, done === true ? "\u2713" : done === false ? "!" : "\u2026");
        mark.setAttribute("aria-hidden", "true");
        const body = createEl("div", "text-sm");
        body.appendChild(createEl("div", "font-semibold text-slate-800", title));
        const detail = createEl("div", "text-slate-600", text);
        if (link) {
            const anchor = createEl("a", "ml-1 text-indigo-600 underline", link.label);
            anchor.href = link.href;
            detail.appendChild(anchor);
        }
        body.appendChild(detail);
        row.append(mark, body);
        list.appendChild(row);
    };
    item(
        searchReady,
        "Search is ready",
        searchReady === null ? "Checking the vector store and the embedding..." : searchReady ? "The vector store and the embedding model are available." : "The vector store or the embedding is not available.",
        searchReady === false ? { label: "See System health", href: "#/health" } : null,
    );
    item(
        answersReady,
        "Answers (optional)",
        answersReady ? "A chat LLM writes answers for Query." : "Without a chat LLM, Retrieve works and Query is off.",
        answersReady ? null : { label: "Choose one under Chat services", href: "#/services/chat" },
    );
    item(null, "Create your first collection", "Then upload documents and re-index it.");
    box.appendChild(list);

    if (canAdminAction("createCollection")) {
        const create = createEl("button", "mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700", "New collection");
        create.type = "button";
        create.addEventListener("click", () => { location.hash = "#/collections/new"; });
        box.appendChild(create);
    } else {
        box.appendChild(createEl("p", "mt-5 text-xs text-slate-500", "Your role can view collections but not create them."));
    }
    return box;
}
