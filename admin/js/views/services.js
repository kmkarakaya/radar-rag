import { adminMutationRequest, apiRequest } from "../api.js";
import { canAdminAction } from "../auth.js";
import { switchView } from "../dashboard.js";
import { clearNode, createButton, createEl, formatCount, setButtonLoading, showErrorToast, showToast } from "../dom.js";
import { findServicePreset } from "../serverInfo.js";
import { API, elements, state } from "../state.js";
import { bindChatSettingsEvents, loadChatSettings } from "./chatSettings.js";
import { loadModelDiscovery, syncModelDiscoveryPanel } from "./editor.js";
import { closeInspector } from "./inspector.js";

// ---- Service views (clients of /v1/admin/embedding-services and /v1/admin/chat-services) ----
// Both views show the same table and form over the same API contract; the server decides everything
// (read-only entries, in-use checks, warnings). Only texts and the "used by" column differ.

export function emptyServiceViewState() {
    return { loaded: false, loading: false, items: [], warnings: [], error: null, testing: false, saving: false };
}

export function emptyEmbeddingServicesState() {
    return emptyServiceViewState();
}

export function embeddingServicesUrl(id) {
    const base = `${API.admin}/embedding-services`;
    return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

export function chatServicesUrl(id) {
    const base = `${API.admin}/chat-services`;
    return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

export const SERVICE_VIEWS = {
    embedding: {
        stateKey: "embeddingServices",
        url: embeddingServicesUrl,
        capability: "manageEmbeddingServices",
        noun: "embedding service",
        prefix: "es",
        buttonPrefix: "Es",
        addButtonId: "btnAddEmbeddingService",
        serverEnv: "RAG_EMBEDDING_BASE_URL",
        usageText: (service) => formatCount(service.collectionCount ?? 0),
        modelHint: "Pick an embedding model (such as bge-m3 or nomic-embed-text) for a collection; chat models fail at indexing.",
        afterChange: () => loadModelDiscovery(),
        inUseMessage(error, service) {
            const users = Array.isArray(error?.details?.collections) ? error.details.collections : [];
            return error?.code === "EMBEDDING_SERVICE_IN_USE" && users.length > 0
                ? `${service.name} is used by: ${users.map((collection) => collection.displayName).join(", ")}. Switch them to another service first.`
                : null;
        },
    },
    chat: {
        stateKey: "chatServices",
        url: chatServicesUrl,
        capability: "manageChatServices",
        noun: "chat service",
        prefix: "cs",
        buttonPrefix: "Cs",
        addButtonId: "btnAddChatService",
        serverEnv: "RAG_CHAT_BASE_URL",
        usageText: (service) => (service.inUse ? "Answers Query" : "-"),
        modelHint: "Choose a chat model (such as gemma3:4b or gpt-4o-mini) under Answer generation; embedding models cannot answer.",
        afterChange: () => Promise.all([loadModelDiscovery(), loadChatSettings()]),
        inUseMessage(error, service) {
            return error?.code === "CHAT_SERVICE_IN_USE"
                ? `${service.name} answers Query. Choose another chat service under Answer generation, or use the server default, first.`
                : null;
        },
    },
};

export function serviceEl(view, name) {
    return document.getElementById(`${view.prefix}${name}`);
}

export function serviceButton(view, name) {
    return document.getElementById(`btn${view.buttonPrefix}${name}`);
}

export function capitalizeFirst(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function loadServices(view) {
    const services = state[view.stateKey];
    services.loading = true;
    renderServices(view);
    try {
        const data = await apiRequest(view.url());
        services.items = Array.isArray(data?.services) ? data.services : [];
        services.warnings = Array.isArray(data?.warnings) ? data.warnings : [];
        services.error = null;
        services.loaded = true;
    } catch (error) {
        services.error = error;
        showErrorToast(error, `Failed to load ${view.noun}s`);
    } finally {
        services.loading = false;
        renderServices(view);
    }
}

export function renderServices(view) {
    const tableBody = serviceEl(view, "TableBody");
    if (!tableBody) return;
    const services = state[view.stateKey];
    const canManage = canAdminAction(view.capability);

    const warningsBox = serviceEl(view, "Warnings");
    warningsBox.classList.toggle("hidden", services.warnings.length === 0);
    clearNode(warningsBox);
    services.warnings.forEach((warning) => warningsBox.appendChild(createEl("p", "", warning)));

    const addButton = document.getElementById(view.addButtonId);
    if (addButton) {
        addButton.disabled = !canManage;
        addButton.classList.toggle("opacity-50", !canManage);
        if (!canManage) addButton.title = `Managing ${view.noun}s requires admin access.`;
        else addButton.removeAttribute("title");
    }

    clearNode(tableBody);
    if (services.loading && services.items.length === 0) {
        const row = createEl("tr");
        const cell = createEl("td", "px-4 py-6 text-center text-slate-400 italic", `Loading ${view.noun}s...`);
        cell.colSpan = 6;
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    services.items.forEach((service) => {
        const row = createEl("tr", "hover:bg-slate-50");
        row.appendChild(createEl("td", "px-4 py-3 font-medium text-slate-800", service.name));
        const isBuiltin = service.source === "builtin";
        const builtinModels = Array.isArray(service.models) ? service.models : [];
        const urlText = isBuiltin
            ? `No URL: runs inside the backend. Model${builtinModels.length === 1 ? "" : "s"}: ${builtinModels.join(", ") || "-"}`
            : service.configured === false ? `Not configured (${view.serverEnv})` : service.baseUrl || "-";
        row.appendChild(createEl("td", "px-4 py-3 text-slate-600 break-all", urlText));
        row.appendChild(createEl("td", "px-4 py-3 text-slate-600", isBuiltin ? "Not needed" : service.apiKeyConfigured ? "Set" : "Not set"));
        const sourceText = { builtin: "Built-in (read-only)", server: ".env / config (read-only)" }[service.source] || "Admin panel / API";
        row.appendChild(createEl("td", "px-4 py-3 text-slate-500", sourceText));
        row.appendChild(createEl("td", "px-4 py-3 text-slate-600", view.usageText(service)));
        const actions = createEl("td", "px-4 py-3 text-right whitespace-nowrap space-x-3");
        if (!isBuiltin && service.configured !== false && canManage) {
            actions.appendChild(createButton("Test", "text-indigo-600 hover:text-indigo-800 text-xs font-bold", () => testService(view, { serviceId: service.id }, service.name)));
        }
        if (!service.readOnly && canManage) {
            actions.appendChild(createButton("Edit", "text-slate-600 hover:text-slate-800 text-xs font-bold", () => openServiceForm(view, service)));
            actions.appendChild(createButton("Delete", "text-red-500 hover:text-red-700 text-xs font-bold", () => deleteServiceAction(view, service)));
        }
        row.appendChild(actions);
        tableBody.appendChild(row);
    });
}

export function openServiceForm(view, service = null) {
    if (!canAdminAction(view.capability)) {
        showToast(`Managing ${view.noun}s requires admin access.`, "error");
        return;
    }
    serviceEl(view, "Form").classList.remove("hidden");
    serviceEl(view, "FormId").value = service?.id || "";
    serviceEl(view, "FormTitle").textContent = service ? `Edit ${service.name}` : `Add ${view.noun}`;
    serviceEl(view, "Name").value = service?.name || "";
    serviceEl(view, "BaseUrl").value = service?.baseUrl || "";
    serviceEl(view, "ApiKey").value = "";
    serviceEl(view, "ApiKeyHint").textContent = service?.apiKeyConfigured
        ? "An API key is stored. Leave this empty to keep it, or type a new one."
        : "Optional; a local Ollama needs none. Stored on the server and never shown again.";
    serviceEl(view, "ClearKey").checked = false;
    serviceEl(view, "ClearKeyRow").classList.toggle("hidden", !service?.apiKeyConfigured);
    setServiceTestResult(view, null);
    serviceEl(view, "Name").focus();
}

export function closeServiceForm(view) {
    const form = serviceEl(view, "Form");
    if (!form) return;
    form.classList.add("hidden");
    serviceEl(view, "FormId").value = "";
    serviceEl(view, "ApiKey").value = "";
    setServiceTestResult(view, null);
}

export function setServiceTestResult(view, result) {
    const box = serviceEl(view, "TestResult");
    if (!box) return;
    clearNode(box);
    box.classList.toggle("hidden", !result);
    if (!result) return;
    const ok = result.ok === true;
    box.className = `rounded-lg border p-3 text-xs ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-700"}`;
    const models = Array.isArray(result.models) ? result.models : [];
    box.appendChild(createEl("p", "font-semibold", ok
        ? `Connected: ${models.length} model(s).`
        : `Not connected: ${result.error || "the service did not answer."}`));
    if (models.length > 0) {
        box.appendChild(createEl("p", "mt-1", `${models.slice(0, 15).join(", ")}${models.length > 15 ? ", ..." : ""}`));
        box.appendChild(createEl("p", "mt-1 text-slate-500", view.modelHint));
    }
}

/** POST {service url}/test: { serviceId } or { baseUrl, apiKey? }. A free GET /models; never embeds or generates. */
export async function testService(view, body, label) {
    const services = state[view.stateKey];
    if (services.testing) return;
    services.testing = true;
    const testButton = serviceButton(view, "Test");
    setButtonLoading(testButton, true, "Testing...");
    try {
        const result = await apiRequest(`${view.url()}/test`, { method: "POST", body: JSON.stringify(body) });
        if (!serviceEl(view, "Form").classList.contains("hidden") && !body.serviceId) setServiceTestResult(view, result);
        else showToast(result.ok ? `${label}: connected, ${result.models.length} model(s).` : `${label}: ${result.error || "not reachable"}`, result.ok ? "success" : "error");
    } catch (error) {
        showErrorToast(error, "Connection test failed");
    } finally {
        services.testing = false;
        setButtonLoading(testButton, false);
    }
}

export function testServiceForm(view) {
    const id = serviceEl(view, "FormId").value;
    const baseUrl = serviceEl(view, "BaseUrl").value.trim();
    const apiKey = serviceEl(view, "ApiKey").value.trim();
    const stored = state[view.stateKey].items.find((service) => service.id === id);
    // An unchanged saved service is tested with its stored key; anything typed is tested as typed.
    if (stored && baseUrl === stored.baseUrl && !apiKey && !serviceEl(view, "ClearKey").checked) {
        apiRequest(`${view.url()}/test`, { method: "POST", body: JSON.stringify({ serviceId: id }) })
            .then((result) => setServiceTestResult(view, result))
            .catch((error) => showErrorToast(error, "Connection test failed"));
        return;
    }
    if (!baseUrl) {
        showToast("Enter the base URL first.", "error");
        return;
    }
    testService(view, apiKey ? { baseUrl, apiKey } : { baseUrl }, "Connection");
}

export async function saveService(view) {
    const id = serviceEl(view, "FormId").value;
    const body = { name: serviceEl(view, "Name").value.trim(), baseUrl: serviceEl(view, "BaseUrl").value.trim() };
    const apiKey = serviceEl(view, "ApiKey").value.trim();
    if (apiKey) body.apiKey = apiKey;
    else if (id && serviceEl(view, "ClearKey").checked) body.apiKey = null;
    if (!body.name || !body.baseUrl) {
        showToast("Name and base URL are required.", "error");
        return;
    }
    const services = state[view.stateKey];
    const saveButton = serviceButton(view, "Save");
    services.saving = true;
    setButtonLoading(saveButton, true, "Saving...");
    try {
        const data = await adminMutationRequest(id ? view.url(id) : view.url(), {
            method: id ? "PATCH" : "POST",
            body: JSON.stringify(body),
        });
        showToast(id ? `${capitalizeFirst(view.noun)} updated; it is used at once.` : `${capitalizeFirst(view.noun)} added.`, "success");
        // Warnings about this change (for example a URL another service already uses); the auth-off one is on the page.
        (Array.isArray(data?.warnings) ? data.warnings : [])
            .filter((warning) => !services.warnings.includes(warning))
            .forEach((warning) => showToast(warning, "info", { durationMs: 10000 }));
        closeServiceForm(view);
        await Promise.all([loadServices(view), view.afterChange()]);
    } catch (error) {
        showErrorToast(error, `Saving the ${view.noun} failed`);
    } finally {
        services.saving = false;
        setButtonLoading(saveButton, false);
    }
}

export async function deleteServiceAction(view, service) {
    if (!confirm(`Delete the ${view.noun} "${service.name}"?`)) return;
    try {
        await adminMutationRequest(view.url(service.id), { method: "DELETE" });
        showToast(`Deleted ${service.name}.`, "success");
        await Promise.all([loadServices(view), view.afterChange()]);
    } catch (error) {
        const inUse = view.inUseMessage(error, service);
        if (inUse) {
            showToast(inUse, "error", { durationMs: 9000 });
            return;
        }
        showErrorToast(error, `Deleting the ${view.noun} failed`);
    }
}

export function bindServiceViewEvents(view) {
    document.getElementById(view.addButtonId)?.addEventListener("click", () => openServiceForm(view));
    serviceButton(view, "Cancel")?.addEventListener("click", () => closeServiceForm(view));
    serviceButton(view, "Test")?.addEventListener("click", () => testServiceForm(view));
    serviceEl(view, "Form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveService(view);
    });
    // Preset buttons come from GET /v1/admin/server-info and are re-rendered, so listen on their container.
    serviceEl(view, "Presets")?.addEventListener("click", (event) => {
        const preset = findServicePreset(event.target?.closest?.("[data-preset-id]")?.dataset.presetId);
        if (!preset) return;
        if (!serviceEl(view, "Name").value.trim()) serviceEl(view, "Name").value = preset.name;
        serviceEl(view, "BaseUrl").value = preset.baseUrl;
        setServiceTestResult(view, null);
    });
}

export function bindEmbeddingServicesEvents() {
    bindServiceViewEvents(SERVICE_VIEWS.embedding);
    bindServiceViewEvents(SERVICE_VIEWS.chat);
    bindChatSettingsEvents();
    elements.editEmbeddingService?.addEventListener("change", () => syncModelDiscoveryPanel());
    elements.linkEmbeddingServices?.addEventListener("click", (event) => {
        event.preventDefault();
        closeInspector();
        switchView("embedding-services");
    });
    document.getElementById("linkChatServices")?.addEventListener("click", (event) => {
        event.preventDefault();
        closeInspector();
        switchView("chat-services");
    });
}
