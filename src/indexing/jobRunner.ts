import type { CollectionRegistry } from "../collections/types.js";
import type { ResolvedConfig } from "../config.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";
import { runIndexJob } from "./jobs.js";

export interface IndexJobRunner {
  start(jobId: string): void;
  drain(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createIndexJobRunner(deps: {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  log?: (message: string) => void;
  logEvent?: OperationalLogSink;
}): IndexJobRunner {
  const { registry, runtimeConfig } = deps;
  const log = deps.log ?? console.log;
  const logEvent = deps.logEvent;

  const runningPromises = new Map<string, Promise<void>>();
  let isShuttingDown = false;

  async function execute(jobId: string) {
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
      await runIndexJob({ registry, jobId, runtimeConfig, log, logEvent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Background job ${jobId} failed with unhandled error: ${error}`);
      emitOperationalLog(logEvent, {
        jobId,
        operation: "index_job",
        status: "failed",
        errorCode: "INDEX_JOB_UNHANDLED_ERROR",
        message,
      });
    } finally {
      runningPromises.delete(jobId);
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
      
      const promise = execute(jobId);
      runningPromises.set(jobId, promise);
    },
    async drain() {
      const promises = Array.from(runningPromises.values());
      await Promise.allSettled(promises);
    },
    async shutdown() {
      isShuttingDown = true;
      await this.drain();
    }
  };
}
