import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import type { CollectionRegistry } from "./collections/types.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import { createIndexJobRunner, type IndexJobRunner } from "./indexing/jobRunner.js";
import { cleanupRetiredPhysicalCollections } from "./indexing/cleanup.js";
import { config, type ResolvedConfig } from "./config.js";
import {
  createConsoleLogSink,
  createPersistentOperationalLogSink,
  type OperationalLogSink,
} from "./observability/logger.js";

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
  const rawLogEvent = input.logEvent ?? createConsoleLogSink();
  const logEvent = createPersistentOperationalLogSink(rawLogEvent, registry);
  const jobRunner = input.jobRunner ?? createIndexJobRunner({
    registry,
    runtimeConfig,
    log: (message) => log.log(message),
    logEvent,
  });
  const startupMaintenance = input.startupMaintenance ?? runStartupMaintenance;

  const app = createApp({ registry, jobRunner, runtimeConfig, logEvent: rawLogEvent });
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
  const { server, jobRunner, registry } = await startServer();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error("Shutdown timed out after 10s, forcing exit.");
      process.exit(1);
    }, 10000);

    try {
      // 1. Close HTTP server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log("HTTP server closed.");

      // 2. Shutdown job runner
      await jobRunner.shutdown();
      console.log("Job runner shut down.");

      // 3. Close registry
      if (registry) {
        registry.close?.();
        console.log("Registry closed.");
      }

      console.log("Shutdown complete.");
      process.exit(0);
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
