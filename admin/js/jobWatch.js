import { apiRequest, normalizeError } from "./api.js";
import { showToast } from "./dom.js";
import { API, state } from "./state.js";

/**
 * Follows index jobs started or seen in this session (GET /v1/admin/jobs/:id) and tells the user when
 * one finishes, wherever they are in the panel. Progress comes from the job's events.
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
    const open = { label: "Open", onClick: () => { location.hash = `#/collections/${encodeURIComponent(watched.collectionId)}/readiness`; } };
    if (job.status === "succeeded") {
        const chunks = Number.isFinite(job.chunkCount) ? ` (${job.chunkCount} chunk${job.chunkCount === 1 ? "" : "s"})` : "";
        showToast(`Indexing finished: ${watched.collectionName}${chunks}. It is searchable now.`, "success", { action: open, durationMs: 8000 });
    } else if (job.status === "failed") {
        showToast(`Indexing failed: ${watched.collectionName}. ${job.error || ""}`.trim(), "error", { action: open, durationMs: 12000 });
    } else {
        showToast(`Indexing cancelled: ${watched.collectionName}.`, "info", { action: open });
    }
}

/** The latest progress of a running job: its last event's message and how far it is (0..1), if known. */
export async function loadJobProgress(jobId) {
    try {
        const events = (await apiRequest(`${API.admin}/jobs/${encodeURIComponent(jobId)}/events`))?.events;
        if (!Array.isArray(events) || events.length === 0) return null;
        const last = events[events.length - 1];
        const withProgress = [...events].reverse().find((event) => event.progress?.phase && event.progress?.phaseCount);
        let fraction = null;
        if (withProgress) {
            const { phase, phaseCount, itemsCompleted, itemsTotal } = withProgress.progress;
            const within = itemsTotal > 0 ? Math.min(1, itemsCompleted / itemsTotal) : 0;
            fraction = Math.max(0, Math.min(1, (phase - 1 + within) / phaseCount));
        }
        return { message: last.message, fraction, phase: withProgress?.progress?.phase ?? null, phaseCount: withProgress?.progress?.phaseCount ?? null };
    } catch {
        return null;
    }
}
