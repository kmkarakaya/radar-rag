/**
 * RAG Ops Dashboard - Core Implementation
 * This script manages the state and orchestration for the high-productivity admin panel.
 */

const API = {
    rag: '/v1/rag',
    admin: '/v1/admin',
    health: '/health',
    ready: '/ready'
};

// --- Endpoint Helpers ---
function collectionReadyUrl(collection) {
    return collection?.readyUrl || `/v1/rag/collections/${collection?.id}/ready`;
}

function collectionQueryUrl(collection) {
    return collection?.queryUrl || `/v1/rag/collections/${collection?.id}/query`;
}

function collectionRetrieveUrl(collection) {
    return collection?.retrieveUrl || `/v1/rag/collections/${collection?.id}/retrieve`;
}

function adminCollectionUrl(id) {
    return `${API.admin}/collections/${id}`;
}

function adminJobUrl(id) {
    return `${API.admin}/jobs/${id}`;
}

// --- State Management ---
let state = {
    currentView: 'collections',
    collections: [],
    selectedCollection: null,
    selectedReadiness: null,
    playgroundMode: 'retrieve',
    knownJobs: loadKnownJobsFromStorage(),
    isLoading: {
        collections: false,
        jobs: false,
        health: false,
        readiness: false
    },
    lastError: null,
    _healthRequestInProgress: false
};

// --- DOM Elements ---
const elements = {
    navItems: document.querySelectorAll('.nav-item'),
    viewContainers: document.querySelectorAll('.view-container'),
    viewTitle: document.getElementById('viewTitle'),
    collectionsGrid: document.getElementById('collectionsGrid'),
    jobsTableBody: document.getElementById('jobsTableBody'),
    healthGrid: document.getElementById('healthGrid'),
    readinessDetail: document.getElementById('readinessDetail'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnCreateCollection: document.getElementById('btnCreateCollection'),
    
    // Inspector
    inspectorOverlay: document.getElementById('inspectorOverlay'),
    inspectorPanel: document.getElementById('inspectorPanel'),
    inspectorTitle: document.getElementById('inspectorTitle'),
    inspectorStatusBadge: document.getElementById('inspectorStatusBadge'),
    btnCloseInspector: document.getElementById('btnCloseInspector'),
    
    // Inspector Tabs
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    
    // Readiness Tab
    readinessStatusGrid: document.getElementById('readinessStatusGrid'),
    readinessBlockers: document.getElementById('readinessBlockers'),
    blockerList: document.getElementById('blockerList'),
    
    // Playground Tab
    pgModeBtns: document.querySelectorAll('.mode-btn'),
    pgQuestion: document.getElementById('pgQuestion'),
    pgResult: document.getElementById('pgResult'),
    btnPgRun: document.getElementById('btnPgRun'),
    
    // Editor Tab
    colEditForm: document.getElementById('colEditForm'),
    
    // Editor fields
    editId: document.getElementById('editId'),
    editDisplayName: document.getElementById('editDisplayName'),
    editDescription: document.getElementById('editDescription'),
    editSourcePath: document.getElementById('editSourcePath'),
    editOzelgeDataPath: document.getElementById('editOzelgeDataPath'),
    editDistanceMetric: document.getElementById('editDistanceMetric'),
    editChunkSize: document.getElementById('editChunkSize'),
    editChunkOverlap: document.getElementById('editChunkOverlap'),
    editRetrievalK: document.getElementById('editRetrievalK'),
    editRetrievalDistanceThreshold: document.getElementById('editRetrievalDistanceThreshold'),
    editEmbeddingModel: document.getElementById('editEmbeddingModel'),
    editChatModel: document.getElementById('editChatModel'),
    btnCancelEdit: document.getElementById('btnCancelEdit'),
    
    // Inspector actions
    btnReindex: document.getElementById('btnReindex'),
    btnDeleteCol: document.getElementById('btnDeleteCol'),
    
    // Tab contents
    tabReady: document.getElementById('tab-ready'),
    tabPlayground: document.getElementById('tab-playground'),
    tabEditor: document.getElementById('tab-editor'),
    
    // Create-mode tab visibility
    readyTabBtn: document.querySelector('.tab-btn[data-tab="ready"]'),
    playgroundTabBtn: document.querySelector('.tab-btn[data-tab="playground"]'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer'),
    
    // Save button
    btnSave: document.getElementById('btnSave')
};

// --- DOM Helpers ---
function clearNode(node) {
    if (node && typeof node.clearChildren === 'function') {
        node.clearChildren();
    } else if (node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }
    return node;
}

function appendText(node, text) {
    if (!node) return;
    node.appendChild(document.createTextNode(String(text ?? '')));
    return node;
}

function createBadge(text, colorClass) {
    const badge = document.createElement('span');
    badge.className = `px-2 py-1 text-xs font-bold rounded-full uppercase ${colorClass || 'bg-slate-100 text-slate-600'}`;
    appendText(badge, text);
    return badge;
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    try {
        return new Date(isoString).toLocaleString();
    } catch {
        return String(isoString);
    }
}

function formatCount(value) {
    if (value === null || value === undefined) return 'N/A';
    return Number(value).toLocaleString();
}

function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
        btn.textContent = 'Loading...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || btn.textContent;
    }
}

// --- API Wrapper ---
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' }
    };
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        
        // 204 No Content - return null safely
        if (response.status === 204) return null;
        
        // Handle empty or non-JSON response bodies
        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
            const text = await response.text();
            data = text.trim() ? JSON.parse(text) : null;
        } else {
            const text = await response.text();
            data = text.trim() ? JSON.parse(text) : null;
        }

        if (!response.ok) {
            // Normalize error using ApiErrorResponse shape
            const code = data?.code || `HTTP_${response.status}`;
            const message = data?.message || `HTTP ${response.status}`;
            const requestId = data?.requestId;
            const details = data?.details;
            const issues = data?.details?.issues;

            throw {
                status: response.status,
                code: code,
                message: message,
                requestId: requestId,
                details: details,
                issues: issues
            };
        }
        return data;
    } catch (error) {
        // If it's already a normalized error object, re-throw it
        if (error && error.status !== undefined) {
            console.error(`[API Error] ${url}:`, error);
            throw error;
        }
        // Network / fetch errors
        console.error(`[API Error] ${url}:`, error);
        throw {
            status: 0,
            code: 'NETWORK_ERROR',
            message: error?.message || 'Network request failed',
            requestId: null,
            details: null,
            issues: null
        };
    }
}

// --- UI Utilities ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 flex items-center gap-3 animate-in ${
        type === 'success' ? 'bg-emerald-600 text-white' : 
        type === 'error' ? 'bg-rose-600 text-white' : 
        'bg-slate-800 text-white'
    }`;
    
    let icon = '\u2139\uFE0F';
    if (type === 'success') icon = '\u2705';
    if (type === 'error') icon = '\u274C';
    
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    toast.appendChild(iconSpan);
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message || '';
    toast.appendChild(msgSpan);
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-10');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getStatusColor(status) {
    const colors = {
        ready: 'bg-emerald-100 text-emerald-700',
        indexing: 'bg-blue-100 text-blue-700',
        creating: 'bg-amber-100 text-amber-700',
        failed: 'bg-rose-100 text-rose-700',
        archived: 'bg-slate-100 text-slate-600',
        queued: 'bg-blue-100 text-blue-700',
        running: 'bg-indigo-100 text-indigo-700',
        succeeded: 'bg-emerald-100 text-emerald-700',
        cancelled: 'bg-slate-100 text-slate-500'
    };
    return colors[status] || 'bg-slate-100 text-slate-600';
}

function getStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `px-2 py-1 text-xs font-bold rounded-full uppercase ${getStatusColor(status)}`;
    appendText(badge, status || 'unknown');
    return badge;
}

// --- View Management ---
function switchView(viewId) {
    state.currentView = viewId;
    
    // Update nav
    elements.navItems.forEach(item => {
        const isActive = item.dataset.view === viewId;
        item.classList.toggle('active', isActive);
    });
    
    // Update view containers
    elements.viewContainers.forEach(container => {
        const viewName = container.id.replace('view-', '');
        container.classList.toggle('hidden', viewName !== viewId);
    });
    
    // Update title
    const titles = {
        collections: 'Collections',
        jobs: 'Job Monitor',
        health: 'System Health'
    };
    elements.viewTitle.textContent = titles[viewId] || 'Dashboard';
}

// --- Collections Logic ---
async function loadCollections() {
    if (state.isLoading.collections) return;
    state.isLoading.collections = true;
    try {
        const data = await apiRequest(`${API.rag}/collections`);
        state.collections = Array.isArray(data?.collections) ? data.collections : [];
        state.lastError = null;
    } catch (err) {
        state.lastError = err;
        state.collections = [];
        showToast(err.message || 'Failed to load collections', 'error');
    } finally {
        state.isLoading.collections = false;
        renderCollections();
    }
}

function renderCollections() {
    const grid = elements.collectionsGrid;
    clearNode(grid);
    
    if (state.isLoading.collections) {
        const loader = document.createElement('div');
        loader.className = 'col-span-full py-12 text-center text-slate-400 italic';
        appendText(loader, 'Loading collections...');
        grid.appendChild(loader);
        return;
    }
    
    if (state.lastError && state.collections.length === 0) {
        const errDiv = document.createElement('div');
        errDiv.className = 'col-span-full py-12 text-center';
        
        const errTitle = document.createElement('p');
        errTitle.className = 'text-rose-600 font-semibold text-sm mb-2';
        appendText(errTitle, 'Failed to load collections');
        errDiv.appendChild(errTitle);
        
        const errDetail = document.createElement('p');
        errDetail.className = 'text-slate-400 text-xs';
        appendText(errDetail, state.lastError?.message || 'Unknown error');
        errDiv.appendChild(errDetail);
        
        grid.appendChild(errDiv);
        return;
    }
    
    if (state.collections.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'col-span-full py-12 text-center text-slate-400 italic';
        appendText(emptyDiv, 'No collections found. Click "New Collection" to get started.');
        grid.appendChild(emptyDiv);
        return;
    }
    
    // Build card elements with safe text rendering
    state.collections.forEach(col => {
        const card = document.createElement('div');
        card.className = 'bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group relative';
        
        // Click handler for inspector
        card.addEventListener('click', (e) => {
            if (e.target.closest('[data-action]')) return;
            openInspector(col.id);
        });
        
        // Icon
        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 font-bold mb-4';
        const initial = col.displayName ? col.displayName.charAt(0).toUpperCase() : '?';
        iconWrap.textContent = initial;
        card.appendChild(iconWrap);
        
        // Status badge with all backend status values
        const statusColors = {
            ready: 'bg-emerald-100 text-emerald-700',
            indexing: 'bg-blue-100 text-blue-700',
            creating: 'bg-amber-100 text-amber-700',
            failed: 'bg-rose-100 text-rose-700',
            archived: 'bg-slate-100 text-slate-600'
        };
        const statusColor = statusColors[col.status] || 'bg-slate-100 text-slate-600';
        card.appendChild(createBadge(col.status || 'unknown', statusColor));
        
        // Display name
        const title = document.createElement('h3');
        title.className = 'font-bold text-slate-800 group-hover:text-indigo-600 transition-colors mt-3 mb-1';
        appendText(title, col.displayName || 'Unnamed Collection');
        card.appendChild(title);
        
        // Description
        const desc = document.createElement('p');
        desc.className = 'text-xs text-slate-500 line-clamp-2 mb-4';
        appendText(desc, col.description || 'No description provided.');
        card.appendChild(desc);
        
        // Footer
        const footer = document.createElement('div');
        footer.className = 'flex items-center justify-between pt-4 border-t border-slate-100';
        
        const chunkInfo = document.createElement('span');
        chunkInfo.className = 'text-[10px] text-slate-400 font-medium uppercase tracking-wider';
        appendText(chunkInfo, 'Chunks: ' + formatCount(col.chunkCount));
        footer.appendChild(chunkInfo);
        
        const dateInfo = document.createElement('span');
        dateInfo.className = 'text-[10px] text-slate-400 font-medium uppercase tracking-wider';
        appendText(dateInfo, formatDateTime(col.updatedAt));
        footer.appendChild(dateInfo);
        
        const versionInfo = document.createElement('span');
        versionInfo.className = 'text-[10px] text-slate-400 font-medium uppercase tracking-wider';
        appendText(versionInfo, 'v' + formatCount(col.activeVersion));
        footer.appendChild(versionInfo);
        
        card.appendChild(footer);
        grid.appendChild(card);
    });
}

async function openInspector(id) {
    const isCreateMode = id === null;
    
    if (isCreateMode) {
        // CREATE MODE: Clear all fields, disable actions, switch to editor
        state.selectedCollection = null;
        elements.inspectorTitle.textContent = 'Create Collection';
        elements.inspectorStatusBadge.classList.add('hidden');
        
        document.getElementById('editId').value = '';
        document.getElementById('editDisplayName').value = '';
        document.getElementById('editDescription').value = '';
        document.getElementById('editSourcePath').value = '';
        document.getElementById('editOzelgeDataPath').value = '';
        document.getElementById('editDistanceMetric').value = 'l2';
        document.getElementById('editChunkSize').value = '';
        document.getElementById('editChunkOverlap').value = '';
        document.getElementById('editRetrievalK').value = '';
        document.getElementById('editRetrievalDistanceThreshold').value = '';
        document.getElementById('editEmbeddingModel').value = '';
        document.getElementById('editChatModel').value = '';
        
        // Disable Re-index and Delete in create mode
        elements.btnReindex.disabled = true;
        elements.btnReindex.classList.add('opacity-50', 'cursor-not-allowed');
        elements.btnDeleteCol.disabled = true;
        elements.btnDeleteCol.classList.add('opacity-50', 'cursor-not-allowed');
        
        // Hide Readiness and Playground tabs in create mode
        if (elements.readyTabBtn) elements.readyTabBtn.classList.add('hidden');
        if (elements.playgroundTabBtn) elements.playgroundTabBtn.classList.add('hidden');
        if (elements.tabReady) elements.tabReady.classList.add('hidden');
        if (elements.tabPlayground) elements.tabPlayground.classList.add('hidden');
        
        // Switch to editor tab
        switchTab('editor');
    } else {
        // EXISTING COLLECTION MODE: Fill fields, enable actions
        const col = state.collections.find(c => c.id === id);
        if (!col) return;
        state.selectedCollection = col;
        elements.inspectorTitle.textContent = col.displayName;
        elements.inspectorStatusBadge.classList.remove('hidden');
        clearNode(elements.inspectorStatusBadge);
        elements.inspectorStatusBadge.appendChild(getStatusBadge(col.status));

        // Enable Re-index and Delete in existing collection mode
        elements.btnReindex.disabled = false;
        elements.btnReindex.classList.remove('opacity-50', 'cursor-not-allowed');
        elements.btnDeleteCol.disabled = false;
        elements.btnDeleteCol.classList.remove('opacity-50', 'cursor-not-allowed');

        // Show all tabs in edit mode
        if (elements.readyTabBtn) elements.readyTabBtn.classList.remove('hidden');
        if (elements.playgroundTabBtn) elements.playgroundTabBtn.classList.remove('hidden');

        // Switch to readiness tab and load readiness data
        switchTab('ready');
        updateReadinessTab();

        // Fill editor fields with collection data
        setupEditorTab(col);
    }
    
    elements.inspectorOverlay.classList.remove('hidden');
    setTimeout(() => elements.inspectorOverlay.classList.add('opacity-100'), 10);
    elements.inspectorPanel.classList.remove('translate-x-full');
}

function switchTab(tabName) {
    // Update tab buttons
    elements.tabBtns.forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('border-indigo-600', isActive);
        btn.classList.toggle('text-indigo-600', isActive);
        btn.classList.toggle('border-transparent', !isActive);
        btn.classList.toggle('text-slate-500', !isActive);
    });
    
    // Update tab contents
    elements.tabContents.forEach(content => {
        const isMatch = content.id === `tab-${tabName}`;
        content.classList.toggle('hidden', !isMatch);
    });
}

function closeInspector() {
    elements.inspectorPanel.classList.add('translate-x-full');
    elements.inspectorOverlay.classList.remove('opacity-100');
    setTimeout(() => elements.inspectorOverlay.classList.add('hidden'), 200);
}

function handleOverlayClick(e) {
    // Only close if clicking the overlay itself, not the panel
    if (e.target === elements.inspectorOverlay) {
        closeInspector();
    }
}

async function updateReadinessTab() {
    if (!state.selectedCollection) return;
    
    const readinessEl = document.getElementById('readinessStatusGrid');
    clearNode(readinessEl);
    
    try {
        const data = await apiRequest(collectionReadyUrl(state.selectedCollection));
        state.selectedReadiness = data;
        renderReadinessData(data);
        mergeActiveJobFromReadiness(data);
    } catch (err) {
        const errorSpan = document.createElement('span');
        errorSpan.className = 'text-rose-500 text-sm';
        appendText(errorSpan, `Failed to load readiness: ${err.message || 'unknown error'}`);
        readinessEl.appendChild(errorSpan);
    }
}

function renderReadinessData(data) {
    if (!data) return;
    const grid = document.getElementById('readinessStatusGrid');
    clearNode(grid);

    const checks = [
        { label: 'Chroma', ok: data.chromaReadable, icon: '\uD83D\uDDC4\uFE0F' },
        { label: 'Embedding', ok: data.modelAvailability?.embeddingModelAvailable, icon: '\uD83E\uDDE0\uFE0F' },
        { label: 'Chat', ok: data.modelAvailability?.chatModelAvailable, icon: '\uD83D\uDCAC' },
        { label: 'Query', ok: data.capabilities?.query, icon: '\uD83D\uDD0D', color: 'text-indigo-500' },
        { label: 'Retrieve', ok: data.capabilities?.retrieve, icon: '\uD83D\uDCC4', color: 'text-teal-500' }
    ];

    checks.forEach(check => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-slate-600';
        appendText(label, `${check.icon} ${check.label}`);

        const badge = document.createElement('span');
        badge.className = check.ok 
            ? 'text-emerald-600 text-xs font-bold' 
            : 'text-rose-600 text-xs font-bold';
        appendText(badge, check.ok ? 'READY' : 'NOT READY');

        row.appendChild(label);
        row.appendChild(badge);
        grid.appendChild(row);
    });

    // Render blockers in #readinessBlockers
    const blockersDiv = elements.readinessBlockers;
    const blockerList = elements.blockerList;
    if (blockersDiv && blockerList) {
        clearNode(blockerList);
        const blockers = deriveReadinessBlockers(data);
        if (blockers.length > 0) {
            blockersDiv.classList.remove('hidden');
            blockers.forEach(msg => {
                const li = document.createElement('li');
                appendText(li, msg);
                blockerList.appendChild(li);
            });
        } else {
            blockersDiv.classList.add('hidden');
        }
    }

    // Show active job info if present
    if (data.activeJob) {
        const jobRow = document.createElement('div');
        jobRow.className = 'flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100';

        const label = document.createElement('span');
        label.className = 'text-xs font-medium text-amber-700';
        appendText(label, `⚙️ Active Job: ${data.activeJob.id} (${data.activeJob.status})`);

        jobRow.appendChild(label);
        grid.appendChild(jobRow);
    }

    // Update playground capability state
    updatePlaygroundCapabilityState();
}

function deriveReadinessBlockers(readiness) {
    if (!readiness) return [];
    const blockers = [];

    // No active physical collection
    if (!readiness.hasActivePhysicalCollection) {
        blockers.push('No active physical collection — collection needs indexing or is still creating.');
    }

    // Chroma not readable
    if (!readiness.chromaReadable) {
        blockers.push('Chroma collection is not readable — check Chroma service or collection ID.');
    }

    // Embedding model unavailable
    if (readiness.modelAvailability?.embeddingModel && !readiness.modelAvailability.embeddingModelAvailable) {
        blockers.push(`Embedding model "${readiness.modelAvailability.embeddingModel}" is not available.`);
    }

    // Chat model unavailable
    if (readiness.modelAvailability?.chatModel && !readiness.modelAvailability.chatModelAvailable) {
        blockers.push(`Chat model "${readiness.modelAvailability.chatModel}" is not available.`);
    }

    // Retrieve capability false
    if (readiness.capabilities?.retrieve === false) {
        blockers.push('Retrieve capability is disabled.');
    }

    // Query capability false
    if (readiness.capabilities?.query === false) {
        blockers.push('Query capability is disabled.');
    }

    return blockers;
}

function updatePlaygroundCapabilityState() {
    const readiness = state.selectedReadiness;
    if (!readiness) return;

    const pgModeBtns = document.querySelectorAll('.mode-btn');
    pgModeBtns.forEach(btn => {
        const mode = btn.dataset.mode;
        let enabled = false;
        let reason = '';

        if (mode === 'retrieve') {
            enabled = readiness.capabilities?.retrieve === true;
            reason = enabled ? '' : 'Retrieval is not available';
        } else if (mode === 'query') {
            enabled = readiness.capabilities?.query === true;
            reason = enabled ? '' : 'Query is not available';
        }

        if (enabled) {
            btn.disabled = false;
            btn.removeAttribute('title');
        } else {
            btn.disabled = true;
            btn.setAttribute('title', reason);
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    });
}

// --- Editor Tab ---
function setupEditorTab(col) {
    document.getElementById('editId').value = col.id;
    document.getElementById('editDisplayName').value = col.displayName || '';
    document.getElementById('editDescription').value = col.description || '';
    document.getElementById('editSourcePath').value = col.sourcePath || '';
    document.getElementById('editOzelgeDataPath').value = col.ozelgeDataPath || '';
    document.getElementById('editDistanceMetric').value = col.distanceMetric || 'l2';
    document.getElementById('editChunkSize').value = col.chunkSize ?? '';
    document.getElementById('editChunkOverlap').value = col.chunkOverlap ?? '';
    document.getElementById('editRetrievalK').value = col.retrievalK ?? '';
    document.getElementById('editRetrievalDistanceThreshold').value = col.retrievalDistanceThreshold ?? '';
    document.getElementById('editEmbeddingModel').value = col.embeddingModel || '';
    document.getElementById('editChatModel').value = col.chatModel || '';
}

async function saveCollection() {
    const id = document.getElementById('editId').value;
    const mode = id ? 'update' : 'create';

    // Client-side validation
    const errors = validateCollectionForm(mode);
    if (errors.length > 0) {
        showToast(`Validation issues: ${errors.join(', ')}`, 'error');
        return;
    }

    // Build strict payload matching backend schemas
    const payload = buildCollectionPayload(mode);

    // Sanitize payload: remove any NaN values that slipped through
    const sanitized = {};
    for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && !(typeof value === 'number' && isNaN(value))) {
            sanitized[key] = value;
        }
    }

    try {
        elements.btnSave.disabled = true;
        elements.btnSave.textContent = 'Saving...';

        if (mode === 'create') {
            const data = await apiRequest(`${API.admin}/collections`, { method: 'POST', body: JSON.stringify(sanitized) });
            showToast(`Collection created: ${data.collection.id}`, 'success');
        } else {
            await apiRequest(adminCollectionUrl(id), { method: 'PATCH', body: JSON.stringify(sanitized) });
            showToast('Collection updated', 'success');
        }

        await loadCollections();
        closeInspector();
    } catch (err) {
        // Handle INVALID_REQUEST_BODY with details.issues
        if (err.code === 'INVALID_REQUEST_BODY' && err.details?.issues) {
            renderPayloadIssues(err.details.issues);
        } else {
            showToast(err.message || 'Save failed', 'error');
        }
    } finally {
        elements.btnSave.disabled = false;
        elements.btnSave.textContent = 'Save Changes';
    }
}

async function runPlayground() {
    if (!state.selectedCollection) return showToast('Select a collection first', 'error');

    const readiness = state.selectedReadiness;
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode;
    
    if (!mode) return showToast('Invalid playground mode', 'error');

    // Capability guard: check readiness before allowing the request
    if (mode === 'retrieve' && (!readiness || !readiness.capabilities?.retrieve)) {
        return showToast('Retrieve is not available for this collection', 'error');
    }
    if (mode === 'query' && (!readiness || !readiness.capabilities?.query)) {
        return showToast('Query is not available for this collection', 'error');
    }

    const question = elements.pgQuestion.value;
    if (!question?.trim()) return showToast('Question is required', 'error');

    const resultEl = elements.pgResult;
    resultEl.textContent = 'Processing...';
    setButtonLoading(elements.btnPgRun, true);

    try {
        let data;
        if (mode === 'retrieve') {
            const k = elements.pgK?.value ? Number(elements.pgK.value) : undefined;
            data = await apiRequest(collectionRetrieveUrl(state.selectedCollection), {
                method: 'POST',
                body: JSON.stringify({ question, k })
            });
            renderRetrieveResult(data);
        } else {
            data = await apiRequest(collectionQueryUrl(state.selectedCollection), {
                method: 'POST',
                body: JSON.stringify({ question })
            });
            renderQueryResult(data);
        }
    } catch (err) {
        renderPlaygroundError(err);
    } finally {
        setButtonLoading(elements.btnPgRun, false);
    }
}

async function reindexCollection() {
    if (!state.selectedCollection) return;
    try {
        setButtonLoading(elements.btnReindex, true);
        const data = await apiRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: 'POST' });
        if (data?.job) {
            rememberJob(data.job, state.selectedCollection);
        }
        showToast('Re-indexing started', 'success');
        await loadCollections();
        await loadJobs();
        await loadHealth();
    } catch (err) {
        showToast(err.message || 'Re-index failed', 'error');
    } finally {
        setButtonLoading(elements.btnReindex, false);
    }
}

async function deleteCollection() {
    if (!state.selectedCollection) return;
    if (!confirm('Are you sure you want to delete this collection?')) return;
    
    try {
        setButtonLoading(elements.btnDeleteCol, true);
        await apiRequest(adminCollectionUrl(state.selectedCollection.id), { method: 'DELETE' });
        showToast('Collection deleted', 'success');
        await loadCollections();
        closeInspector();
    } catch (err) {
        showToast(err.message || 'Delete failed', 'error');
    } finally {
        setButtonLoading(elements.btnDeleteCol, false);
    }

// --- Jobs & Health Logic ---
    const tbody = elements.jobsTableBody;
    clearNode(tbody);
    
    if (state.knownJobs.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="6" class="px-6 py-12 text-center text-slate-400 italic">
                No jobs tracked. Start a re-index to see jobs here.
                <br><span class="text-xs">This monitor tracks jobs observed by this browser/admin session.</span>
            </td>
        `;
        tbody.appendChild(tr);
        return;
    }
    
    state.knownJobs.forEach(job => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50';
        
        // Job ID
        const tdId = document.createElement('td');
        tdId.className = 'px-6 py-4 text-xs font-mono text-slate-600';
        tdId.textContent = job.id.length > 12 ? job.id.slice(0, 12) + '…' : job.id;
        tr.appendChild(tdId);
        
        // Collection
        const tdCollection = document.createElement('td');
        tdCollection.className = 'px-6 py-4 text-xs text-slate-600';
        appendText(tdCollection, job.collectionDisplayName || job.collectionId || '-');
        tr.appendChild(tdCollection);
        
        // Status
        const tdStatus = document.createElement('td');
        tdStatus.className = 'px-6 py-4';
        const statusBadge = createBadge(
            job.status,
            getStatusColor(job.status)
        );
        tdStatus.appendChild(statusBadge);
        tr.appendChild(tdStatus);
        
        // Version/Progress
        const tdProgress = document.createElement('td');
        tdProgress.className = 'px-6 py-4 text-xs text-slate-500';
        const parts = [];
        if (job.version) parts.push(`v${job.version}`);
        if (job.chunkCount) parts.push(`${job.chunkCount.toLocaleString()} chunks`);
        appendText(tdProgress, parts.join(' • ') || '-');
        tr.appendChild(tdProgress);
        
        // Updated
        const tdUpdated = document.createElement('td');
        tdUpdated.className = 'px-6 py-4 text-xs text-slate-500';
        appendText(tdUpdated, formatDateTime(job.updatedAt));
        tr.appendChild(tdUpdated);
        
        // Actions
        const tdActions = document.createElement('td');
        tdActions.className = 'px-6 py-4 text-right space-x-2';
        
        if (job.status === 'queued' || job.status === 'running') {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'text-xs text-rose-500 hover:text-rose-700 font-medium';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => cancelJob(job.id);
            tdActions.appendChild(cancelBtn);
        }
        
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'text-xs text-slate-400 hover:text-slate-600 font-medium';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => removeJobFromMonitor(job.id);
            tdActions.appendChild(removeBtn);
        }
        
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
}

// --- Jobs & State Management ---
const JOB_STORAGE_KEY = 'ragAdmin.knownJobs.v1';

function loadKnownJobsFromStorage() {
    try {
        const raw = localStorage.getItem(JOB_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter(j => j && j.id);
            }
        }
    } catch (e) {
        console.warn('Failed to load knownJobs from localStorage', e);
    }
    return [];
}

function saveKnownJobsToStorage() {
    try {
        localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(state.knownJobs));
    } catch (e) {
        console.warn('Failed to save knownJobs to localStorage', e);
    }
}

function rememberJob(job, collection) {
    if (!job || !job.id) return;
    
    const existingIndex = state.knownJobs.findIndex(j => j.id === job.id);
    const jobData = {
        id: job.id,
        status: job.status,
        collectionId: collection?.id || null,
        collectionDisplayName: collection?.displayName || null,
        createdAt: job.createdAt || new Date().toISOString(),
        updatedAt: job.updatedAt || new Date().toISOString(),
        finishedAt: job.finishedAt || null,
        error: job.error || null,
        version: job.version || null,
        documentCount: job.documentCount || null,
        chunkCount: job.chunkCount || null
    };

    if (existingIndex >= 0) {
        state.knownJobs[existingIndex] = jobData;
    } else {
        state.knownJobs.push(jobData);
    }
    saveKnownJobsToStorage();
}

function mergeActiveJobFromReadiness(readiness) {
    if (!readiness || !readiness.activeJob) return;
    const activeJob = readiness.activeJob;
    
    const col = state.selectedCollection;
    rememberJob(activeJob, col);
}

async function cancelJob(jobId) {
    try {
        await apiRequest(`${API.admin}/jobs/${jobId}/cancel`, { method: 'POST' });
        showToast('Job cancelled', 'success');
        await loadJobs();
        if (state.selectedCollection) {
            await loadCollections();
        }
    } catch (err) {
        showToast(err.message || 'Cancel failed', 'error');
    }
}

function removeJobFromMonitor(jobId) {
    state.knownJobs = state.knownJobs.filter(j => j.id !== jobId);
    saveKnownJobsToStorage();
    renderJobs();
}

async function loadJobs() {
    if (state.isLoading.jobs) return;
    state.isLoading.jobs = true;
    
    try {
        // Poll each known job
        const updates = [];
        for (const job of state.knownJobs) {
            try {
                const data = await apiRequest(adminJobUrl(job.id));
                if (data) {
                    updates.push({ id: job.id, data });
                }
            } catch (e) {
                // Job might have been cleaned up on server, ignore 404s
                if (e.status !== 404) {
                    console.warn(`Failed to poll job ${job.id}`, e);
                }
            }
        }
        
        // Apply updates
        for (const { id, data } of updates) {
            const existingIndex = state.knownJobs.findIndex(j => j.id === id);
            if (existingIndex >= 0) {
                state.knownJobs[existingIndex] = {
                    ...state.knownJobs[existingIndex],
                    status: data.status,
                    updatedAt: data.updatedAt || state.knownJobs[existingIndex].updatedAt,
                    finishedAt: data.finishedAt || state.knownJobs[existingIndex].finishedAt,
                    error: data.error || state.knownJobs[existingIndex].error,
                    version: data.version || state.knownJobs[existingIndex].version,
                    documentCount: data.documentCount || state.knownJobs[existingIndex].documentCount,
                    chunkCount: data.chunkCount || state.knownJobs[existingIndex].chunkCount
                };
            }
        }
        
        saveKnownJobsToStorage();
        renderJobs();
    } catch (err) {
        showToast(err.message || 'Failed to load jobs', 'error');
    } finally {
        state.isLoading.jobs = false;
    }
}

function renderJobs() {
    const tbody = elements.jobsTableBody;
    clearNode(tbody);
    
    if (state.knownJobs.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="6" class="px-6 py-12 text-center text-slate-400 italic">
                No jobs tracked. Start a re-index to see jobs here.
                <br><span class="text-xs">This monitor tracks jobs observed by this browser/admin session.</span>
            </td>
        `;
        tbody.appendChild(tr);
        return;
    }
    
    state.knownJobs.forEach(job => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50';
        
        // Job ID
        const tdId = document.createElement('td');
        tdId.className = 'px-6 py-4 text-xs font-mono text-slate-600';
        tdId.textContent = job.id.length > 12 ? job.id.slice(0, 12) + '…' : job.id;
        tr.appendChild(tdId);
        
        // Collection
        const tdCollection = document.createElement('td');
        tdCollection.className = 'px-6 py-4 text-xs text-slate-600';
        appendText(tdCollection, job.collectionDisplayName || job.collectionId || '-');
        tr.appendChild(tdCollection);
        
        // Status
        const tdStatus = document.createElement('td');
        tdStatus.className = 'px-6 py-4';
        const statusBadge = createBadge(
            job.status,
            getStatusColor(job.status)
        );
        tdStatus.appendChild(statusBadge);
        tr.appendChild(tdStatus);
        
        // Version/Progress
        const tdProgress = document.createElement('td');
        tdProgress.className = 'px-6 py-4 text-xs text-slate-500';
        const parts = [];
        if (job.version) parts.push(`v${job.version}`);
        if (job.chunkCount) parts.push(`${job.chunkCount.toLocaleString()} chunks`);
        appendText(tdProgress, parts.join(' • ') || '-');
        tr.appendChild(tdProgress);
        
        // Updated
        const tdUpdated = document.createElement('td');
        tdUpdated.className = 'px-6 py-4 text-xs text-slate-500';
        appendText(tdUpdated, formatDateTime(job.updatedAt));
        tr.appendChild(tdUpdated);
        
        // Actions
        const tdActions = document.createElement('td');
        tdActions.className = 'px-6 py-4 text-right space-x-2';
        
        if (job.status === 'queued' || job.status === 'running') {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'text-xs text-rose-500 hover:text-rose-700 font-medium';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => cancelJob(job.id);
            tdActions.appendChild(cancelBtn);
        }
        
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'text-xs text-slate-400 hover:text-slate-600 font-medium';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => removeJobFromMonitor(job.id);
            tdActions.appendChild(removeBtn);
        }
        
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
}

// --- Health Logic ---
async function loadHealth() {
    // Prevent overlapping requests
    if (state.isLoading.health || state._healthRequestInProgress) return;
    state._healthRequestInProgress = true;
    
    try {
        const [health, ready, readyDetails] = await Promise.all([
            apiRequest(API.health),
            apiRequest(API.ready),
            apiRequest(`${API.ready}?details=true`)
        ]);
        
        state.healthStatus = health;
        state.readiness = ready;
        state.readinessDetails = readyDetails;
        
        renderHealthSummary(health, ready);
        if (ready?.ready !== undefined || readyDetails) {
            renderReadinessDetail(ready, readyDetails);
        }
    } catch (err) {
        showToast(err.message || 'Health check failed', 'error');
    } finally {
        state._healthRequestInProgress = false;
        state.isLoading.health = false;
    }
}

function renderHealthSummary(health, ready) {
    const grid = elements.healthGrid;
    clearNode(grid);
    
    if (!health && !ready) {
        grid.innerHTML = '<div class="col-span-full text-center text-slate-400 italic py-8">Health data unavailable</div>';
        return;
    }
    
    // Process card
    if (health) {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl border border-slate-200 shadow-sm p-6';
        
        const title = document.createElement('h3');
        title.className = 'text-sm font-bold text-slate-500 uppercase mb-3';
        appendText(title, 'Process');
        card.appendChild(title);
        
        const grid2 = document.createElement('div');
        grid2.className = 'grid grid-cols-2 gap-3 text-xs';
        
        const statusVal = health.status || health.alive || health;
        const statusBadge = createBadge(
            String(statusVal), 
            statusVal === 'ok' || statusVal === true ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        );
        grid2.appendChild(statusBadge);
        
        const portLabel = document.createElement('span');
        appendText(portLabel, health.port ? `Port: ${health.port}` : 'Port: -');
        grid2.appendChild(portLabel);
        
        card.appendChild(grid2);
        grid.appendChild(card);
    }
    
    // Readiness card
    if (ready) {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl border border-slate-200 shadow-sm p-6';
        
        const title = document.createElement('h3');
        title.className = 'text-sm font-bold text-slate-500 uppercase mb-3';
        appendText(title, 'Readiness');
        card.appendChild(title);
        
        const grid2 = document.createElement('div');
        grid2.className = 'grid grid-cols-2 gap-3 text-xs';
        
        const readyBadge = createBadge(
            ready.ready ? 'READY' : 'NOT READY',
            ready.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
        );
        grid2.appendChild(readyBadge);
        
        const summaryLabel = document.createElement('span');
        appendText(summaryLabel, ready.overallSummary || 'System available');
        grid2.appendChild(summaryLabel);
        
        card.appendChild(grid2);
        grid.appendChild(card);
    }
}

function renderReadinessDetail(ready, details) {
    if (!ready && !details) return;
    const container = elements.readinessDetail;
    clearNode(container);
    
    // Render checks section
    if (details?.checks && details.checks.length > 0) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-slate-500 uppercase mb-3';
        appendText(heading, 'Checks');
        container.appendChild(heading);
        
        const grid = document.createElement('div');
        grid.className = 'space-y-2 mb-6';
        
        details.checks.forEach(check => {
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs';
            
            const left = document.createElement('div');
            const name = document.createElement('span');
            name.className = 'font-semibold text-slate-600';
            appendText(name, check.name || check.code || 'Unknown');
            left.appendChild(name);
            
            const code = document.createElement('span');
            code.className = 'text-slate-400 ml-2';
            appendText(code, check.code || '');
            left.appendChild(code);
            
            const right = document.createElement('span');
            const statusColor = check.status === 'ok' ? 'text-emerald-600' : check.status === 'warn' ? 'text-amber-600' : 'text-rose-600';
            right.className = `font-bold uppercase ${statusColor}`;
            appendText(right, check.status || 'UNKNOWN');
            
            item.appendChild(left);
            item.appendChild(right);
            grid.appendChild(item);
        });
        
        container.appendChild(grid);
    }
    
    // Render blockers
    if (details?.blockers && details.blockers.length > 0) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-rose-600 uppercase mb-3';
        appendText(heading, 'Blockers');
        container.appendChild(heading);
        
        const list = document.createElement('div');
        list.className = 'space-y-2 mb-6';
        
        details.blockers.forEach(blocker => {
            const item = document.createElement('div');
            item.className = 'flex items-start gap-3 p-3 bg-rose-50 border border-rose-100 rounded-lg text-xs text-rose-700';
            const icon = document.createElement('span');
            icon.className = 'w-4 h-4 text-rose-500 shrink-0';
            icon.textContent = '\uD83D\uDD34';
            item.appendChild(icon);
            appendText(item, blocker);
            list.appendChild(item);
        });
        
        container.appendChild(list);
    }
    
    // Render warnings
    if (details?.warnings && details.warnings.length > 0) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-amber-600 uppercase mb-3';
        appendText(heading, 'Warnings');
        container.appendChild(heading);
        
        const list = document.createElement('div');
        list.className = 'space-y-2 mb-6';
        
        details.warnings.forEach(warning => {
            const item = document.createElement('div');
            item.className = 'flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700';
            const icon = document.createElement('span');
            icon.className = 'w-4 h-4 text-amber-500 shrink-0';
            icon.textContent = '\u26A0\uFE0F';
            item.appendChild(icon);
            appendText(item, warning);
            list.appendChild(item);
        });
        
        container.appendChild(list);
    }
    
    // Render recommended actions
    if (details?.recommendedActions && details.recommendedActions.length > 0) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-slate-500 uppercase mb-3';
        appendText(heading, 'Recommended Actions');
        container.appendChild(heading);
        
        const list = document.createElement('div');
        list.className = 'space-y-2 mb-6';
        
        details.recommendedActions.forEach(action => {
            const item = document.createElement('div');
            item.className = 'flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-600';
            const icon = document.createElement('span');
            icon.className = 'w-4 h-4 text-indigo-500 shrink-0';
            icon.textContent = '\u2139\uFE0F';
            item.appendChild(icon);
            appendText(item, action);
            list.appendChild(item);
        });
        
        container.appendChild(list);
    }
    
    // Render empty states
    const hasContent = (details?.checks?.length > 0) || (details?.blockers?.length > 0) || 
                       (details?.warnings?.length > 0) || (details?.recommendedActions?.length > 0);
    if (hasContent === false) {
        const msg = document.createElement('p');
        msg.className = 'text-xs text-slate-400 italic';
        appendText(msg, 'No additional details available.');
        container.appendChild(msg);
    }
    
    // Render config info
    if (details?.dataSource?.chatModel || details?.dataSource?.embeddingModel || details?.dataSource?.chromaUrl) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-slate-500 uppercase mb-3 mt-6';
        appendText(heading, 'Configuration');
        container.appendChild(heading);
        
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-3 text-xs';
        
        const addConfig = (label, value) => {
            if (!value) return;
            const row = document.createElement('div');
            row.className = 'flex flex-col p-2 bg-slate-50 rounded border border-slate-100';
            const lbl = document.createElement('span');
            lbl.className = 'text-slate-400 font-semibold uppercase tracking-wider';
            appendText(lbl, label);
            row.appendChild(lbl);
            const val = document.createElement('span');
            val.className = 'text-slate-700 font-medium';
            appendText(val, value);
            row.appendChild(val);
            grid.appendChild(row);
        };
        
        addConfig('Chat Model', details.dataSource.chatModel);
        addConfig('Embedding Model', details.dataSource.embeddingModel);
        addConfig('Chroma URL', details.dataSource.chromaUrl);
        if (ready?.port) addConfig('Port', ready.port);
        
        container.appendChild(grid);
    }
    
    // Render dependencies
    if (details?.dependencies) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-slate-500 uppercase mb-3 mt-6';
        appendText(heading, 'Dependencies');
        container.appendChild(heading);
        
        const deps = details.dependencies;
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-3 gap-3 text-xs';
        
        const addDep = (label, status, url) => {
            const row = document.createElement('div');
            row.className = 'flex flex-col p-2 bg-slate-50 rounded border border-slate-100';
            const lbl = document.createElement('span');
            lbl.className = 'text-slate-400 font-semibold uppercase tracking-wider mb-1';
            appendText(lbl, label);
            row.appendChild(lbl);
            const statusBadge = createBadge(status, status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700');
            row.appendChild(statusBadge);
            if (url) {
                const urlSpan = document.createElement('span');
                urlSpan.className = 'text-slate-500 mt-1';
                appendText(urlSpan, url);
                row.appendChild(urlSpan);
            }
            grid.appendChild(row);
        };
        
        addDep('Registry', deps.registry?.status || 'unknown', deps.registry?.url);
        addDep('Chroma', deps.chroma?.status || 'unknown', deps.chroma?.url);
        addDep('Ollama', deps.ollama?.status || 'unknown', deps.ollama?.url);
        
        container.appendChild(grid);
    }
}

// --- Form Helpers ---
function readTrimmed(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function readOptionalInteger(id) {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const val = el.value.trim();
    if (val === '') return undefined;
    const num = Number(val);
    if (!Number.isInteger(num)) return NaN;
    return num;
}

function readOptionalNumber(id) {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const val = el.value.trim();
    if (val === '') return undefined;
    const num = Number(val);
    if (isNaN(num)) return NaN;
    return num;
}

function renderPayloadIssues(issues) {
    if (!issues || !Array.isArray(issues) || issues.length === 0) return;
    const lines = issues.map(i => {
        const path = i.path ? i.path.join('.') : '(unknown)';
        return `${path}: ${i.message}`;
    });
    showToast(`Validation issues: ${lines.join(', ')}`, 'error');
}

function validateCollectionForm(mode) {
    const errors = [];
    const displayName = readTrimmed('editDisplayName');

    if (mode === 'create' && !displayName) {
        errors.push('displayName is required for new collections');
    }
    if (mode === 'update' && displayName === '') {
        errors.push('displayName cannot be empty');
    }

    const chunkSize = readOptionalInteger('editChunkSize');
    if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
        errors.push('chunkSize must be a positive integer');
    }

    const chunkOverlap = readOptionalInteger('editChunkOverlap');
    if (chunkOverlap !== undefined && (!Number.isInteger(chunkOverlap) || chunkOverlap < 0)) {
        errors.push('chunkOverlap must be a non-negative integer');
    }

    if (chunkSize !== undefined && chunkOverlap !== undefined && !isNaN(chunkSize) && !isNaN(chunkOverlap) && chunkOverlap >= chunkSize) {
        errors.push('chunkOverlap must be less than chunkSize');
    }

    const retrievalK = readOptionalInteger('editRetrievalK');
    if (retrievalK !== undefined && (!Number.isInteger(retrievalK) || retrievalK <= 0)) {
        errors.push('retrievalK must be a positive integer');
    }

    const retrievalThreshold = readOptionalNumber('editRetrievalDistanceThreshold');
    if (retrievalThreshold !== undefined && (isNaN(retrievalThreshold) || retrievalThreshold < 0)) {
        errors.push('retrievalDistanceThreshold must be a non-negative number');
    }

    const distanceMetric = readTrimmed('editDistanceMetric');
    if (distanceMetric && !['l2', 'cosine', 'ip'].includes(distanceMetric)) {
        errors.push('distanceMetric must be l2, cosine, or ip');
    }

    return errors;
}

function buildCollectionPayload(mode) {
    const id = document.getElementById('editId').value;
    const displayName = readTrimmed('editDisplayName');
    const description = readTrimmed('editDescription');
    const sourcePath = readTrimmed('editSourcePath');
    const ozelgeDataPath = readTrimmed('editOzelgeDataPath');
    const distanceMetric = readTrimmed('editDistanceMetric');
    const embeddingModel = readTrimmed('editEmbeddingModel');
    const chatModel = readTrimmed('editChatModel');
    const chunkSize = readOptionalInteger('editChunkSize');
    const chunkOverlap = readOptionalInteger('editChunkOverlap');
    const retrievalK = readOptionalInteger('editRetrievalK');
    const retrievalDistanceThreshold = readOptionalNumber('editRetrievalDistanceThreshold');

    const payload = {};

    // displayName
    if (displayName) {
        payload.displayName = displayName;
    }

    // description — omit if empty string, send null only for explicit clear in update mode
    if (description) {
        payload.description = description;
    } else if (mode === 'update' && id) {
        // Only send null for empty description in update mode (explicit clear)
        payload.description = null;
    }

    // sourcePath
    if (sourcePath) {
        payload.sourcePath = sourcePath;
    }

    // ozelgeDataPath
    if (ozelgeDataPath) {
        payload.ozelgeDataPath = ozelgeDataPath;
    }

    // distanceMetric
    if (distanceMetric && ['l2', 'cosine', 'ip'].includes(distanceMetric)) {
        payload.distanceMetric = distanceMetric;
    }

    // chunkSize
    if (chunkSize !== undefined) {
        if (Number.isInteger(chunkSize) && chunkSize > 0) {
            payload.chunkSize = chunkSize;
        }
    }

    // chunkOverlap
    if (chunkOverlap !== undefined) {
        if (Number.isInteger(chunkOverlap) && chunkOverlap >= 0) {
            payload.chunkOverlap = chunkOverlap;
        }
    }

    // retrievalK
    if (retrievalK !== undefined) {
        if (Number.isInteger(retrievalK) && retrievalK > 0) {
            payload.retrievalK = retrievalK;
        }
    }

    // retrievalDistanceThreshold
    if (retrievalDistanceThreshold !== undefined) {
        if (!isNaN(retrievalDistanceThreshold) && retrievalDistanceThreshold >= 0) {
            payload.retrievalDistanceThreshold = retrievalDistanceThreshold;
        }
    }

    // embeddingModel
    if (embeddingModel) {
        payload.embeddingModel = embeddingModel;
    }

    // chatModel
    if (chatModel) {
        payload.chatModel = chatModel;
    }

    return payload;
}

// --- Event Handlers ---
document.addEventListener('DOMContentLoaded', () => {
    elements.navItems.forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            switchView(item.dataset.view);
        };
    });

    elements.btnRefresh.onclick = () => {
        loadCollections();
        loadJobs();
        loadHealth();
    };

    elements.btnCreateCollection.onclick = () => {
        openInspector(null);
    };

    elements.btnCloseInspector.onclick = closeInspector;
    elements.inspectorOverlay.onclick = handleOverlayClick;
    elements.btnCancelEdit.onclick = closeInspector;

    // Escape key closes inspector
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !elements.inspectorOverlay.classList.contains('hidden')) {
            closeInspector();
        }
    });

    elements.tabBtns.forEach(btn => {
        btn.onclick = () => {
            switchTab(btn.dataset.tab);
            
            // Update readiness tab when switched to
            if (btn.dataset.tab === 'ready') {
                updateReadinessTab();
            }
        };
    });

    elements.pgModeBtns.forEach(btn => {
        btn.onclick = () => {
            state.playgroundMode = btn.dataset.mode;
            elements.pgModeBtns.forEach(b => {
                b.classList.remove('active', 'bg-indigo-600', 'text-white');
                b.classList.add('bg-slate-200', 'text-slate-600');
            });
            btn.classList.add('active', 'bg-indigo-600', 'text-white');
            btn.classList.remove('bg-slate-200', 'text-slate-600');
        };
    });

    elements.colEditForm.onsubmit = (e) => {
        e.preventDefault();
        saveCollection();
    };
    elements.btnReindex.onclick = reindexCollection;
    elements.btnDeleteCol.onclick = deleteCollection;
    elements.btnPgRun.onclick = runPlayground;

    // Init
    switchView('collections');
    loadCollections();
    loadJobs();
    loadHealth();

    setInterval(loadJobs, 10000);
    setInterval(loadHealth, 30000);
});
