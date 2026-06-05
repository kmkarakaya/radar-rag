import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import type { CollectionRegistry } from "./collections/types.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import { createIndexJobRunner, type IndexJobRunner } from "./indexing/jobRunner.js";
import { cleanupRetiredPhysicalCollections } from "./indexing/cleanup.js";
import { config, type ResolvedConfig } from "./config.js";
import { createConsoleLogSink, type OperationalLogSink } from "./observability/logger.js";

type StartupLogger = Pick<Console, "log" | "error">;

export async function runStartupMaintenance(input: {
  registry: CollectionRegistry;
  runtimeConfig: ResolvedConfig;
  staleThresholdMs?: number;
  cleanupLimit?: number;
  log?: StartupLogger;
  logEvent?: OperationalLogSink;
  cleanupRetiredPhysicalCollectionsFn?: typeof cleanupRetiredPhysicalCollections;
}): Promise<void> {
  const staleThresholdMs = input.staleThresholdMs ?? 2 * 60 * 60 * 1000;
  const cleanupLimit = input.cleanupLimit ?? 10;
  const log = input.log ?? console;
  const cleanupFn = input.cleanupRetiredPhysicalCollectionsFn ?? cleanupRetiredPhysicalCollections;

  try {
    const count = await input.registry.failStaleJobs(staleThresholdMs);
    if (count > 0) {
      log.log(`Recovered ${count} stale index jobs on startup.`);
    }
  } catch (error) {
    log.error("Failed to recover stale jobs on startup:", error);
  }

  try {
    const count = await cleanupFn({
      registry: input.registry,
      runtimeConfig: input.runtimeConfig,
      limit: cleanupLimit,
      log: (message) => log.log(message),
      logEvent: input.logEvent,
    });
    if (count > 0) {
      log.log(`Cleaned up ${count} retired physical collections on startup.`);
    }
  } catch (error) {
    log.error("Failed to run startup cleanup:", error);
  }
}

export async function startServer(input: {
  runtimeConfig?: ResolvedConfig;
  registry?: CollectionRegistry;
  jobRunner?: IndexJobRunner;
  log?: StartupLogger;
  logEvent?: OperationalLogSink;
  startupMaintenance?: typeof runStartupMaintenance;
} = {}) {
  const runtimeConfig = input.runtimeConfig ?? config;
  const registry = input.registry ?? createSqliteCollectionRegistry({ dbPath: runtimeConfig.registryPath });
  const log = input.log ?? console;
  const logEvent = input.logEvent ?? createConsoleLogSink();
  const jobRunner = input.jobRunner ?? createIndexJobRunner({
    registry,
    runtimeConfig,
    log: (message) => log.log(message),
    logEvent,
  });
  const startupMaintenance = input.startupMaintenance ?? runStartupMaintenance;

  const app = createApp({ registry, jobRunner, runtimeConfig, logEvent });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const startedServer = app.listen(runtimeConfig.port, () => {
      log.log(`RAG backend listening on http://localhost:${runtimeConfig.port}`);
      resolve(startedServer);
    });
  });

  const startupMaintenancePromise = Promise.resolve()
    .then(() => startupMaintenance({ registry, runtimeConfig, log, logEvent }))
    .catch((error) => {
      log.error("Startup maintenance crashed unexpectedly:", error);
    });

  return { app, server, registry, jobRunner, startupMaintenancePromise };
}

async function main(): Promise<void> {
  await startServer();
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
