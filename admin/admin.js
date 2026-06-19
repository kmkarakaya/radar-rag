/**
 * RAG Backend Admin Logic
 * Covers all implemented API endpoints:
 * - GET /v1/rag/collections (list)
 * - GET /v1/rag/collections/:id (details)
 * - GET /v1/rag/collections/:id/ready (readiness)
 * - POST /v1/admin/collections (create)
 * - PATCH /v1/admin/collections/:id (update)
 * - DELETE /v1/admin/collections/:id (delete)
 * - POST /v1/admin/collections/:id/reindex (reindex)
 * - GET /v1/admin/jobs/:id (job status)
 * - POST /v1/admin/jobs/:id/cancel (cancel job)
 * - POST /v1/rag/collections/:id/retrieve (retrieve sources)
 * - POST /v1/rag/collections/:id/query (chat query)
 * - GET /health (health check)
 * - GET /ready (readiness check)
 */

const API = {
    rag: '/v1/rag',
    admin: '/v1/admin'
};

// State management
let state = {
    collections: [],
    selectedCollectionId: null,
    activeJobs: [],
    healthStatus: {}
};

// DOM Elements
const elements = {
    collectionsTableBody: document.getElementById('collectionsTableBody'),
    btnCreateCollection: document.getElementById('btnCreateCollection'),
    collectionModal: document.getElementById('collectionModal'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    btnCancelModal: document.getElementById('btnCancelModal'),
    collectionForm: document.getElementById('collectionForm'),
    modalTitle: document.getElementById('modalTitle'),
    btnRefresh: document.getElementById('btnRefresh'),
    jobsList: document.getElementById('jobsList'),
    healthStatus: document.getElementById('healthStatus'),
    playgroundSection: document.getElementById('playgroundSection'),
    playgroundCollectionName: document.getElementById('playgroundCollectionName'),
    btnClosePlayground: document.getElementById('btnClosePlayground'),
    playgroundQuestion: document.getElementById('playgroundQuestion'),
    playgroundResult: document.getElementById('playgroundResult'),
    btnRetrieve: document.getElementById('btnRetrieve'),
    btnQuery: document.getElementById('btnQuery'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    collectionDetailsPanel: document.getElementById('collectionDetailsPanel'),
    collectionDetailsContent: document.getElementById('collectionDetailsContent'),
    btnCloseDetails: document.getElementById('btnCloseDetails')
};

// Form Fields
const fields = {
    id: document.getElementById('fieldCollectionId'),
    displayName: document.getElementById('fieldDisplayName'),
    description: document.getElementById('fieldDescription'),
    sourcePath: document.getElementById('fieldSourcePath'),
    ozelgeDataPath: document.getElementById('fieldOzelgeDataPath'),
    distanceMetric: document.getElementById('fieldDistanceMetric'),
    chunkSize: document.getElementById('fieldChunkSize'),
    chunkOverlap: document.getElementById('fieldChunkOverlap'),
    retrievalK: document.getElementById('fieldRetrievalK'),
    retrievalDistanceThreshold: document.getElementById('fieldRetrievalDistanceThreshold'),
    embeddingModel: document.getElementById('fieldEmbeddingModel'),
    chatModel: document.getElementById('fieldChatModel')
};

// --- Utilities ---

async function request(url, options = {}) {
    console.log(`[API] ${options.method || 'GET'} ${url}`);

    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' }
    };

    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        console.log(`[API] Response: ${response.status} ${response.statusText}`);

        if (response.status === 204) {
            console.log('[API] No content');
            return null;
        }

        const data = await response.json();

        if (!response.ok) {
            console.error('[API] Error:', data);
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }

        console.log('[API] Success:', data);
        return data;
    } catch (error) {
        console.error(`[API] Fetch failed for ${url}:`, error);
        throw error;
    }
}

function showToast(message, type = 'info') {
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('translate-y-20', 'opacity-0');

    setTimeout(() => {
        elements.toast.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

function getStatusClass(status) {
    switch (status) {
        case 'ready':
            return 'bg-green-100 text-green-700';
        case 'indexing':
            return 'bg-blue-100 text-blue-700';
        case 'error':
            return 'bg-red-100 text-red-700';
        default:
            return 'bg-gray-100 text-gray-700';
    }
}

// --- Core Logic ---

async function loadCollections() {
    console.log('[UI] Loading collections...');

    try {
        const data = await request(`${API.rag}/collections`);
        console.log('[UI] Collections loaded:', data);

        state.collections = data.collections || [];
        console.log('[UI] State collections:', state.collections);

        renderCollections();
    } catch (err) {
        console.error('[UI] Failed to load collections:', err);
        showToast(`Failed to load collections: ${err.message}`, 'error');

        elements.collectionsTableBody.innerHTML = `
            <tr>
                <td colspan="3" class="px-6 py-8 text-center">
                    <p class="text-red-600 font-medium">Failed to load collections</p>
                    <p class="text-gray-500 text-sm mt-2">Check browser console (F12) for details</p>
                    <button onclick="loadCollections()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Retry</button>
                </td>
            </tr>
        `;
    }
}

function renderCollections() {
    console.log('[UI] Rendering collections:', state.collections);

    if (state.collections.length === 0) {
        elements.collectionsTableBody.innerHTML = `
            <tr>
                <td colspan="3" class="px-6 py-12 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p class="text-gray-600 font-medium">No collections found</p>
                    <p class="text-gray-500 text-sm mt-1">Create your first collection to get started</p>
                    <button onclick="elements.btnCreateCollection.click()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
                        + New Collection
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    elements.collectionsTableBody.innerHTML = state.collections.map(c => `
        <tr class="hover:bg-gray-50 transition-colors">
            <td class="px-6 py-4">
                <div class="font-medium text-gray-900">${c.displayName}</div>
                <div class="text-xs text-gray-500 font-mono">${c.id}</div>
            </td>

            <td class="px-6 py-4">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${getStatusClass(c.status)}">
                    ${c.status}
                </span>
            </td>

            <td class="px-6 py-4 text-right space-x-2">
                <button onclick="viewDetails('${c.id}')" class="text-blue-600 hover:text-blue-800 text-sm font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors">View</button>
                <button onclick="openEditModal('${c.id}')" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors">Edit</button>
                <button onclick="triggerReindex('${c.id}')" class="text-green-600 hover:text-green-800 text-sm font-medium px-2 py-1 rounded hover:bg-green-50 transition-colors">Reindex</button>
                <button onclick="openPlayground('${c.id}', '${c.displayName}')" class="text-purple-600 hover:text-purple-800 text-sm font-medium px-2 py-1 rounded hover:bg-purple-50 transition-colors">Test</button>
                <button onclick="deleteCollection('${c.id}')" class="text-red-600 hover:text-red-800 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
            </td>
        </tr>
    `).join('');
}

async function viewDetails(id) {
    try {
        const data = await request(`${API.rag}/collections/${id}`);
        const c = data.collection;

        // Also fetch readiness info for this collection
        let readyInfo = null;

        try {
            readyInfo = await request(`${API.rag}/collections/${id}/ready`);
        } catch (e) {
            // Ignore if readiness check fails
        }

        let detailsHtml = `
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <span class="text-gray-500">ID:</span>
                    <p class="font-mono text-sm">${c.id}</p>
                </div>

                <div>
                    <span class="text-gray-500">Status:</span>
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${getStatusClass(c.status)} ml-2">${c.status}</span>
                </div>

                <div class="col-span-2">
                    <span class="text-gray-500">Description:</span>
                    <p class="text-sm">${c.description || 'N/A'}</p>
                </div>

                <div>
                    <span class="text-gray-500">Chunk Count:</span>
                    <p class="text-sm">${c.chunkCount ?? 'N/A'}</p>
                </div>

                <div>
                    <span class="text-gray-500">Active Version:</span>
                    <p class="text-sm">${c.activeVersion ?? 'N/A'}</p>
                </div>

                <div class="col-span-2">
                    <span class="text-gray-500">Updated At:</span>
                    <p class="text-sm">${new Date(c.updatedAt).toLocaleString()}</p>
                </div>
            </div>
        `;

        // Add readiness information if available
        if (readyInfo) {
            detailsHtml += `
                <div class="mt-4 pt-4 border-t border-gray-200">
                    <h3 class="text-sm font-semibold text-gray-700 mb-2">Readiness & Health</h3>

                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Chroma:</span>
                            <span class="${readyInfo.chromaReadable ? 'text-green-600' : 'text-red-600'} ml-1 font-semibold">
                                ${readyInfo.chromaReadable ? 'Readable' : 'Not Readable'}
                            </span>
                        </div>

                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Chroma Count:</span>
                            <span class="ml-1">${readyInfo.chromaCount >= 0 ? readyInfo.chromaCount : 'N/A'}</span>
                        </div>

                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Embedding Model:</span>
                            <span class="${readyInfo.modelAvailability.embeddingModelAvailable ? 'text-green-600' : 'text-red-600'} ml-1 font-semibold">
                                ${readyInfo.modelAvailability.embeddingModelAvailable ? '✓ Available' : '✗ Missing'}
                            </span>
                        </div>

                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Chat Model:</span>
                            <span class="${readyInfo.modelAvailability.chatModelAvailable ? 'text-green-600' : 'text-red-600'} ml-1 font-semibold">
                                ${readyInfo.modelAvailability.chatModelAvailable ? '✓ Available' : '✗ Missing'}
                            </span>
                        </div>

                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Query Ready:</span>
                            <span class="${readyInfo.capabilities.query ? 'text-green-600' : 'text-red-600'} ml-1 font-semibold">
                                ${readyInfo.capabilities.query ? 'Yes' : 'No'}
                            </span>
                        </div>

                        <div class="p-2 bg-gray-50 rounded">
                            <span class="text-gray-500">Retrieve Ready:</span>
                            <span class="${readyInfo.capabilities.retrieve ? 'text-green-600' : 'text-red-600'} ml-1 font-semibold">
                                ${readyInfo.capabilities.retrieve ? 'Yes' : 'No'}
                            </span>
                        </div>
                    </div>

                    ${readyInfo.activeJob ? `
                        <div class="mt-2 p-2 bg-blue-50 rounded text-xs">
                            <span class="text-blue-700 font-semibold">Active Job:</span>
                            <span class="text-blue-600 ml-1">${readyInfo.activeJob.id} (${readyInfo.activeJob.status})</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        elements.collectionDetailsContent.innerHTML = detailsHtml;
        elements.collectionDetailsPanel.classList.remove('hidden');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function openEditModal(id) {
    const col = state.collections.find(c => c.id === id);
    if (!col) return;

    try {
        const data = await request(`${API.rag}/collections/${id}`);
        const c = data.collection;

        fields.id.value = c.id;
        fields.displayName.value = c.displayName;
        fields.description.value = c.description || '';
        fields.sourcePath.value = c.sourcePath || '';
        fields.ozelgeDataPath.value = c.ozelgeDataPath || '';
        fields.distanceMetric.value = c.distanceMetric || 'l2';
        fields.chunkSize.value = c.chunkSize || '';
        fields.chunkOverlap.value = c.chunkOverlap || '';
        fields.retrievalK.value = c.retrievalK || '';
        fields.retrievalDistanceThreshold.value = c.retrievalDistanceThreshold || '';
        fields.embeddingModel.value = c.embeddingModel || '';
        fields.chatModel.value = c.chatModel || '';

        elements.modalTitle.textContent = 'Edit Collection';
        elements.collectionModal.classList.remove('hidden');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function triggerReindex(id) {
    if (!confirm('Are you sure you want to reindex this collection?')) return;

    try {
        const data = await request(`${API.admin}/collections/${id}/reindex`, {
            method: 'POST'
        });

        showToast(`Reindexing started. Job ID: ${data.job.id}`);

        // Track the new job
        if (!state.activeJobs.includes(data.job.id)) {
            state.activeJobs.push(data.job.id);
        }

        loadJobs();
        loadCollections();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteCollection(id) {
    if (!confirm('Are you sure? This will permanently delete the collection and its data.')) return;

    try {
        await request(`${API.admin}/collections/${id}`, {
            method: 'DELETE'
        });

        showToast('Collection deleted successfully');

        // Remove from active jobs if present
        state.activeJobs = state.activeJobs.filter(jobId => !jobId.startsWith(id));

        loadCollections();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function openPlayground(id, name) {
    state.selectedCollectionId = id;
    elements.playgroundCollectionName.textContent = name;
    elements.playgroundSection.classList.remove('hidden');
    elements.playgroundResult.textContent = '';
    elements.playgroundQuestion.value = '';

    // Scroll to playground
    elements.playgroundSection.scrollIntoView({ behavior: 'smooth' });
}

async function runRetrieve() {
    const question = elements.playgroundQuestion.value.trim();
    if (!question) return showToast('Please enter a question');
    if (!state.selectedCollectionId) return showToast('Please select a collection first');

    try {
        elements.playgroundResult.textContent = 'Retrieving sources...';
        const data = await request(`${API.rag}/collections/${state.selectedCollectionId}/retrieve`, {
            method: 'POST',
            body: JSON.stringify({ question })
        });
        elements.playgroundResult.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        elements.playgroundResult.textContent = `Error: ${err.message}`;
    }
}

async function runQuery() {
    const question = elements.playgroundQuestion.value.trim();
    if (!question) return showToast('Please enter a question');
    if (!state.selectedCollectionId) return showToast('Please select a collection first');

    try {
        elements.playgroundResult.textContent = 'Generating answer...';
        const data = await request(`${API.rag}/collections/${state.selectedCollectionId}/query`, {
            method: 'POST',
            body: JSON.stringify({ question })
        });
        elements.playgroundResult.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        elements.playgroundResult.textContent = `Error: ${err.message}`;
    }
}

async function loadJobs() {
    if (state.activeJobs.length === 0) {
        elements.jobsList.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-4">No active jobs</p>';
        return;
    }

    const results = await Promise.all(state.activeJobs.map(async id => {
        try {
            return await request(`${API.admin}/jobs/${id}`);
        } catch {
            return null;
        }
    }));

    const validJobs = results.filter(j => j !== null);

    // Filter out completed jobs
    state.activeJobs = validJobs.map(j => j.job.id);

    renderJobs(validJobs);
}

function renderJobs(jobs) {
    if (jobs.length === 0) {
        elements.jobsList.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-4">No active jobs</p>';
        return;
    }

    elements.jobsList.innerHTML = jobs.map(j => `
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg flex justify-between items-center">
            <div>
                <div class="text-xs font-mono text-gray-400">${j.job.id}</div>
                <div class="text-sm font-medium ${j.job.status === 'running' ? 'text-blue-600' : 'text-gray-700'}">
                    ${j.job.status.toUpperCase()}
                </div>
            </div>

            <button onclick="cancelJob('${j.job.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold uppercase tracking-wider">Cancel</button>
        </div>
    `).join('');
}

async function cancelJob(id) {
    if (!confirm('Cancel this job?')) return;

    try {
        await request(`${API.admin}/jobs/${id}/cancel`, {
            method: 'POST'
        });

        showToast('Job cancelled');

        // Remove from active jobs
        state.activeJobs = state.activeJobs.filter(jobId => jobId !== id);

        loadJobs();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadHealth() {
    try {
        const [healthData, readyData] = await Promise.all([
            request('/health'),
            request('/ready')
        ]);

        state.healthStatus = {
            health: healthData,
            ready: readyData
        };

        renderHealth();
    } catch (err) {
        elements.healthStatus.innerHTML = `<p class="text-red-600 text-sm">Failed to load health: ${err.message}</p>`;
    }
}

function renderHealth() {
    const { health, ready } = state.healthStatus;

    if (!health && !ready) {
        elements.healthStatus.innerHTML = '<p class="text-gray-500 text-sm">No health data available</p>';
        return;
    }

    let html = '';

    // Health status
    if (health) {
        const healthColor = health.status === 'ok' ? 'text-green-600' : 'text-red-600';

        html += `
            <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span class="text-sm font-medium">Health</span>
                <span class="${healthColor} text-sm font-semibold">${health.status}</span>
            </div>
        `;
    }

    // Ready status
    if (ready) {
        const readyColor = ready.ready === true ? 'text-green-600' : 'text-red-600';

        html += `
            <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span class="text-sm font-medium">Ready</span>
                <span class="${readyColor} text-sm font-semibold">${ready.ready ? 'Yes' : 'No'}</span>
            </div>
        `;

        // Show blockers if any
        if (ready.blockers && ready.blockers.length > 0) {
            html += '<div class="mt-2 space-y-1">';

            ready.blockers.forEach(issue => {
                html += `<p class="text-xs text-red-600">• ${issue.message}</p>`;
            });

            html += '</div>';
        }

        // Show warnings if any
        if (ready.warnings && ready.warnings.length > 0) {
            html += '<div class="mt-2 space-y-1">';

            ready.warnings.forEach(issue => {
                html += `<p class="text-xs text-yellow-600">⚠ ${issue.message}</p>`;
            });

            html += '</div>';
        }

        // Show system ready info
        if (ready.systemReadyFor) {
            html += `<div class="mt-2 text-xs text-gray-600">System ready for: ${ready.systemReadyFor}</div>`;
        }
    }

    elements.healthStatus.innerHTML = html;
}

// --- Event Handlers ---

elements.btnCreateCollection.onclick = () => {
    fields.id.value = '';
    fields.displayName.value = '';
    fields.description.value = '';
    fields.sourcePath.value = '';
    fields.ozelgeDataPath.value = '';
    fields.distanceMetric.value = 'l2';
    fields.chunkSize.value = '';
    fields.chunkOverlap.value = '';
    fields.retrievalK.value = '';
    fields.retrievalDistanceThreshold.value = '';
    fields.embeddingModel.value = '';
    fields.chatModel.value = '';

    elements.modalTitle.textContent = 'Create Collection';
    elements.collectionModal.classList.remove('hidden');
};

elements.btnCloseModal.onclick = () => {
    elements.collectionModal.classList.add('hidden');
};

elements.btnCancelModal.onclick = () => {
    elements.collectionModal.classList.add('hidden');
};

elements.collectionForm.onsubmit = async e => {
    e.preventDefault();

    const id = fields.id.value;

    const payload = {
        displayName: fields.displayName.value,
        description: fields.description.value || null,
        sourcePath: fields.sourcePath.value || undefined,
        ozelgeDataPath: fields.ozelgeDataPath.value || undefined,
        distanceMetric: fields.distanceMetric.value,
        chunkSize: parseInt(fields.chunkSize.value) || undefined,
        chunkOverlap: parseInt(fields.chunkOverlap.value) || undefined,
        retrievalK: parseInt(fields.retrievalK.value) || undefined,
        retrievalDistanceThreshold: parseFloat(fields.retrievalDistanceThreshold.value) || undefined,
        embeddingModel: fields.embeddingModel.value || undefined,
        chatModel: fields.chatModel.value || undefined
    };

    try {
        if (id) {
            await request(`${API.admin}/collections/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });

            showToast('Collection updated');
        } else {
            const data = await request(`${API.admin}/collections`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            showToast(`Collection created: ${data.collection.id}`);
        }

        elements.collectionModal.classList.add('hidden');
        loadCollections();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

elements.btnRefresh.onclick = () => {
    loadCollections();
    loadHealth();
};

elements.btnClosePlayground.onclick = () => {
    elements.playgroundSection.classList.add('hidden');
};

elements.btnCloseDetails.onclick = () => {
    elements.collectionDetailsPanel.classList.add('hidden');
};

elements.btnRetrieve.onclick = runRetrieve;
elements.btnQuery.onclick = runQuery;

// Init
loadCollections();
loadHealth();

setInterval(loadJobs, 5000);
setInterval(loadHealth, 10000);
