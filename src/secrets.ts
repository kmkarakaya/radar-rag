import path from "node:path";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";

/**
 * Local secret files live under the gitignored `.local/` folder (onboarding writes them there).
 * Secrets are never stored in config/rag.config.yaml, which is tracked by git.
 */
export const defaultChatApiKeyFilePath = ".local/rag_chat_api_key.secret";
export const defaultEmbeddingApiKeyFilePath = ".local/rag_embedding_api_key.secret";

/** Reads a secret file relative to `cwd`. Returns "" if the file does not exist. */
export function readSecretFile(filePath: string, label: string, cwd = process.cwd()): string {
  const resolvedPath = path.resolve(cwd, filePath);

  try {
    return readFileSync(resolvedPath, "utf8").trim();
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
    if (code === "ENOENT") {
      return "";
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} file at ${resolvedPath}: ${message}`);
  }
}

/** Writes a secret file readable only by the current user (where the OS supports it). */
export async function writeSecretFile(filePath: string, value: string, cwd = process.cwd()): Promise<void> {
  const resolvedPath = path.resolve(cwd, filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${value}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function removeSecretFile(filePath: string, cwd = process.cwd()): Promise<void> {
  await fs.rm(path.resolve(cwd, filePath), { force: true });
}
