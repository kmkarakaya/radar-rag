import { readFileSync } from "node:fs";

/**
 * The running RAGStation version, read once from package.json (one folder above src/ and dist/,
 * also in the Docker image). Returned by GET /health, GET / and GET /v1/admin/server-info.
 */
function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.trim() !== "" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

export const appVersion = readVersion();
