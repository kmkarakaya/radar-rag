import { apiRequest, normalizeError } from "./api.js";
import { showToast } from "./dom.js";
import { API, state } from "./state.js";

/**
 * Follows index jobs started or seen in this session (GET /v1/admin/jobs/:id) and tells the user when
 * one finishes, wherever they are in the panel. Progress (job.progress) is computed by the server.
 */

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const finishedListeners = [];

/** Called with the finished job, so views can refresh what they show. */
export function onWatchedJobFinished(listener) {
    finishedListeners.push(listener);
}

export function watchJob(job, collectionName) {
    if (!job?.id || TERMINAL.has(job.status) || state.watchedJobs.has(job.id)) return;
    state.watchedJobs.set(job.id, { collectionId: job.collectionId, collectionName: collectionName || job.collectionId });
}

export async function pollWatchedJobs() {
    for (const [jobId, watched] of [...state.watchedJobs]) {
        try {
            const job = (await apiRequest(`${API.admin}/jobs/${encodeURIComponent(jobId)}`))?.job;
            if (!job || !TERMINAL.has(job.status)) continue;
            state.watchedJobs.delete(jobId);
            notifyFinished(job, watched);
            finishedListeners.forEach((listener) => listener(job));
        } catch (error) {
            if (normalizeError(error).status === 404) state.watchedJobs.delete(jobId);
        }
    }
}

function notifyFinished(job, watched) {
    const actions = [
        { label: "Open collection", onClick: () => { location.hash = `#/collections/${encodeURIComponent(watched.collectionId)}/readiness`; } },
        { label: "View job", onClick: () => { location.hash = jobRoute(job.id); } },
    ];
    if (job.status === "succeeded") {
        const counts = formatJobCounts(job);
        showToast(`Indexing finished: ${watched.collectionName}${counts ? ` (${counts})` : ""}. It is searchable now.`, "success", { actions, durationMs: 8000 });
    } else if (job.status === "failed") {
        showToast(`Indexing failed: ${watched.collectionName}. ${job.error || ""}`.trim(), "error", { actions, durationMs: 12000 });
    } else {
        showToast(`Indexing cancelled: ${watched.collectionName}.`, "info", { actions });
    }
}

/** "2 files, 91 chunks" from the counts the server gives (a job, a job's progress); unknown counts are left out. */
export function formatJobCounts(counts) {
    const files = counts?.indexedFileCount;
    const chunks = counts?.chunkCount;
    return [
        Number.isFinite(files) ? `${files} file${files === 1 ? "" : "s"}` : null,
        Number.isFinite(chunks) ? `${chunks} chunk${chunks === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(", ");
}

/** The address of a job's detail in the jobs view. */
export function jobRoute(jobId) {
    return `#/jobs/${encodeURIComponent(jobId)}`;
}
