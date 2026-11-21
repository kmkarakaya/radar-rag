import type { IndexJob, IndexJobEvent } from "../collections/types.js";

/**
 * Progress of a queued or running index job, summarized from its events so API clients can show it
 * as is (GET /v1/admin/jobs/:jobId, GET /v1/admin/jobs). Finished jobs have none.
 */
export type IndexJobProgressSummary = {
  /** Current build step (1-based); null before the first step is reported. */
  step: number | null;
  stepCount: number | null;
  /** 0-100; null when not known yet. */
  percent: number | null;
  /** The last step the job reported; null before the first event. */
  message: string | null;
  /** Files with indexable content found so far; null until the source has been read. */
  indexedFileCount: number | null;
  /** Chunks produced so far; null until chunking has finished. */
  chunkCount: number | null;
};

const ACTIVE_JOB_STATUSES = new Set<IndexJob["status"]>(["queued", "running"]);

export function isActiveJob(job: Pick<IndexJob, "status">): boolean {
  return ACTIVE_JOB_STATUSES.has(job.status);
}

/** Summarizes a job's events (in sequence order) into its current progress. */
export function summarizeJobProgress(events: readonly IndexJobEvent[]): IndexJobProgressSummary {
  const latestFirst = [...events].reverse();
  const last = latestFirst[0];
  const withProgress = latestFirst.find((event) => event.progress?.phase && event.progress?.phaseCount);

  let step: number | null = null;
  let stepCount: number | null = null;
  let percent: number | null = null;
  if (withProgress?.progress) {
    const { phase, phaseCount, itemsCompleted, itemsTotal } = withProgress.progress;
    step = phase;
    stepCount = phaseCount;
    // Within a step, items done (when the step reports a total) move the bar between step boundaries.
    const within = itemsTotal && itemsTotal > 0 ? Math.min(1, (itemsCompleted ?? 0) / itemsTotal) : 0;
    const fraction = Math.max(0, Math.min(1, (phase - 1 + within) / phaseCount));
    percent = Math.round(fraction * 100);
  }

  const latestCount = (key: string): number | null => {
    for (const event of latestFirst) {
      const value = event.details?.[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  };

  return {
    step,
    stepCount,
    percent,
    message: last?.message ?? null,
    indexedFileCount: latestCount("indexedFileCount"),
    chunkCount: latestCount("chunkCount"),
  };
}
