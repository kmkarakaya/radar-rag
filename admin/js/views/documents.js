import { adminCollectionFilesUrl, adminMutationRequest, apiRequest } from "../api.js";
import { canAdminAction } from "../auth.js";
import { confirmDialog } from "../dialog.js";
import { appendText, clearNode, createButton, createEl, formatBytes, formatCount, formatDateTime, showErrorToast, showToast } from "../dom.js";
import { describeUploadLimits } from "../serverInfo.js";
import { elements, state } from "../state.js";
import { loadAdminCollectionDetail, mergeCollectionIntoState } from "./collections.js";
import { syncSourceKindFields } from "./editor.js";
import { reindexCollection, renderCollectionIndexStateBanner } from "./inspector.js";

// ---- Documents tab (a client of the files API) ----

export function resetFilesTab() {
    state.files = { collectionId: null, data: null, loading: false, uploading: false, error: null, rejected: [] };
    renderCollectionFiles();
}

export function setFilesUploadStatus(text) {
    if (!elements.filesUploadStatus) return;
    elements.filesUploadStatus.textContent = text || "";
    elements.filesUploadStatus.classList.toggle("hidden", !text);
}

export async function loadCollectionFiles({ quiet = false } = {}) {
    const id = state.selectedCollection?.id;
    if (!id) return;
    if (!quiet) {
        state.files.loading = true;
        renderCollectionFiles();
    }
    try {
        const data = await apiRequest(adminCollectionFilesUrl(id));
        if (state.selectedCollection?.id !== id) return;
        state.files.collectionId = id;
        state.files.data = data;
        state.files.error = null;
    } catch (error) {
        if (state.selectedCollection?.id !== id) return;
        state.files.error = error;
        if (!quiet) showErrorToast(error, "Failed to load documents");
    } finally {
        if (state.selectedCollection?.id === id) {
            state.files.loading = false;
            renderCollectionFiles();
        }
    }
}

export function renderCollectionFiles() {
    if (!elements.tabFiles) return;
    const files = state.files || {};
    const data = files.data;
    const canManage = canAdminAction("manageDocuments");
    const writable = Boolean(data?.writable);
    clearNode(elements.filesList);
    clearNode(elements.filesRejected);
    elements.filesRejected.classList.add("hidden");

    if (!data) {
        elements.filesIntro.textContent = files.loading
            ? "Loading documents..."
            : files.error ? "The documents could not be loaded." : "";
        elements.filesDropZone.classList.add("hidden");
        elements.filesChangedBanner.classList.add("hidden");
        return;
    }

    elements.filesIntro.textContent = writable
        ? "Documents of this collection. Uploading a file with an existing name replaces it. Re-index after changes to make them searchable."
        : `This collection reads a folder on the server (${state.selectedCollection?.sourcePath || "its source path"}). Manage its files there, then re-index; this list is read-only.`;

    elements.filesDropZone.classList.toggle("hidden", !writable || !canManage);
    elements.filesDropZone.classList.toggle("opacity-50", Boolean(files.uploading));
    elements.filesDropZone.classList.toggle("pointer-events-none", Boolean(files.uploading));
    elements.filesDropHint.textContent = describeUploadLimits();

    const indexState = data.indexState || state.selectedCollection?.indexState;
    const fileCount = Array.isArray(data.files) ? data.files.length : 0;
    const needsIndex = fileCount > 0 && (indexState?.documentsChanged || indexState?.status === "no_active_index");
    elements.filesChangedBanner.classList.toggle("hidden", !needsIndex);
    if (needsIndex) {
        elements.filesChangedText.textContent = indexState?.status === "no_active_index"
            ? "These documents are not indexed yet. Re-index to make them searchable."
            : "Documents changed since the last index. Re-index to search the current documents.";
        const canReindex = canAdminAction("reindexCollection");
        elements.btnFilesReindex.disabled = !canReindex;
        elements.btnFilesReindex.classList.toggle("opacity-50", !canReindex);
        if (!canReindex) elements.btnFilesReindex.title = "Re-index requires operator access.";
        else elements.btnFilesReindex.removeAttribute("title");
    }

    if (files.rejected?.length) {
        elements.filesRejected.classList.remove("hidden");
        elements.filesRejected.appendChild(createEl("p", "font-semibold mb-1", "Not uploaded:"));
        const list = createEl("ul", "list-disc pl-4 space-y-1");
        files.rejected.forEach((item) => list.appendChild(createEl("li", "", `${item.name}: ${item.reason}`)));
        elements.filesRejected.appendChild(list);
    }

    if (fileCount === 0) {
        elements.filesList.appendChild(createEl(
            "p",
            "text-sm text-slate-500 italic",
            writable ? "No documents yet. Drop files above to upload them." : "No files were found in this folder.",
        ));
        return;
    }

    elements.filesList.appendChild(createEl("p", "text-xs text-slate-500", `${formatCount(fileCount)} files · ${formatBytes(data.totalBytes)}`));
    const wrapper = createEl("div", "overflow-x-auto rounded-lg border border-slate-200");
    const table = createEl("table", "w-full text-sm");
    const head = createEl("thead", "bg-slate-50 text-xs uppercase text-slate-500");
    const headRow = createEl("tr");
    ["Name", "Size", "Modified", ""].forEach((label) => headRow.appendChild(createEl("th", "px-3 py-2 text-left font-semibold", label)));
    head.appendChild(headRow);
    table.appendChild(head);
    const body = createEl("tbody", "divide-y divide-slate-100");
    data.files.forEach((file) => {
        const row = createEl("tr", "hover:bg-slate-50");
        const nameCell = createEl("td", "px-3 py-2 text-slate-800 break-all");
        appendText(nameCell, file.name);
        if (!file.supported) nameCell.appendChild(createEl("span", "ml-2 text-xs text-amber-600", "(not indexed)"));
        row.appendChild(nameCell);
        row.appendChild(createEl("td", "px-3 py-2 text-slate-500 whitespace-nowrap", formatBytes(file.sizeBytes)));
        row.appendChild(createEl("td", "px-3 py-2 text-slate-500 whitespace-nowrap", formatDateTime(file.modifiedAt)));
        const actionCell = createEl("td", "px-3 py-2 text-right");
        if (writable && canManage) {
            actionCell.appendChild(createButton(
                "Delete",
                "text-red-500 hover:text-red-700 text-xs font-bold",
                () => deleteCollectionDocument(file.name),
                { title: `Delete ${file.name}` },
            ));
        }
        row.appendChild(actionCell);
        body.appendChild(row);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    elements.filesList.appendChild(wrapper);
}

export async function refreshSelectedCollectionAfterFileChange() {
    const id = state.selectedCollection?.id;
    if (!id) return;
    try {
        const detail = await loadAdminCollectionDetail(id);
        if (state.selectedCollection?.id === id) {
            state.selectedCollection = mergeCollectionIntoState(detail);
            renderCollectionIndexStateBanner();
        }
    } catch (error) {
        console.warn("Failed to refresh the collection after a document change", error);
    }
    await loadCollectionFiles({ quiet: true });
}

export async function uploadCollectionDocuments(fileList) {
    const collection = state.selectedCollection;
    const files = Array.from(fileList || []);
    if (!collection || files.length === 0) return;
    if (!canAdminAction("manageDocuments")) {
        showToast("Uploading documents requires operator access.", "error");
        return;
    }
    if (state.files.uploading) return;
    state.files.uploading = true;
    state.files.rejected = [];
    renderCollectionFiles();
    const uploaded = [];
    try {
        // One request per batch of the server's per-request limit; each mutation gets its own action token.
        const batchSize = state.serverInfo?.uploads?.maxFilesPerRequest || files.length;
        for (let start = 0; start < files.length; start += batchSize) {
            const batch = files.slice(start, start + batchSize);
            setFilesUploadStatus(`Uploading ${start + 1}-${start + batch.length} of ${files.length}...`);
            const form = new FormData();
            batch.forEach((file) => form.append("files", file, file.name));
            try {
                const result = await adminMutationRequest(adminCollectionFilesUrl(collection.id), { method: "POST", body: form });
                uploaded.push(...(result?.uploaded || []));
                state.files.rejected.push(...(result?.rejected || []));
            } catch (error) {
                if (Array.isArray(error?.details?.rejected)) state.files.rejected.push(...error.details.rejected);
                else throw error;
            }
        }
        if (uploaded.length > 0) {
            showToast(`Uploaded ${uploaded.length} document${uploaded.length === 1 ? "" : "s"}. Re-index to make them searchable.`, "success");
        }
        if (state.files.rejected.length > 0) {
            showToast(`${state.files.rejected.length} file(s) were not uploaded. See the Documents tab.`, "error");
        }
    } catch (error) {
        showErrorToast(error, "Upload failed");
    } finally {
        state.files.uploading = false;
        setFilesUploadStatus("");
        await refreshSelectedCollectionAfterFileChange();
    }
}

export async function deleteCollectionDocument(fileName) {
    const collection = state.selectedCollection;
    if (!collection) return;
    if (!canAdminAction("manageDocuments")) {
        showToast("Deleting documents requires operator access.", "error");
        return;
    }
    const confirmed = await confirmDialog({
        title: `Delete "${fileName}"?`,
        message: "The file is removed from the server and its passages are removed from search at once.",
        confirmLabel: "Delete file",
        danger: true,
    });
    if (!confirmed) return;
    try {
        await adminMutationRequest(adminCollectionFilesUrl(collection.id, fileName), { method: "DELETE" });
        showToast(`Deleted ${fileName}. It no longer appears in search results.`, "success");
    } catch (error) {
        showErrorToast(error, "Delete failed");
    } finally {
        await refreshSelectedCollectionAfterFileChange();
    }
}

export function bindDocumentsTabEvents() {
    const zone = elements.filesDropZone;
    if (zone) {
        ["dragenter", "dragover"].forEach((type) => zone.addEventListener(type, (event) => {
            event.preventDefault();
            zone.classList.add("border-indigo-500", "bg-indigo-50");
        }));
        ["dragleave", "drop"].forEach((type) => zone.addEventListener(type, () => {
            zone.classList.remove("border-indigo-500", "bg-indigo-50");
        }));
        zone.addEventListener("drop", (event) => {
            event.preventDefault();
            uploadCollectionDocuments(event.dataTransfer?.files);
        });
    }
    elements.filesInput?.addEventListener("change", (event) => {
        const input = event.target;
        uploadCollectionDocuments(input.files).finally(() => {
            input.value = "";
        });
    });
    elements.btnFilesReindex?.addEventListener("click", () => reindexCollection());
    document.querySelectorAll('input[name="sourceKind"]').forEach((radio) => {
        radio.addEventListener("change", () => syncSourceKindFields(null));
    });
}
