import path from "node:path";

/**
 * Turns a path into the form we persist (config files, registry rows).
 *
 * Paths inside `projectRoot` become relative with forward slashes (e.g. `data/dataset1`),
 * so the repo keeps working after it is moved, cloned elsewhere, or run in a container.
 * Paths outside the project are returned unchanged, because there is no portable form for them.
 *
 * Relative paths are resolved against `projectRoot` at use time (the server runs from the repo root).
 */
export function toPortablePath(input: string, projectRoot: string = process.cwd()): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return trimmed;

  const resolved = path.resolve(projectRoot, trimmed);
  const relative = path.relative(projectRoot, resolved);

  if (relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return trimmed;
  }

  return relative.split(path.sep).join("/");
}
