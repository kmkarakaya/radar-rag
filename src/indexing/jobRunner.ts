import type { CollectionRegistry } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
import { JobInterruptedError, runIndexJob } from "./jobs.js";
import { isTimeoutOrAbortError } from "../observability/timeout.js";

export interface IndexJobRunner {
  start(jobId: string): void;
  abort(jobId: string): Promise<void>;
  drain(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createIndexJobRunner(deps: {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
  /** How long shutdown waits for aborted jobs to stop (default 2 s; Docker kills the process after 10 s). */
  shutdownGraceMs?: number;
  /** Passed to runIndexJob (tests replace the physical build). */
  jobDeps?: Parameters<typeof runIndexJob>[0]["deps"];
}): IndexJobRunner {
  const { registry, runtimeConfig } = deps;
  const log = deps.log ?? console.log;
  const logEvent = deps.logEvent;
  const shutdownGraceMs = deps.shutdownGraceMs ?? 2000;

  const runningPromises = new Map<string, Promise<void>>();
  const abortControllers = new Map<string, AbortController>();
  let isShuttingDown = false;

  async function execute(jobId: string, signal: AbortSignal) {
    if (isShuttingDown) {
      log(`Job runner is shutting down, skipping job ${jobId}`);
      emitOperationalLog(logEvent, {
        jobId,
        operation: "index_job",
        status: "skipped",
        errorCode: "JOB_RUNNER_SHUTTING_DOWN",
        message: `Job runner is shutting down, skipping job ${jobId}`,
      });
      return;
    }

    try {
      await runIndexJob({ registry, jobId, runtimeConfig, signal, log, logEvent, deps: deps.jobDeps });
    } catch (error) {
      if (!isTimeoutOrAbortError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Background job ${jobId} failed with unhandled error: ${error}`);
        emitOperationalLog(logEvent, {
          jobId,
          operation: "index_job",
          status: "failed",
          errorCode: "INDEX_JOB_UNHANDLED_ERROR",
          message,
        });
      }
    } finally {
      runningPromises.delete(jobId);
      abortControllers.delete(jobId);
    }
  }

  return {
    start(jobId: string) {
      if (isShuttingDown) {
        throw new Error("Job runner is shutting down.");
      }
      if (runningPromises.has(jobId)) {
        return;
      }
      
      const controller = new AbortController();
      abortControllers.set(jobId, controller);
      const promise = execute(jobId, controller.signal);
      runningPromises.set(jobId, promise);
    },
    async abort(jobId: string) {
      const controller = abortControllers.get(jobId);
      if (controller) {
        controller.abort();
      }
      await registry.cancelIndexJob(jobId);
    },
    async drain() {
      const promises = Array.from(runningPromises.values());
      await Promise.allSettled(promises);
    },
    async shutdown() {
      isShuttingDown = true;
      // Fail the running jobs first, then stop them. The process may be killed at any moment from here on
      // (Docker after 10 s), and some steps do not stop on abort (a model download) or keep the event loop
      // busy (built-in embedding batches); marking first means no job is left "running" either way.
      const interrupted = new JobInterruptedError();
      for (const jobId of runningPromises.keys()) {
        try {
          const job = await registry.getJob(jobId);
          if (job && (job.status === "queued" || job.status === "running")) {
            await registry.failIndexJob(jobId, interrupted.message);
            log(`Job ${jobId} interrupted: the server is stopping.`);
          }
        } catch (error) {
          log(`Could not mark job ${jobId} as interrupted: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const controller of abortControllers.values()) {
        controller.abort(interrupted);
      }
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, shutdownGraceMs); }),
      ]);
      clearTimeout(timer);
    }
  };
}
