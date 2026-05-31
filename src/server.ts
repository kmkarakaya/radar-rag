import { createApp } from "./app.js";
import { createSqliteCollectionRegistry } from "./collections/sqliteRegistry.js";
import { config } from "./config.js";

const registry = createSqliteCollectionRegistry({ dbPath: config.registryPath });
const app = createApp({ registry });

app.listen(config.port, () => {
  console.log(`RAG backend listening on http://localhost:${config.port}`);
});
