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

// State Management
let state = {
    currentView: 'collections',
    collections: [],
    selectedCollection: null,
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

// --- API Wrapper ---
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' }
    };
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        
        if (response.status === 204) return null;
        
        const data = await response.json();
        if (!response.ok) {
            throw { 
                message: data.message || `HTTP ${response.status}`, 
                issues: data.issues, 
                status: response.status 
            };
        }
        return data;
    } catch (error) {
        console.error(`[API Error] ${url}:`, error);
        throw error;
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
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-10');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getStatusBadge(status) {
    const styles = {
        ready: 'bg-emerald-100 text-emerald-700',
        indexing: 'bg-blue-100 text-blue-700',
        error: 'bg-rose-100 text-rose-700',
        default: 'bg-slate-100 text-slate-700'
    };
    const style = styles[status] || styles.default;
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${style}">${status}</span>`;
}

// --- View Management ---
function switchView(viewId) {
    state.currentView = viewId;
    
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });
    
    elements.viewContainers.forEach(container => {
        container.classList.toggle('hidden', container.id !== `view-${viewId}`);
    });
    
    const titleMap = {
        collections: 'Collections',
        jobs: 'Job Monitor',
        health: 'System Health'
    };
    elements.viewTitle.textContent = titleMap[viewId];
}

// --- Collections Logic ---
async function loadCollections() {
    try {
        const data = await apiRequest(`${API.rag}/collections`);
        state.collections = data.collections;
        renderCollections();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderCollections() {
    elements.collectionsGrid.innerHTML = state.collections.map(col => `
        <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group relative" onclick="openInspector('${col.id}')">
            <div class="flex justify-between items-start mb-4">
                <div class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 font-bold">
                    ${col.displayName.charAt(0)}
                </div>
                ${getStatusBadge(col.status)}
            </div>
            <h3 class="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">${col.displayName}</h3>
            <p class="text-xs text-slate-500 line-clamp-2 mb-4">${col.description || 'No description provided.'}</p>
            <div class="flex items-center justify-between pt-4 border-t border-slate-100">
                <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Chunks: ${col.chunkCount ?? 'N/A'}</span>
                <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">${new Date(col.updatedAt).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
}

async function openInspector(id) {
    const col = state.collections.find(c => c.id === id);
    
    if (id === null) {
        state.selectedCollection = null;
        elements.inspectorTitle.textContent = 'Create Collection';
        elements.inspectorStatusBadge.classList.add('hidden');
        
        // Reset form
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
        
        // Focus Editor
        document.querySelector('[data-tab="editor"]').click();
    } else {
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

        await updateReadinessTab();
        setupEditorTab(col);
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
    const id = state.selectedCollection.id;
    
    try {
        const data = await apiRequest(`${API.rag}/collections/${id}/ready`);
        const payload = data.payload;
        
        const healthMap = [
            { label: 'Chroma DB', ok: payload.dependencies.chroma.ok, detail: 'Chroma availability' },
            { label: 'Ollama', ok: payload.dependencies.ollama.ok, detail: 'Inference engine' },
            { label: 'Embedding Model', ok: payload.capabilities.retrieve, detail: payload.embeddingModelAvailable ? 'Model loaded' : 'Model missing' },
            { label: 'Chat Model', ok: payload.capabilities.query, detail: payload.chatModelAvailable ? 'Model loaded' : 'Model missing' }
        ];

        elements.readinessStatusGrid.innerHTML = healthMap.map(item => `
            <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div class="flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full ${item.ok ? 'bg-emerald-500' : 'bg-rose-500'}"></div>
                    <span class="text-sm font-medium text-slate-700">${item.label}</span>
                </div>
                <span class="text-xs text-slate-500">${item.detail}</span>
            </div>
        `).join('');

        if (payload.blockers && payload.blockers.length > 0) {
            elements.readinessBlockers.classList.remove('hidden');
            elements.blockerList.innerHTML = payload.blockers.map(b => `<li class="mb-1">${b.message}</li>`).join('');
        } else {
            elements.readinessBlockers.classList.add('hidden');
        }
    } catch (err) {
        elements.readinessStatusGrid.innerHTML = `<p class="text-rose-500 text-sm">Error loading readiness: ${err.message}</p>`;
    }
}

function setupEditorTab(col) {
    document.getElementById('editId').value = col.id;
    document.getElementById('editDisplayName').value = col.displayName;
    document.getElementById('editDescription').value = col.description || '';
    document.getElementById('editSourcePath').value = col.sourcePath || '';
    document.getElementById('editOzelgeDataPath').value = col.ozelgeDataPath || '';
    document.getElementById('editDistanceMetric').value = col.distanceMetric;
    document.getElementById('editChunkSize').value = col.chunkSize || '';
    document.getElementById('editChunkOverlap').value = col.chunkOverlap || '';
    document.getElementById('editRetrievalK').value = col.retrievalK || '';
    document.getElementById('editRetrievalDistanceThreshold').value = col.retrievalDistanceThreshold || '';
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
            await apiRequest(`${API.admin}/collections/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
            showToast('Collection updated');
        } else {
            const data = await apiRequest(`${API.admin}/collections`, { method: 'POST', body: JSON.stringify(payload) });
            showToast(`Collection created: ${data.collection.id}`);
        }
        await loadCollections();
        closeInspector();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function runPlayground() {
    if (!state.selectedCollection) return;
    
    const mode = document.querySelector('.mode-btn.active').dataset.mode;
    const question = document.getElementById('pgQuestion').value;
    
    if (!question) return showToast('Question is required', 'error');
    
    const id = state.selectedCollection.id;
    const resultEl = document.getElementById('pgResult');
    
    resultEl.innerHTML = '<span class="text-slate-400 animate-pulse">Processing...</span>';
    
    try {
        let data;
        if (mode === 'retrieve') {
            data = await apiRequest(`${API.rag}/collections/${id}/retrieve`, {
                method: 'POST',
                body: JSON.stringify({ question, k: 5 })
            });
        } else {
            data = await apiRequest(`${API.rag}/collections/${id}/query`, {
                method: 'POST',
                body: JSON.stringify({ question })
            });
        }
        resultEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        resultEl.innerHTML = `<span class="text-rose-500">Error: ${err.message}</span>`;
    }
}

async function reindexCollection() {
    if (!state.selectedCollection) return;
    try {
        await apiRequest(`${API.admin}/collections/${state.selectedCollection.id}/reindex`, { method: 'POST' });
        showToast('Re-indexing started');
        loadCollections();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteCollection() {
    if (!state.selectedCollection) return;
    if (!confirm('Are you sure you want to delete this collection?')) return;
    
    try {
        await apiRequest(`${API.admin}/collections/${state.selectedCollection.id}`, { method: 'DELETE' });
        showToast('Collection deleted');
        await loadCollections();
        closeInspector();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Jobs & Health Logic ---
async function loadJobs() {
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
    }
}

async function loadHealth() {
    try {
        const [health, ready] = await Promise.all([
            apiRequest(API.health),
            apiRequest(API.ready)
        ]);
        
        state.healthStatus = health;
        state.readiness = ready;

        elements.healthGrid.innerHTML = `
            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h4 class="text-sm font-bold text-slate-500 uppercase mb-4">System Health</h4>
                <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full ${health.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}"></div>
                    <span class="text-lg font-semibold">${health.status === 'ok' ? 'Healthy' : 'Degraded'}</span>
                </div>
                <p class="text-xs text-slate-400 mt-2">Uptime: ${health.uptimeSec}s | Port: ${health.port}</p>
            </div>
            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h4 class="text-sm font-bold text-slate-500 uppercase mb-4">Readiness</h4>
                <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full ${ready.ready ? 'bg-emerald-500' : 'bg-rose-500'}"></div>
                    <span class="text-lg font-semibold">${ready.ready ? 'Ready' : 'Not Ready'}</span>
                </div>
                <p class="text-xs text-slate-400 mt-2">${ready.overallSummary}</p>
            </div>
            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h4 class="text-sm font-bold text-slate-500 uppercase mb-4">Dependencies</h4>
                <div class="space-y-2">
                    <div class="flex justify-between text-xs">
                        <span class="text-slate-500">Registry</span>
                        <span class="${ready.dependencies.registry.ok ? 'text-emerald-600' : 'text-rose-600'} font-bold">${ready.dependencies.registry.ok ? 'OK' : 'FAIL'}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <span class="text-slate-500">Chroma</span>
                        <span class="${ready.dependencies.chroma.ok ? 'text-emerald-600' : 'text-rose-600'} font-bold">${ready.dependencies.chroma.ok ? 'OK' : 'FAIL'}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <span class="text-slate-500">Ollama</span>
                        <span class="${ready.dependencies.ollama.ok ? 'text-emerald-600' : 'text-rose-600'} font-bold">${ready.dependencies.ollama.ok ? 'OK' : 'FAIL'}</span>
                    </div>
                </div>
            </div>
        `;

        elements.readinessDetail.innerHTML = `
            <h4 class="text-sm font-bold text-slate-500 uppercase mb-4">Recommended Actions</h4>
            <div class="space-y-2">
                ${ready.recommendedActions.map(action => `
                    <div class="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-600">
                        <svg class="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        ${action}
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Event Handlers ---
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
    });
});

elements.pgModeBtns.forEach(btn => {
    btn.onclick = () => {
        elements.pgModeBtns.forEach(b => {
            b.classList.remove('active', 'bg-indigo- la600', 'text-white');
            b.classList.add('bg-slate-200', 'text-slate-600');
        });
        btn.classList.add('active', 'bg-indigo-600', 'text-white');
        btn.classList.remove('bg-slate-200', 'text-slate-600');
    });
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
