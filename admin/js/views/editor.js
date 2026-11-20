import { adminCollectionUrl, adminCollectionValidateUrl, adminMutationRequest, apiRequest, normalizeError } from "../api.js";
import { canAdminAction } from "../auth.js";
import { clearNode, createEl, getStatusBadge, setButtonLoading, showErrorToast, showToast } from "../dom.js";
import { API, EDIT_FIELD_IDS, elements, loadTokens, state } from "../state.js";
import { describeChatSettings, syncChatSettingsModels } from "./chatSettings.js";
import { loadAdminCollectionDetail, loadCollections, mergeCollectionIntoState } from "./collections.js";
import { loadCollectionFiles } from "./documents.js";
import { closeInspector, openInspector, renderCollectionValidation, setCollectionTabsEnabled, setInspectorActionsEnabled, switchTab, syncSaveButtonAccess } from "./inspector.js";

export function normalizeModelList(models) {
    return [...new Set(
        (Array.isArray(models) ? models : [])
            .filter((value) => typeof value === "string" && value.trim() !== "")
            .map((value) => value.trim()),
    )];
}

export function emptyModelDiscovery() {
    return {
        loaded: false,
        defaultProvider: "",
        defaultModel: "",
        builtinModels: [],
        /** GET /v1/admin/models embeddingServices: [{ id, name, reachable, authOk, models, error }] ("server" first when configured). */
        services: [],
        /** GET /v1/admin/models chatServices: the same shape, for choosing the chat model. */
        chatServices: [],
        /** GET /v1/admin/models defaultEmbeddingServiceId: what the server picks when none is sent (null: it asks). */
        defaultServiceId: null,
    };
}

/**
 * The embedding service chosen in the editor (openai-compatible only). "Default" (empty value) means the server
 * chooses; its choice comes from GET /v1/admin/models defaultEmbeddingServiceId, so its models can be suggested.
 */
export function selectedEmbeddingServiceEntry() {
    const id = elements.editEmbeddingService?.value || state.modelDiscovery.defaultServiceId || "";
    return state.modelDiscovery.services.find((service) => service.id === id) || null;
}

/** The provider the editor is about to use: the selected one, else the backend default. */
export function selectedEmbeddingProvider() {
    return elements.editEmbeddingProvider?.value || state.modelDiscovery.defaultProvider || "builtin";
}

// Embedding provider and model are chosen per collection; the chat LLM is global (see renderChatLlmStatus).
export function getModelDiscoveryFieldConfig(_kind) {
    const provider = selectedEmbeddingProvider();
    return {
        input: elements.editEmbeddingModel,
        select: elements.embeddingModelSelect,
        models: provider === "builtin" ? state.modelDiscovery.builtinModels : selectedEmbeddingServiceEntry()?.models || [],
    };
}

/** Fills the model field's suggestions (a datalist) with the models of the chosen provider or service. */
export function syncModelSelect(kind) {
    const config = getModelDiscoveryFieldConfig(kind);
    if (!config.select) return;
    clearNode(config.select);
    normalizeModelList(config.models).forEach((model) => {
        const option = createEl("option");
        option.value = model;
        config.select.appendChild(option);
    });
}

export function syncModelDiscoveryPanel() {
    if (!elements.modelDiscoveryPanel) return;

    const discovery = state.modelDiscovery;
    const provider = selectedEmbeddingProvider();
    syncEmbeddingServiceField();
    const service = selectedEmbeddingServiceEntry();
    const online = provider === "builtin" ? discovery.loaded : Boolean(service?.reachable && service?.authOk !== false);

    if (elements.modelDiscoveryStatus) {
        elements.modelDiscoveryStatus.textContent = discovery.error
            ? "Unavailable"
            : online ? "Available" : provider === "builtin" ? "Loading" : service ? "Offline" : "Not configured";
        elements.modelDiscoveryStatus.className = online
            ? "rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700"
            : "rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700";
    }

    if (elements.modelDiscoverySummary) {
        const defaultText = discovery.defaultProvider
            ? `Default for new collections: ${discovery.defaultProvider} / ${discovery.defaultModel}.`
            : "";
        let providerText;
        if (discovery.error) {
            providerText = `Model suggestions could not be loaded (${discovery.error}). You can still type a model name.`;
        } else if (provider === "builtin") {
            providerText = `builtin: ${discovery.builtinModels.length} built-in model(s), run inside the backend and downloaded on first use.`;
        } else if (discovery.services.length === 0) {
            providerText = EXTERNAL_EMBEDDING_SETUP_HINT;
        } else if (!service) {
            providerText = "openai-compatible: pick an embedding service.";
        } else if (!online) {
            providerText = `openai-compatible: ${service.name} is not reachable${service.error ? ` (${service.error})` : ""}.`;
        } else {
            providerText = `openai-compatible: ${service.models.length} model(s) at ${service.name}. Pick an embedding model (chat models fail at indexing).`;
        }
        elements.modelDiscoverySummary.textContent = `${providerText} ${defaultText}`.trim();
    }

    syncExternalProviderOption();
    syncModelSelect("embedding");
    syncEmbeddingReindexNote();
}

/** Editing an existing collection: say a re-index is needed once its embedding provider, service or model changes. */
export function syncEmbeddingReindexNote() {
    const note = elements.embeddingReindexNote;
    if (!note) return;
    const saved = state.editorInitialSnapshot;
    const current = saved ? readEditorValues() : null;
    const changed = Boolean(saved) && ["embeddingProvider", "embeddingServiceId", "embeddingModel"].some((key) => current[key] !== saved[key]);
    note.classList.toggle("hidden", !changed);
}

// External embedding services are managed in the "Embedding services" view (or set in .env / config as "server").
export const EXTERNAL_EMBEDDING_SETUP_HINT = "openai-compatible: no embedding service yet. "
    + "Add one under Embedding services in the left menu (for example Ollama on this computer at http://host.docker.internal:11434/v1), "
    + "or set RAG_EMBEDDING_BASE_URL on the server. Then pick it and its model here.";

/** Disable "openai-compatible" while there is no embedding service, unless the collection already uses it. */
export function syncExternalProviderOption() {
    const select = elements.editEmbeddingProvider;
    const option = select?.querySelector('option[value="openai-compatible"]');
    if (!option) return;
    const discovery = state.modelDiscovery;
    const unavailable = discovery.loaded && discovery.services.length === 0 && select.value !== "openai-compatible";
    option.disabled = unavailable;
    option.textContent = unavailable
        ? "External service (add one under Embedding services first)"
        : "External service (OpenAI-compatible API)";
}

/**
 * The service select only shows for openai-compatible. It lists GET /v1/admin/models embeddingServices and keeps
 * a collection's current service selectable even if it is gone (so the editor never changes it silently).
 */
export function syncEmbeddingServiceField(preferredId) {
    const select = elements.editEmbeddingService;
    if (!select) return;
    const show = selectedEmbeddingProvider() === "openai-compatible";
    elements.embeddingServiceField?.classList.toggle("hidden", !show);
    const wanted = preferredId !== undefined ? preferredId : select.value;
    const services = state.modelDiscovery.services;
    clearNode(select);
    // Empty value: send no embeddingServiceId and let the server pick (or ask, when several services exist). Only
    // offered when the server can pick: a new collection, or one switching to openai-compatible. A saved
    // openai-compatible collection keeps its service unless another one is chosen.
    const editingExternal = Boolean(elements.editId?.value) && select.dataset.savedProvider === "openai-compatible";
    if (!editingExternal) {
        const defaultId = state.modelDiscovery.defaultServiceId;
        const defaultName = defaultId ? services.find((service) => service.id === defaultId)?.name || defaultId : "";
        const defaultOption = createEl("option", "", defaultName
            ? `Default (the server chooses: ${defaultName})`
            : services.length > 1 ? "Default (the server asks you to choose one below)" : "Default (the server chooses)");
        defaultOption.value = "";
        select.appendChild(defaultOption);
    }
    services.forEach((service) => {
        const option = createEl("option", "", service.reachable === false ? `${service.name} (not reachable)` : service.name);
        option.value = service.id;
        select.appendChild(option);
    });
    if (wanted && !services.some((service) => service.id === wanted)) {
        const missing = createEl("option", "", `${wanted} (not available)`);
        missing.value = wanted;
        select.appendChild(missing);
    }
    // New collections start on "Default": the server applies its own rule (see defaultEmbeddingServiceId).
    select.value = wanted || (editingExternal ? services[0]?.id || "" : "");
}

/** " via <service name>" for an openai-compatible embedding, "" otherwise. */
export function viaEmbeddingService(id) {
    return id ? ` via ${embeddingServiceName(id)}` : "";
}

export function embeddingServiceName(id) {
    if (!id) return "";
    const known = state.modelDiscovery.services.find((service) => service.id === id)
        || state.embeddingServices.items.find((service) => service.id === id);
    return known?.name || id;
}

export function describeChatLlm(chat) {
    if (!chat) return "Chat LLM status unavailable.";
    if (!chat.enabled) return "Not configured: Query is disabled (retrieve-only).";
    return `${chat.model} @ ${chat.baseUrl}${chat.apiKeyConfigured ? " (API key set)" : ""}`;
}

/** The chat LLM that answers Query for this tenant (GET /v1/admin/chat-settings), shown in the collection form. */
export function renderChatLlmStatus() {
    if (!elements.chatLlmStatus) return;
    elements.chatLlmStatus.textContent = state.chatSettings.loaded
        ? describeChatSettings(state.chatSettings.data)
        : state.chatSettings.error ? "Chat LLM status unavailable." : "Loading GET /v1/admin/chat-settings...";
}

export function formatConfigDefault(value) {
    if (value === undefined || value === null || value === "") return "-";
    return String(value);
}

export function setCreateFieldDefault(field, value) {
    const helper = document.querySelector(`[data-default-for="${field}"]`);
    if (helper) helper.textContent = value;
}

/**
 * The empty option of the provider and metric selects means "let the server pick its default" and only
 * exists when creating: name the default ("Server default (builtin)"). A saved collection always has a
 * concrete value, so in edit mode the option is hidden.
 */
export function syncDefaultSelectOptions(isCreateMode, collectionDefaults, modelDefaults) {
    [
        [elements.editEmbeddingProvider, modelDefaults?.embeddingProvider],
        [elements.editDistanceMetric, collectionDefaults?.distanceMetric],
    ].forEach(([select, defaultValue]) => {
        const option = select?.querySelector('option[value=""]');
        if (!option) return;
        option.hidden = !isCreateMode;
        option.disabled = !isCreateMode;
        option.textContent = defaultValue ? `Server default (${defaultValue})` : "Server default";
    });
}

export function syncConfigDefaultsPanel() {
    renderChatLlmStatus();
    if (!elements.configDefaultsPanel) return;

    const isCreateMode = !elements.editId.value;
    elements.configDefaultsPanel.classList.toggle("hidden", !isCreateMode);

    // Edit mode: a saved collection has concrete values, so there is no "default" to show.
    const clearHelpers = (text = "Server default unavailable") => {
        ["sourcePath", "distanceMetric", "chunkSize", "chunkOverlap", "retrievalK", "retrievalDistanceThreshold", "embeddingProvider", "embeddingModel"].forEach((field) => {
            setCreateFieldDefault(field, text);
        });
        if (elements.editSourcePath) elements.editSourcePath.placeholder = "";
        if (elements.editChunkSize) elements.editChunkSize.placeholder = "";
        if (elements.editChunkOverlap) elements.editChunkOverlap.placeholder = "";
        if (elements.editRetrievalK) elements.editRetrievalK.placeholder = "";
        if (elements.editRetrievalDistanceThreshold) elements.editRetrievalDistanceThreshold.placeholder = "";
        if (elements.editEmbeddingModel) elements.editEmbeddingModel.placeholder = "";
        syncDefaultSelectOptions(isCreateMode, null, null);
    };

    if (!isCreateMode) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Hidden";
            elements.configDefaultsStatus.className = "rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "";
        }
        clearHelpers("");
        return;
    }

    const collectionDefaults = state.configDefaults.collectionDefaults;
    const modelDefaults = state.configDefaults.modelDefaults;

    if (!state.configDefaults.loaded) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Loading";
            elements.configDefaultsStatus.className = "rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "Loading GET /v1/admin/config/defaults...";
        }
        clearHelpers("Loading server default...");
        return;
    }

    if (!collectionDefaults || !modelDefaults) {
        if (elements.configDefaultsStatus) {
            elements.configDefaultsStatus.textContent = "Unavailable";
            elements.configDefaultsStatus.className = "rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700";
        }
        if (elements.configDefaultsSummary) {
            elements.configDefaultsSummary.textContent = "GET /v1/admin/config/defaults is unavailable right now.";
        }
        clearHelpers();
        return;
    }

    const summaryParts = [
        `Source path: ${formatConfigDefault(collectionDefaults.sourcePath)}`,
        `Distance metric: ${formatConfigDefault(collectionDefaults.distanceMetric)}`,
        `Chunk size/overlap: ${formatConfigDefault(collectionDefaults.chunkSize)}/${formatConfigDefault(collectionDefaults.chunkOverlap)}`,
        `Retrieval K: ${formatConfigDefault(collectionDefaults.retrievalK)}`,
        `Threshold: ${formatConfigDefault(collectionDefaults.retrievalDistanceThreshold)}`,
        `Embedding: ${formatConfigDefault(modelDefaults.embeddingProvider)} / ${formatConfigDefault(modelDefaults.embeddingModel)}`,
        `Server chat LLM: ${describeChatLlm(state.configDefaults.chat)}`,
    ];

    if (elements.configDefaultsStatus) {
        elements.configDefaultsStatus.textContent = "Loaded";
        elements.configDefaultsStatus.className = "rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700";
    }
    if (elements.configDefaultsSummary) {
        elements.configDefaultsSummary.textContent = summaryParts.join(" | ");
    }

    // A server folder has no default: without a source path the collection gets its own uploads folder.
    setCreateFieldDefault("sourcePath", "");
    setCreateFieldDefault("distanceMetric", `Server default: ${formatConfigDefault(collectionDefaults.distanceMetric)}`);
    setCreateFieldDefault("chunkSize", `Server default: ${formatConfigDefault(collectionDefaults.chunkSize)}`);
    setCreateFieldDefault("chunkOverlap", `Server default: ${formatConfigDefault(collectionDefaults.chunkOverlap)}`);
    setCreateFieldDefault("retrievalK", `Server default: ${formatConfigDefault(collectionDefaults.retrievalK)}`);
    setCreateFieldDefault("retrievalDistanceThreshold", `Server default: ${formatConfigDefault(collectionDefaults.retrievalDistanceThreshold)}`);
    setCreateFieldDefault("embeddingProvider", "Leave it on the server default unless this collection needs another provider.");
    setCreateFieldDefault("embeddingModel", `Server default: ${formatConfigDefault(modelDefaults.embeddingModel)}`);

    if (elements.editSourcePath) elements.editSourcePath.placeholder = "data/my-docs";
    if (elements.editChunkSize) elements.editChunkSize.placeholder = String(formatConfigDefault(collectionDefaults.chunkSize));
    if (elements.editChunkOverlap) elements.editChunkOverlap.placeholder = String(formatConfigDefault(collectionDefaults.chunkOverlap));
    if (elements.editRetrievalK) elements.editRetrievalK.placeholder = String(formatConfigDefault(collectionDefaults.retrievalK));
    if (elements.editRetrievalDistanceThreshold) elements.editRetrievalDistanceThreshold.placeholder = String(formatConfigDefault(collectionDefaults.retrievalDistanceThreshold));
    if (elements.editEmbeddingModel) elements.editEmbeddingModel.placeholder = formatConfigDefault(modelDefaults.embeddingModel);

    syncDefaultSelectOptions(isCreateMode, collectionDefaults, modelDefaults);
}

export async function loadConfigDefaults() {
    const token = ++loadTokens.configDefaults;
    try {
        const data = await apiRequest(`${API.admin}/config/defaults`);
        if (token !== loadTokens.configDefaults) return;
        state.configDefaults = {
            loaded: true,
            collectionDefaults: {
                sourcePath: typeof data?.collectionDefaults?.sourcePath === "string" ? data.collectionDefaults.sourcePath : "",
                distanceMetric: typeof data?.collectionDefaults?.distanceMetric === "string" ? data.collectionDefaults.distanceMetric : "",
                chunkSize: Number.isFinite(data?.collectionDefaults?.chunkSize) ? data.collectionDefaults.chunkSize : "",
                chunkOverlap: Number.isFinite(data?.collectionDefaults?.chunkOverlap) ? data.collectionDefaults.chunkOverlap : "",
                retrievalK: Number.isFinite(data?.collectionDefaults?.retrievalK) ? data.collectionDefaults.retrievalK : "",
                retrievalDistanceThreshold: Number.isFinite(data?.collectionDefaults?.retrievalDistanceThreshold) ? data.collectionDefaults.retrievalDistanceThreshold : "",
            },
            modelDefaults: {
                embeddingProvider: typeof data?.modelDefaults?.embeddingProvider === "string" ? data.modelDefaults.embeddingProvider : "",
                embeddingModel: typeof data?.modelDefaults?.embeddingModel === "string" ? data.modelDefaults.embeddingModel : "",
            },
            chat: {
                enabled: data?.chat?.enabled === true,
                baseUrl: typeof data?.chat?.baseUrl === "string" ? data.chat.baseUrl : "",
                model: typeof data?.chat?.model === "string" ? data.chat.model : "",
                apiKeyConfigured: data?.chat?.apiKeyConfigured === true,
            },
        };
    } catch (_error) {
        if (token !== loadTokens.configDefaults) return;
        state.configDefaults = {
            loaded: true,
            collectionDefaults: null,
            modelDefaults: null,
            chat: null,
        };
    }

    if (token === loadTokens.configDefaults) {
        syncConfigDefaultsPanel();
        renderChatLlmStatus();
    }
}

export async function loadModelDiscovery() {
    const token = ++loadTokens.modelDiscovery;
    try {
        const data = await apiRequest(`${API.admin}/models`);
        if (token !== loadTokens.modelDiscovery) return;
        state.modelDiscovery = {
            loaded: true,
            defaultProvider: typeof data?.default?.provider === "string" ? data.default.provider : "",
            defaultModel: typeof data?.default?.model === "string" ? data.default.model : "",
            builtinModels: normalizeModelList(data?.providers?.builtin?.models),
            services: normalizeServiceModels(data?.embeddingServices),
            chatServices: normalizeServiceModels(data?.chatServices),
            defaultServiceId: typeof data?.defaultEmbeddingServiceId === "string" ? data.defaultEmbeddingServiceId : null,
        };
    } catch (error) {
        if (token !== loadTokens.modelDiscovery) return;
        state.modelDiscovery = { ...emptyModelDiscovery(), error: normalizeError(error).message };
    }

    if (token === loadTokens.modelDiscovery) {
        syncModelDiscoveryPanel();
        syncChatSettingsModels();
    }
}

export function normalizeServiceModels(list) {
    return (Array.isArray(list) ? list : [])
        .filter((service) => typeof service?.id === "string")
        .map((service) => ({
            id: service.id,
            name: typeof service.name === "string" ? service.name : service.id,
            reachable: service.reachable === true,
            authOk: service.authOk !== false,
            models: normalizeModelList(service.models),
            error: typeof service.error === "string" ? service.error : "",
        }));
}

export function clearEditorForm() {
    Object.values(EDIT_FIELD_IDS).forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.value = "";
    });
    elements.editId.value = "";
    const uploadsRadio = document.querySelector('input[name="sourceKind"][value="uploads"]');
    if (uploadsRadio) uploadsRadio.checked = true;
    syncSourceKindFields(null);
    syncModelDiscoveryPanel();
    syncConfigDefaultsPanel();
}

export function fieldValueFromCollection(collection, field) {
    if (!Object.prototype.hasOwnProperty.call(collection, field)) return "";
    return collection[field] ?? "";
}

export function hasUnsavedCollectionChanges() {
    if (!state.editorInitialSnapshot) return false;
    const current = readEditorValues();
    return Object.keys({ ...state.editorInitialSnapshot, ...current }).some((key) => current[key] !== state.editorInitialSnapshot[key]);
}

export function setupEditorTab(collection) {
    elements.editId.value = collection.id || "";
    elements.editDisplayName.value = fieldValueFromCollection(collection, "displayName");
    elements.editDescription.value = fieldValueFromCollection(collection, "description");
    elements.editSourcePath.value = fieldValueFromCollection(collection, "sourcePath");
    elements.editDistanceMetric.value = collection.distanceMetric || "";
    elements.editChunkSize.value = collection.chunkSize ?? "";
    elements.editChunkOverlap.value = collection.chunkOverlap ?? "";
    elements.editRetrievalK.value = collection.retrievalK ?? "";
    elements.editRetrievalDistanceThreshold.value = collection.retrievalDistanceThreshold ?? "";
    if (elements.editEmbeddingProvider) elements.editEmbeddingProvider.value = collection.embeddingProvider || "";
    if (elements.editEmbeddingService) elements.editEmbeddingService.dataset.savedProvider = collection.embeddingProvider || "";
    // An openai-compatible collection without a service id uses "server" (.env / config).
    syncEmbeddingServiceField(collection.embeddingProvider === "openai-compatible" ? collection.embeddingServiceId || "server" : "");
    elements.editEmbeddingModel.value = fieldValueFromCollection(collection, "embeddingModel");
    syncSourceKindFields(collection);
    state.editorInitialSnapshot = readEditorValues();
    syncModelDiscoveryPanel();
    syncConfigDefaultsPanel();
    syncSaveButtonAccess();
}

export function readTrimmed(id) {
    return document.getElementById(id)?.value.trim() || "";
}

export function readOptionalInteger(id) {
    const value = document.getElementById(id)?.value.trim() || "";
    if (value === "") return undefined;
    const number = Number(value);
    return Number.isInteger(number) ? number : NaN;
}

export function readOptionalNumber(id) {
    const value = document.getElementById(id)?.value.trim() || "";
    if (value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

export function readEditorValues() {
    return {
        displayName: readTrimmed(EDIT_FIELD_IDS.displayName),
        description: readTrimmed(EDIT_FIELD_IDS.description),
        sourcePath: readTrimmed(EDIT_FIELD_IDS.sourcePath),
        distanceMetric: readTrimmed(EDIT_FIELD_IDS.distanceMetric),
        chunkSize: readOptionalInteger(EDIT_FIELD_IDS.chunkSize),
        chunkOverlap: readOptionalInteger(EDIT_FIELD_IDS.chunkOverlap),
        retrievalK: readOptionalInteger(EDIT_FIELD_IDS.retrievalK),
        retrievalDistanceThreshold: readOptionalNumber(EDIT_FIELD_IDS.retrievalDistanceThreshold),
        embeddingProvider: readTrimmed(EDIT_FIELD_IDS.embeddingProvider),
        embeddingServiceId: readTrimmed(EDIT_FIELD_IDS.embeddingServiceId),
        embeddingModel: readTrimmed(EDIT_FIELD_IDS.embeddingModel),
    };
}

export function validateCollectionForm(mode) {
    const values = readEditorValues();
    const errors = [];
    if (mode === "create" && !values.displayName) errors.push("displayName is required for new collections.");
    if (mode === "create" && getSelectedSourceKind() === "folder" && !values.sourcePath) {
        errors.push("Enter the server folder path (for example data/my-docs), or choose Upload files.");
    }
    if (mode === "update" && !values.displayName) errors.push("displayName cannot be empty.");
    if (values.chunkSize !== undefined && (!Number.isInteger(values.chunkSize) || values.chunkSize <= 0)) errors.push("chunkSize must be a positive integer.");
    if (values.chunkOverlap !== undefined && (!Number.isInteger(values.chunkOverlap) || values.chunkOverlap < 0)) errors.push("chunkOverlap must be a nonnegative integer.");
    if (
        values.chunkSize !== undefined &&
        values.chunkOverlap !== undefined &&
        !Number.isNaN(values.chunkSize) &&
        !Number.isNaN(values.chunkOverlap) &&
        values.chunkOverlap >= values.chunkSize
    ) {
        errors.push("chunkOverlap must be less than chunkSize.");
    }
    if (values.retrievalK !== undefined && (!Number.isInteger(values.retrievalK) || values.retrievalK <= 0)) errors.push("retrievalK must be a positive integer.");
    if (values.retrievalDistanceThreshold !== undefined && (!Number.isFinite(values.retrievalDistanceThreshold) || values.retrievalDistanceThreshold < 0)) {
        errors.push("retrievalDistanceThreshold must be a nonnegative number.");
    }
    if (values.distanceMetric && !["l2", "cosine", "ip"].includes(values.distanceMetric)) errors.push("distanceMetric must be l2, cosine, or ip.");
    return errors;
}

export function addIfText(payload, key, value) {
    if (value) payload[key] = value;
}

export function addIfNumber(payload, key, value) {
    if (value !== undefined && Number.isFinite(value)) payload[key] = value;
}

export function buildCollectionPayload(mode) {
    const values = readEditorValues();
    const payload = {};

    if (mode === "create") {
        payload.displayName = values.displayName;
        addIfText(payload, "description", values.description);
        // No sourcePath = the collection gets its own folder for uploaded documents.
        if (getSelectedSourceKind() === "folder") addIfText(payload, "sourcePath", values.sourcePath);
        if (values.distanceMetric) payload.distanceMetric = values.distanceMetric;
        addIfNumber(payload, "chunkSize", values.chunkSize);
        addIfNumber(payload, "chunkOverlap", values.chunkOverlap);
        addIfNumber(payload, "retrievalK", values.retrievalK);
        addIfNumber(payload, "retrievalDistanceThreshold", values.retrievalDistanceThreshold);
        addIfText(payload, "embeddingProvider", values.embeddingProvider);
        addIfText(payload, "embeddingModel", values.embeddingModel);
        if (selectedEmbeddingProvider() === "openai-compatible") addIfText(payload, "embeddingServiceId", values.embeddingServiceId);
        return payload;
    }

    const initial = state.editorInitialSnapshot || {};
    if (values.displayName && values.displayName !== initial.displayName) payload.displayName = values.displayName;

    if (values.description !== initial.description) {
        if (values.description) payload.description = values.description;
        else if (initial.description) payload.description = null;
    }

    ["sourcePath", "embeddingProvider", "embeddingModel"].forEach((key) => {
        if (values[key] && values[key] !== initial[key]) payload[key] = values[key];
    });
    if (selectedEmbeddingProvider() === "openai-compatible"
        && values.embeddingServiceId && values.embeddingServiceId !== initial.embeddingServiceId) {
        payload.embeddingServiceId = values.embeddingServiceId;
    }

    if (values.distanceMetric && values.distanceMetric !== initial.distanceMetric) payload.distanceMetric = values.distanceMetric;

    ["chunkSize", "chunkOverlap", "retrievalK", "retrievalDistanceThreshold"].forEach((key) => {
        if (values[key] !== undefined && Number.isFinite(values[key]) && values[key] !== initial[key]) payload[key] = values[key];
    });

    return payload;
}

export function getValidationTitle(mode) {
    return mode === "create" ? "Create validation" : "Update validation";
}

export function hasValidationBlockers(validation) {
    return Array.isArray(validation?.blockers) && validation.blockers.length > 0;
}

export function hasValidationWarnings(validation) {
    return Array.isArray(validation?.warnings) && validation.warnings.length > 0;
}

export function validateCollectionOnServer(mode, collectionId, payload = buildCollectionPayload(mode)) {
    const url = mode === "create" ? adminCollectionValidateUrl() : adminCollectionValidateUrl(collectionId);
    return apiRequest(url, {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function saveCollection() {
    const id = elements.editId.value;
    const mode = id ? "update" : "create";
    if (mode === "create" && !canAdminAction("createCollection")) {
        showToast("Create collection requires operator access.", "error");
        return;
    }
    if (mode === "update" && !canAdminAction("updateCollection")) {
        showToast("Update collection requires operator access.", "error");
        return;
    }
    const errors = validateCollectionForm(mode);
    if (errors.length > 0) {
        showToast(errors.join(" "), "error", { durationMs: 7000 });
        return;
    }

    const payload = buildCollectionPayload(mode);
    if (mode === "update" && Object.keys(payload).length === 0) {
        showToast("No changes to save.", "info");
        return;
    }

    try {
        setButtonLoading(elements.btnSave, true, "Saving...");
        const validation = await validateCollectionOnServer(mode, id, payload);
        if (hasValidationBlockers(validation)) {
            renderCollectionValidation(validation, getValidationTitle(mode));
            showToast("Validation blocked the save.", "error", {
                issues: validation.blockers,
            });
            return;
        }
        const hasWarnings = hasValidationWarnings(validation);
        const hasImpact = Boolean(validation?.impact?.reindexRequired) ||
            (Array.isArray(validation?.impact?.immediateFields) && validation.impact.immediateFields.length > 0) ||
            (Array.isArray(validation?.impact?.reindexFields) && validation.impact.reindexFields.length > 0);
        const shouldKeepOpen = hasWarnings || hasImpact;
        if (mode === "create") {
            const data = await adminMutationRequest(`${API.admin}/collections`, { method: "POST", body: JSON.stringify(payload) });
            const createdId = data?.collection?.id;
            await loadCollections();
            if (createdId) {
                // Open the new collection on its next step: uploading documents, or indexing its folder.
                await openInspector(createdId, { tab: payload.sourcePath ? "ready" : "files" });
                if (hasWarnings) renderCollectionValidation(validation, getValidationTitle(mode));
                showToast(payload.sourcePath
                    ? "Collection created. Re-index it to make its folder searchable."
                    : "Collection created. Add documents here, then re-index.", "success");
                return;
            }
            showToast("Collection created.", "success");
            if (shouldKeepOpen) {
                const createdId = data?.collection?.id;
                if (createdId) {
                    const refreshed = await loadAdminCollectionDetail(createdId);
                    state.selectedCollection = mergeCollectionIntoState(refreshed);
                    elements.inspectorTitle.textContent = refreshed.displayName || refreshed.id;
                    clearNode(elements.inspectorStatusBadge);
                    elements.inspectorStatusBadge.classList.remove("hidden");
                    elements.inspectorStatusBadge.appendChild(getStatusBadge(refreshed.status));
                    setInspectorActionsEnabled(true);
                    setCollectionTabsEnabled(true);
                    setupEditorTab(refreshed);
                }
                renderCollectionValidation(validation, getValidationTitle(mode));
                if (!payload.sourcePath && createdId) {
                    switchTab("files");
                    await loadCollectionFiles();
                    showToast("Collection created. Add documents in the Documents tab, then re-index.", "info");
                    return;
                }
                showToast(
                    validation.impact?.reindexRequired
                        ? "Collection saved. Initial re-index is required before it can be used."
                        : "Collection saved. Review the validation warnings.",
                    "info",
                );
                return;
            }
        } else {
            await adminMutationRequest(adminCollectionUrl(id), { method: "PATCH", body: JSON.stringify(payload) });
            showToast("Collection updated.", "success");
            await loadCollections();
            if (shouldKeepOpen) {
                const refreshed = await loadAdminCollectionDetail(id);
                state.selectedCollection = mergeCollectionIntoState(refreshed);
                elements.inspectorTitle.textContent = refreshed.displayName || refreshed.id;
                clearNode(elements.inspectorStatusBadge);
                elements.inspectorStatusBadge.classList.remove("hidden");
                elements.inspectorStatusBadge.appendChild(getStatusBadge(refreshed.status));
                setInspectorActionsEnabled(true);
                setCollectionTabsEnabled(true);
                setupEditorTab(refreshed);
                renderCollectionValidation(validation, getValidationTitle(mode));
                showToast(validation.impact?.reindexRequired
                    ? "Collection saved. Re-index is required to apply indexed settings."
                    : "Collection saved. Immediate settings are now active. Review warnings if present.", "info");
                return;
            }
        }
        closeInspector();
    } catch (error) {
        showErrorToast(error, "Save failed");
    } finally {
        setButtonLoading(elements.btnSave, false);
        syncSaveButtonAccess();
    }
}

export function getSelectedSourceKind() {
    const checked = document.querySelector('input[name="sourceKind"]:checked');
    return checked?.value === "folder" ? "folder" : "uploads";
}

/** collection === null: create mode (choose uploads or a server folder). */
export function syncSourceKindFields(collection) {
    if (!collection) {
        elements.sourceKindChoice?.classList.remove("hidden");
        elements.sourceKindReadonly?.classList.add("hidden");
        elements.sourcePathField?.classList.toggle("hidden", getSelectedSourceKind() !== "folder");
        return;
    }
    const uploads = collection.sourceKind === "uploads";
    elements.sourceKindChoice?.classList.add("hidden");
    elements.sourcePathField?.classList.toggle("hidden", uploads);
    if (elements.sourceKindReadonly) {
        elements.sourceKindReadonly.classList.toggle("hidden", !uploads);
        elements.sourceKindReadonly.textContent = uploads
            ? `Documents: uploaded files, stored in ${collection.sourcePath}. Manage them in the Documents tab.`
            : "";
    }
}
