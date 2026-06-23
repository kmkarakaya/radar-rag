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
    knownJobs: [],
    isLoading: {
        collections: false,
        jobs: false,
        health: false,
        readiness: false
    },
    lastError: null,
    activeJobs: [],
    healthStatus: null,
    readiness: null
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
    
    // Inspector Actions
    btnReindex: document.getElementById('btnReindex'),
    btnDeleteCol: document.getElementById('btnDeleteCol'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer')
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

function getStatusBadge(status) {
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
    const colorClass = colors[status] || 'bg-slate-100 text-slate-600';
    return `<span class="px-2 py-1 text-[10px] font-bold rounded-full uppercase ${colorClass}">${status || 'unknown'}</span>`;
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
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-slate-400 italic">
                Loading collections...
            </div>
        `;
        return;
    }
    
    if (state.collections.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-slate-400 italic">
                No collections found. Click "New Collection" to get started.
            </div>
        `;
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
        
        // Status badge
        card.appendChild(createBadge(col.status || 'unknown', 
            col.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 
            col.status === 'indexing' ? 'bg-blue-100 text-blue-700' : 
            'bg-rose-100 text-rose-700'
        ));
        
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
        
        card.appendChild(footer);
        grid.appendChild(card);
    });
}

async function openInspector(id) {
    if (id === null) {
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
        
        const editorTab = document.querySelector('[data-tab="editor"]');
        if (editorTab) editorTab.click();
    } else {
        const col = state.collections.find(c => c.id === id);
        if (!col) return;
        state.selectedCollection = col;
        elements.inspectorTitle.textContent = col.displayName;
        elements.inspectorStatusBadge.classList.remove('hidden');
        elements.inspectorStatusBadge.className = `px-2 py-1 text-xs font-bold rounded-full uppercase ${
            col.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 
            col.status === 'indexing' ? 'bg-blue-100 text-blue-700' : 
            'bg-rose-100 text-rose-700'
        }`;
        elements.inspectorStatusBadge.textContent = col.status;

        setupEditorTab(col);
        updateReadinessTab();
    }
    
    elements.inspectorOverlay.classList.remove('hidden');
    setTimeout(() => elements.inspectorOverlay.classList.add('opacity-100'), 10);
    elements.inspectorPanel.classList.remove('translate-x-full');
}

function closeInspector() {
    elements.inspectorPanel.classList.add('translate-x-full');
    elements.inspectorOverlay.classList.remove('opacity-100');
    setTimeout(() => elements.inspectorOverlay.classList.add('hidden'), 200);
}

async function updateReadinessTab() {
    if (!state.selectedCollection) return;
    
    const readinessEl = document.getElementById('readinessStatusGrid');
    
    try {
        const data = await apiRequest(collectionReadyUrl(state.selectedCollection));
        state.selectedReadiness = data;
        clearNode(readinessEl);
        renderReadinessData(data);
    } catch (err) {
        readinessEl.innerHTML = `<span class="text-rose-500 text-sm">Failed to load readiness: ${err.message || 'unknown error'}</span>`;
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
}

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
    const payload = {
        displayName: document.getElementById('editDisplayName').value,
        description: document.getElementById('editDescription').value || null,
        sourcePath: document.getElementById('editSourcePath').value || undefined,
        ozelgeDataPath: document.getElementById('editOzelgeDataPath').value || undefined,
        distanceMetric: document.getElementById('editDistanceMetric').value,
        chunkSize: parseInt(document.getElementById('editChunkSize').value) || undefined,
        chunkOverlap: parseInt(document.getElementById('editChunkOverlap').value) || undefined,
        retrievalK: parseInt(document.getElementById('editRetrievalK').value) || undefined,
        retrievalDistanceThreshold: parseFloat(document.getElementById('editRetrievalDistanceThreshold').value) || undefined,
        embeddingModel: document.getElementById('editEmbeddingModel').value || undefined,
        chatModel: document.getElementById('editChatModel').value || undefined
    };

    try {
        if (id) {
            await apiRequest(adminCollectionUrl(id), { method: 'PATCH', body: JSON.stringify(payload) });
            showToast('Collection updated', 'success');
        } else {
            const data = await apiRequest(`${API.admin}/collections`, { method: 'POST', body: JSON.stringify(payload) });
            showToast(`Collection created: ${data.collection.id}`, 'success');
        }
        await loadCollections();
        closeInspector();
    } catch (err) {
        showToast(err.message || 'Save failed', 'error');
    }
}

async function runPlayground() {
    if (!state.selectedCollection) return;
    
    const mode = document.querySelector('.mode-btn.active').dataset.mode;
    const question = document.getElementById('pgQuestion').value;
    
    if (!question) return showToast('Question is required', 'error');
    
    const id = state.selectedCollection.id;
    const resultEl = document.getElementById('pgResult');
    
    resultEl.textContent = 'Processing...';
    
    try {
        let data;
        if (mode === 'retrieve') {
            data = await apiRequest(collectionRetrieveUrl(state.selectedCollection), {
                method: 'POST',
                body: JSON.stringify({ question })
            });
        } else {
            data = await apiRequest(collectionQueryUrl(state.selectedCollection), {
                method: 'POST',
                body: JSON.stringify({ question })
            });
        }
        resultEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        resultEl.textContent = `Error: ${err.message}`;
    }
}

async function reindexCollection() {
    if (!state.selectedCollection) return;
    try {
        setButtonLoading(elements.btnReindex, true);
        await apiRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: 'POST' });
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
}

// --- Jobs & Health Logic ---
async function loadJobs() {
    if (state.isLoading.jobs) return;
    state.isLoading.jobs = true;
    try {
        elements.jobsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-12 text-center text-slate-400 italic">
                    No active jobs. Trigger a re-index to see jobs here.
                    <br><span class="text-xs">(Backend does not support job listing yet)</span>
                </td>
            </tr>
        `;
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        state.isLoading.jobs = false;
    }
}

async function loadHealth() {
    if (state.isLoading.health) return;
    state.isLoading.health = true;
    try {
        const [health, ready] = await Promise.all([
            apiRequest(API.health),
            apiRequest(API.ready)
        ]);
        state.healthStatus = health;
        state.readiness = ready;
        
        renderHealthSummary(health, ready);
        if (ready?.ready !== undefined) {
            renderReadinessDetail(ready);
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
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

function renderReadinessDetail(ready) {
    if (!ready) return;
    const container = elements.readinessDetail;
    clearNode(container);
    
    if (ready.recommendedActions && ready.recommendedActions.length > 0) {
        const heading = document.createElement('h4');
        heading.className = 'text-sm font-bold text-slate-500 uppercase mb-4';
        appendText(heading, 'Recommended Actions');
        container.appendChild(heading);
        
        const list = document.createElement('div');
        list.className = 'space-y-2';
        
        ready.recommendedActions.forEach(action => {
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
    elements.inspectorOverlay.onclick = closeInspector;

    elements.tabBtns.forEach(btn => {
        btn.onclick = () => {
            elements.tabContents.forEach(content => {
                content.classList.toggle('hidden', content.id !== `tab-${btn.dataset.tab}`);
            });
            elements.tabBtns.forEach(t => {
                t.classList.remove('active', 'border-indigo-600', 'text-indigo-600');
                t.classList.add('border-transparent', 'text-slate-500');
            });
            btn.classList.add('active', 'border-indigo-600', 'text-indigo-600');
            btn.classList.remove('border-transparent', 'text-slate-500');
            
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
