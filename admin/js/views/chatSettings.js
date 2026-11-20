import { adminMutationRequest, apiRequest } from "../api.js";
import { canAdminAction } from "../auth.js";
import { clearNode, createEl, setButtonLoading, showErrorToast, showToast } from "../dom.js";
import { API, state } from "../state.js";
import { loadModelDiscovery, renderChatLlmStatus } from "./editor.js";
import { SERVICE_VIEWS, loadServices } from "./services.js";

// ---- Answer generation: the tenant's chat choice (a client of /v1/admin/chat-settings) ----

export function emptyChatSettingsState() {
    return { loaded: false, loading: false, data: null, error: null, saving: false };
}

export function chatSettingsUrl() {
    return `${API.admin}/chat-settings`;
}

export async function loadChatSettings() {
    const settings = state.chatSettings;
    settings.loading = true;
    try {
        settings.data = await apiRequest(chatSettingsUrl());
        settings.error = null;
        settings.loaded = true;
    } catch (error) {
        settings.error = error;
    } finally {
        settings.loading = false;
        renderChatSettings();
        renderChatLlmStatus();
    }
}

/** "gemma3:4b via Ollama" for the chat LLM that answers Query, or why there is none. */
export function describeChatSettings(data) {
    if (!data) return "Chat LLM status unavailable.";
    if (data.source === "none") return "Not configured: Query is disabled (retrieve-only).";
    const service = data.serviceName || data.serviceId || "unknown service";
    const origin = data.source === "server" ? " (server default)" : "";
    return `${data.model} via ${service}${origin}`;
}

export function chatServiceName(id) {
    if (!id) return "";
    return state.chatServices.items.find((service) => service.id === id)?.name
        || state.modelDiscovery.chatServices?.find((service) => service.id === id)?.name
        || (state.chatSettings.data?.serviceId === id ? state.chatSettings.data.serviceName : "")
        || id;
}

export function renderChatSettings() {
    const summary = document.getElementById("csSettingsSummary");
    if (!summary) return;
    const settings = state.chatSettings;
    const data = settings.data;
    const canManage = canAdminAction("manageChatServices");

    const sourceLabel = document.getElementById("csSettingsSource");
    sourceLabel.textContent = !data ? "" : {
        tenant: "Your choice",
        server: "Server default (.env / config)",
        none: "Off: retrieve-only",
    }[data.source] || "";

    if (settings.error && !data) {
        summary.textContent = "Could not load the chat choice (GET /v1/admin/chat-settings).";
    } else if (!data) {
        summary.textContent = "Loading GET /v1/admin/chat-settings...";
    } else {
        summary.textContent = data.source === "none"
            ? "No chat LLM: Query is disabled (retrieve-only). Choose a chat service and a model below to enable it."
            : `Query answers with ${describeChatSettings(data)}.`;
    }

    const statusBox = document.getElementById("csSettingsStatus");
    const status = data?.status;
    const showStatus = Boolean(data && data.source !== "none" && status?.message);
    statusBox.classList.toggle("hidden", !showStatus);
    if (showStatus) {
        statusBox.className = `rounded-lg border p-2 text-xs ${status.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`;
        statusBox.textContent = status.message;
    }

    // Service choices: every configured chat service (the server one only when .env / config sets it).
    const select = document.getElementById("csSettingsService");
    const previous = select.value;
    clearNode(select);
    const choices = state.chatServices.items.filter((service) => service.configured !== false);
    if (choices.length === 0) {
        const option = createEl("option", "", "No chat service yet: add one below");
        option.value = "";
        select.appendChild(option);
    }
    choices.forEach((service) => {
        const option = createEl("option", "", service.source === "server" ? `${service.name}` : service.name);
        option.value = service.id;
        select.appendChild(option);
    });
    const preferred = previous && choices.some((service) => service.id === previous)
        ? previous
        : data?.serviceId && choices.some((service) => service.id === data.serviceId) ? data.serviceId : choices[0]?.id || "";
    select.value = preferred;

    const modelInput = document.getElementById("csSettingsModel");
    if (!modelInput.dataset.touched) modelInput.value = data?.model || "";
    syncChatSettingsModels();

    [select, modelInput, document.getElementById("btnCsSettingsSave")].forEach((control) => {
        control.disabled = !canManage || choices.length === 0;
    });
    const resetButton = document.getElementById("btnCsSettingsReset");
    resetButton.disabled = !canManage || data?.source !== "tenant";
    resetButton.classList.toggle("opacity-50", resetButton.disabled);
    const saveButton = document.getElementById("btnCsSettingsSave");
    saveButton.classList.toggle("opacity-50", saveButton.disabled);
    if (!canManage) saveButton.title = "Choosing the chat LLM requires admin access.";
    else saveButton.removeAttribute("title");
}

/** Model suggestions of the selected chat service (GET /v1/admin/models chatServices). */
export function syncChatSettingsModels() {
    const select = document.getElementById("csSettingsService");
    const list = document.getElementById("csSettingsModels");
    const hint = document.getElementById("csSettingsModelHint");
    if (!select || !list) return;
    clearNode(list);
    const entry = (state.modelDiscovery.chatServices || []).find((service) => service.id === select.value);
    const models = entry?.models || [];
    models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model;
        list.appendChild(option);
    });
    hint.textContent = !entry
        ? "Type the model name."
        : !entry.reachable
            ? `The service is not reachable now${entry.error ? ` (${entry.error})` : ""}; you can still save, Query reports the problem.`
            : models.length > 0
                ? `${models.length} model(s) offered by this service. Pick a chat model, not an embedding model.`
                : "This service does not list its models; type the model name.";
}

export async function saveChatSettings() {
    const serviceId = document.getElementById("csSettingsService").value;
    const model = document.getElementById("csSettingsModel").value.trim();
    if (!serviceId || !model) {
        showToast("Choose a chat service and type a model.", "error");
        return;
    }
    const saveButton = document.getElementById("btnCsSettingsSave");
    state.chatSettings.saving = true;
    setButtonLoading(saveButton, true, "Saving...");
    try {
        const data = await adminMutationRequest(chatSettingsUrl(), { method: "PUT", body: JSON.stringify({ serviceId, model }) });
        state.chatSettings.data = data?.settings ?? state.chatSettings.data;
        document.getElementById("csSettingsModel").dataset.touched = "";
        showToast(`Query now answers with ${describeChatSettings(state.chatSettings.data)}.`, "success");
        (Array.isArray(data?.warnings) ? data.warnings : [])
            .filter((warning) => !state.chatServices.warnings.includes(warning))
            .forEach((warning) => showToast(warning, "info", { durationMs: 10000 }));
        await loadServices(SERVICE_VIEWS.chat);
    } catch (error) {
        const available = Array.isArray(error?.details?.availableModels) ? error.details.availableModels : [];
        if (error?.code === "CHAT_MODEL_MISSING" && available.length > 0) {
            showToast(`${error.message} Offered: ${available.slice(0, 10).join(", ")}${available.length > 10 ? ", ..." : ""}`, "error", { durationMs: 10000 });
        } else {
            showErrorToast(error, "Saving the chat choice failed");
        }
    } finally {
        state.chatSettings.saving = false;
        setButtonLoading(saveButton, false);
        renderChatSettings();
        renderChatLlmStatus();
    }
}

export async function resetChatSettings() {
    if (!confirm("Stop using your chat choice? Query then uses the chat LLM from .env / config, or is disabled when there is none.")) return;
    try {
        const data = await adminMutationRequest(chatSettingsUrl(), { method: "DELETE" });
        state.chatSettings.data = data?.settings ?? null;
        document.getElementById("csSettingsModel").dataset.touched = "";
        document.getElementById("csSettingsModel").value = state.chatSettings.data?.model || "";
        showToast(`Chat choice removed. ${describeChatSettings(state.chatSettings.data)}`, "success");
        await loadServices(SERVICE_VIEWS.chat);
    } catch (error) {
        showErrorToast(error, "Removing the chat choice failed");
    } finally {
        renderChatSettings();
        renderChatLlmStatus();
    }
}

export function bindChatSettingsEvents() {
    document.getElementById("csSettingsForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveChatSettings();
    });
    document.getElementById("btnCsSettingsReset")?.addEventListener("click", () => resetChatSettings());
    document.getElementById("csSettingsService")?.addEventListener("change", () => syncChatSettingsModels());
    document.getElementById("csSettingsModel")?.addEventListener("input", (event) => {
        event.target.dataset.touched = "1";
    });
}

/** Opens the Chat services view: the services, the tenant's choice and the models to choose from. */
export async function loadChatServicesView() {
    await Promise.all([loadServices(SERVICE_VIEWS.chat), loadChatSettings(), loadModelDiscovery()]);
    renderChatSettings();
}
