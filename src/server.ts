import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import type { CollectionRegistry } from "./collections/types.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import { createIndexJobRunner, type IndexJobRunner } from "./indexing/jobRunner.js";
import { cleanupRetiredPhysicalCollections } from "./indexing/cleanup.js";
import { STALE_JOB_THRESHOLD_MS } from "./indexing/jobs.js";
import { config, type ResolvedConfig } from "./config.js";
import { ensureSampleCollection } from "./samples/sampleCollection.js";
import { closeBuiltinModels } from "./embeddings/index.js";
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
  // Running jobs send a heartbeat; one without it for this long was interrupted (stop or crash).
  const staleThresholdMs = input.staleThresholdMs ?? STALE_JOB_THRESHOLD_MS;
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

/**
 * Clickable entry points printed at startup, so `npm run dev` shows where to go next.
 * `/admin` redirects to the login page by itself when admin auth is enabled.
 */
export function formatStartupLinks(runtimeConfig: Pick<ResolvedConfig, "port">): string {
  const baseUrl = `http://localhost:${runtimeConfig.port}`;
  return [
    "Open:",
    `  Admin panel:   ${baseUrl}/admin`,
    `  Readiness:     ${baseUrl}/ready`,
    `  Test frontend: ${baseUrl}/test-frontend/`,
  ].join("\n");
}

/** Startup lines: the embedding default for new collections and whether /query is available. */
export function formatChatStatus(runtimeConfig: Pick<ResolvedConfig, "chat" | "embedding">): string {
  const embedding = runtimeConfig.embedding;
  const embeddingLine = embedding.provider === "builtin"
    ? `  Embedding:     builtin / ${embedding.model} (default for new collections; downloaded on first use)`
    : `  Embedding:     openai-compatible / ${embedding.model} @ ${embedding.baseUrl} (default for new collections)`;
  const chat = runtimeConfig.chat;
  const chatLine = chat.enabled
    ? `  Chat LLM:      ${chat.model} @ ${chat.baseUrl} (server default for /query; tenants can choose another under Chat services)`
    : "  Chat LLM:      none on the server (retrieve-only until a chat LLM is chosen under Chat services in the admin panel, "
      + "PUT /v1/admin/chat-settings, or set with npm run onboard / RAG_CHAT_BASE_URL + RAG_CHAT_MODEL).";
  return ["Models:", embeddingLine, chatLine].join("\n");
}

export async function startServer(input: {
  runtimeConfig?: ResolvedConfig;
  registry?: CollectionRegistry;
  jobRunner?: IndexJobRunner;
  log?: StartupLogger;
  logEvent?: OperationalLogSink;
  startupMaintenance?: typeof runStartupMaintenance;
  /** First-run sample collection; injectable so tests can turn it off. */
  startupSampleCollection?: (input: Parameters<typeof ensureSampleCollection>[0]) => Promise<unknown>;
  /** How often interrupted jobs are looked for while running (default 60 s; 0 turns it off, as in tests). */
  staleJobCheckIntervalMs?: number;
} = {}) {
  const runtimeConfig = input.runtimeConfig ?? config;
  const registry = input.registry ?? createSqliteCollectionRegistry({ dbPath: runtimeConfig.registryPath, projectRoot: runtimeConfig.projectRoot });
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
  const startupSampleCollection = input.startupSampleCollection ?? ensureSampleCollection;

  const app = createApp({ registry, jobRunner, runtimeConfig, logEvent: rawLogEvent });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const startedServer = app.listen(runtimeConfig.port, () => {
      log.log(`RAGStation listening on http://localhost:${runtimeConfig.port}`);
      log.log(formatStartupLinks(runtimeConfig));
      log.log(formatChatStatus(runtimeConfig));
      if (!existsSync(runtimeConfig.configPath)) {
        log.log(`No config file at ${runtimeConfig.configPath}; using the defaults (and any RAG_* environment variables).`);
      }
      resolve(startedServer);
    });
  });

  // Maintenance first (fails stale jobs), then the first-run sample collection. Neither blocks serving.
  const startupMaintenancePromise = Promise.resolve()
    .then(() => startupMaintenance({ registry, runtimeConfig, log, logEvent }))
    .catch((error) => {
      log.error("Startup maintenance crashed unexpectedly:", error);
    })
    .then(() => startupSampleCollection({ registry, jobRunner, runtimeConfig, log, logEvent }))
    .catch((error) => {
      log.error("Creating the sample collection failed:", error);
    });

  // Jobs interrupted while this server runs (for example a CLI indexing process that crashed) are failed
  // within minutes, not only at the next start.
  const staleJobCheckIntervalMs = input.staleJobCheckIntervalMs ?? 60_000;
  const staleJobTimer = staleJobCheckIntervalMs > 0
    ? setInterval(() => {
      registry.failStaleJobs(STALE_JOB_THRESHOLD_MS)
        .then((count) => {
          if (count > 0) log.log(`Failed ${count} interrupted index job(s) (no heartbeat).`);
        })
        .catch((error) => log.error("Checking for interrupted index jobs failed:", error));
    }, staleJobCheckIntervalMs)
    : undefined;
  staleJobTimer?.unref?.();
  const stopBackgroundChecks = () => clearInterval(staleJobTimer);

  return { app, server, registry, jobRunner, startupMaintenancePromise, stopBackgroundChecks };
}

async function main(): Promise<void> {
  const { server, jobRunner, registry, stopBackgroundChecks } = await startServer();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error("Shutdown timed out after 10s, forcing exit.");
      process.exit(1);
    }, 10000);

    try {
      stopBackgroundChecks();
      // 1. Stop the index jobs first: running ones are marked interrupted at once, so none stays "running"
      //    even if the process is killed before shutdown completes.
      const jobsStopped = jobRunner.shutdown();

      // 2. Close HTTP server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log("HTTP server closed.");

      await jobsStopped;
      console.log("Job runner shut down.");

      // The built-in embedding model runs in a worker thread: stop it once no job uses it.
      await closeBuiltinModels();

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
