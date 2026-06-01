import { createApp } from "./app.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import { createIndexJobRunner } from "./indexing/jobRunner.js";
import { cleanupRetiredPhysicalCollections } from "./indexing/cleanup.js";
import { config } from "./config.js";

const registry = createSqliteCollectionRegistry({ dbPath: config.registryPath });

// Recover stale jobs on startup (jobs older than 2 hours)
registry.failStaleJobs(2 * 60 * 60 * 1000).then((count) => {
  if (count > 0) {
    console.log(`Recovered ${count} stale index jobs on startup.`);
  }
}).catch((error) => {
  console.error("Failed to recover stale jobs on startup:", error);
});

// Run a one-time cleanup on startup
cleanupRetiredPhysicalCollections({ registry, runtimeConfig: config, limit: 10 }).then((count) => {
  if (count > 0) {
    console.log(`Cleaned up ${count} retired physical collections on startup.`);
  }
}).catch((error) => {
  console.error("Failed to run startup cleanup:", error);
});

const jobRunner = createIndexJobRunner({ registry, runtimeConfig: config });
const app = createApp({ registry, jobRunner });

app.listen(config.port, () => {
  console.log(`RAG backend listening on http://localhost:${config.port}`);
});
