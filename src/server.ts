import { createApp } from "./app.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
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

const app = createApp({ registry });

app.listen(config.port, () => {
  console.log(`RAG backend listening on http://localhost:${config.port}`);
});
