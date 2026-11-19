import fs from "node:fs/promises";
import path from "node:path";
import {
  SUPPORTED_EXTENSIONS,
  listSourceFilePaths,
  sourceScanExcludes,
  sourceTypeForExtension,
} from "../ingestion/pipeline.js";

/**
 * Documents of a collection, managed through the files API.
 *
 * Only "uploads" collections are writable: their folder is `<uploadsDir>/<collection id>` and every path
 * is checked to stay inside it. "folder" collections are listed read-only.
 */

export type CollectionFile = {
  /** Path relative to the collection folder, with "/" separators (uploads collections: just the file name). */
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Whether the indexer reads this file type. */
  supported: boolean;
};

export type RejectedUpload = {
  name: string;
  code: "UNSUPPORTED_FILE" | "INVALID_FILE_NAME";
  reason: string;
};

export const MAX_FILES_PER_UPLOAD = 20;

/** Uploaded files are written under this hidden prefix first, then renamed; scans skip hidden files. */
export const UPLOAD_TEMP_PREFIX = ".upload-";

const FORBIDDEN_NAME_CHARACTERS = /[<>:"|?*\u0000-\u001f\u007f]/;
const MAX_NAME_BYTES = 255;

export function isInsideFolder(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveCollectionFolder(sourcePath: string, projectRoot: string): string {
  return path.resolve(projectRoot, sourcePath);
}

/** Folder of an uploads collection; throws if it is not inside the uploads root (never write elsewhere). */
export function resolveUploadsFolder(sourcePath: string, runtimeConfig: { projectRoot: string; uploadsDir: string }): string {
  const folder = resolveCollectionFolder(sourcePath, runtimeConfig.projectRoot);
  if (!isInsideFolder(runtimeConfig.uploadsDir, folder)) {
    throw new Error(`Collection folder ${folder} is outside the uploads folder ${runtimeConfig.uploadsDir}.`);
  }
  return folder;
}

/**
 * Accepts a plain file name with a supported extension. Rejects paths, hidden names (the indexer skips
 * them), characters that are invalid on common file systems and over-long names.
 */
export function checkUploadName(original: string):
  | { ok: true; name: string }
  | { ok: false; code: RejectedUpload["code"]; reason: string } {
  const name = original.normalize("NFC").trim();
  if (!name || name === "." || name === "..") {
    return { ok: false, code: "INVALID_FILE_NAME", reason: "The file name is empty." };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, code: "INVALID_FILE_NAME", reason: "Send a file name, not a path." };
  }
  if (name.startsWith(".")) {
    return { ok: false, code: "INVALID_FILE_NAME", reason: "Hidden files (names starting with a dot) are not indexed." };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return { ok: false, code: "INVALID_FILE_NAME", reason: "The file name contains characters that are not allowed: < > : \" | ? * or control characters." };
  }
  if (Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES) {
    return { ok: false, code: "INVALID_FILE_NAME", reason: `The file name is longer than ${MAX_NAME_BYTES} bytes.` };
  }
  if (!sourceTypeForExtension(path.extname(name).toLowerCase())) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE",
      reason: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`,
    };
  }
  return { ok: true, name };
}

/** Files of a collection folder, as the indexer would see them. A missing uploads folder has no files yet. */
export async function listCollectionFiles(
  folder: string,
  runtimeConfig: { registryPath: string; uploadsDir?: string },
): Promise<CollectionFile[]> {
  let filePaths: string[];
  try {
    filePaths = await listSourceFilePaths(folder, sourceScanExcludes(runtimeConfig));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: CollectionFile[] = [];
  for (const filePath of filePaths) {
    try {
      const stats = await fs.stat(filePath);
      const relative = path.relative(folder, filePath);
      files.push({
        name: (relative || path.basename(filePath)).split(path.sep).join("/"),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        supported: Boolean(sourceTypeForExtension(path.extname(filePath).toLowerCase())),
      });
    } catch {
      // Deleted between the scan and the stat; skip it.
    }
  }
  return files;
}

/**
 * Absolute path of an uploaded document, or null when there is no such file. The path is exactly what
 * the indexer stored in each chunk's metadata.sourcePath (folder + name).
 */
export async function findCollectionFile(folder: string, fileName: string): Promise<string | null> {
  const checked = checkUploadName(fileName);
  // Unsupported names cannot have been uploaded; invalid names could point outside the folder.
  if (!checked.ok) return null;
  const target = path.join(folder, checked.name);
  if (!isInsideFolder(folder, target)) return null;
  try {
    const stats = await fs.stat(target);
    return stats.isFile() ? target : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Moves an uploaded temp file to its final name, replacing an existing file with that name. */
export async function placeUploadedFile(folder: string, tempPath: string, name: string): Promise<void> {
  const target = path.join(folder, name);
  if (!isInsideFolder(folder, target) || !isInsideFolder(folder, tempPath)) {
    throw new Error(`Refusing to write outside the collection folder: ${name}`);
  }
  await fs.rename(tempPath, target);
}

/** Removes the folder of a deleted uploads collection; never touches anything outside the uploads root. */
export async function removeUploadsFolder(folder: string, uploadsDir: string): Promise<void> {
  if (!isInsideFolder(uploadsDir, folder)) return;
  await fs.rm(folder, { recursive: true, force: true });
}
