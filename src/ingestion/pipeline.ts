import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { normalizeText } from "./transformers/normalizeText.js";
import { emitOperationalLog, type OperationalLogSink } from "../observability/logger.js";

export type UnsupportedSourceFile = {
  path: string;
  extension: string;
  reason: string;
};

export type SourceFileSummary = {
  path: string;
  extension: string;
  sourceType: string;
  loadedDocumentCount: number;
};

export type IndexingSourceAnalysis = {
  sourcePath: string;
  sourceFiles: SourceFileSummary[];
  fileCount: number;
  loadedDocumentCount: number;
  documents: Document[];
  unsupportedFiles: UnsupportedSourceFile[];
};

export type AnalyzeIndexingSourceOptions = {
  sourcePath: string;
  logEvent?: OperationalLogSink;
  /** Files to skip entirely (not counted, not reported as unsupported), e.g. the SQLite registry. */
  excludePaths?: string[];
};

/** The SQLite registry file and its sidecar files; they can live inside a source folder (default `data/`). */
export function registryExcludePaths(registryPath: string): string[] {
  return ["", "-wal", "-shm", "-journal"].map((suffix) => `${registryPath}${suffix}`);
}

function normalizeComparablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function analyzeIndexingSource(
  options: AnalyzeIndexingSourceOptions,
): Promise<IndexingSourceAnalysis> {
  const sourcePath = path.resolve(options.sourcePath);
  const excluded = new Set((options.excludePaths ?? []).map(normalizeComparablePath));
  const sourceFilePaths = (await collectSourceFiles(sourcePath))
    .filter((filePath) => !excluded.has(normalizeComparablePath(filePath)));
  const sourceFiles: SourceFileSummary[] = [];
  const unsupportedFiles: UnsupportedSourceFile[] = [];
  const loadedDocuments: Document[] = [];

  for (const filePath of sourceFilePaths) {
    const extension = path.extname(filePath).toLowerCase();

    const sourceType = sourceTypeForExtension(extension);
    if (!sourceType) {
      unsupportedFiles.push({
        path: filePath,
        extension: extension || "(none)",
        reason: "Unsupported file extension.",
      });
      continue;
    }

    try {
      const documents = await loadFileDocuments(filePath, extension, sourceType);
      loadedDocuments.push(...documents);
      sourceFiles.push({
        path: filePath,
        extension,
        sourceType,
        loadedDocumentCount: documents.length,
      });
    } catch (error: any) {
      emitOperationalLog(options.logEvent, {
        operation: "load_file",
        status: "failed",
        message: `Failed to load file: ${filePath}`,
        details: {
          path: filePath,
          extension,
          error: error.message,
        },
      });
      unsupportedFiles.push({
        path: filePath,
        extension: extension || "(none)",
        reason: `Failed to load: ${error.message}`,
      });
    }
  }

  return {
    sourcePath,
    sourceFiles,
    fileCount: sourceFilePaths.length,
    loadedDocumentCount: loadedDocuments.length,
    documents: loadedDocuments,
    unsupportedFiles,
  };
}

export async function loadSourceDocuments(
  options: AnalyzeIndexingSourceOptions,
): Promise<Document[]> {
  const analysis = await analyzeIndexingSource(options);
  return analysis.documents;
}

async function collectSourceFiles(sourcePath: string): Promise<string[]> {
  const stats = await fs.stat(sourcePath);

  if (stats.isFile()) {
    return [sourcePath];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Indexing source path is neither a file nor a directory: ${sourcePath}`);
  }

  return walkDirectory(sourcePath);
}

async function walkDirectory(dir: string): Promise<string[]> {
  let files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(await walkDirectory(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function sourceTypeForExtension(extension: string): string | null {
  switch (extension) {
    case ".txt":
      return "text";
    case ".md":
      return "markdown";
    case ".pdf":
      return "pdf";
    case ".doc":
      return "doc";
    case ".docx":
      return "docx";
    default:
      return null;
  }
}

async function loadFileDocuments(
  filePath: string,
  extension: string,
  sourceType: string,
): Promise<Document[]> {
  const content = await fs.readFile(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  const loader = createLoader(filePath, extension);
  const rawDocuments = await loader.load();

  return rawDocuments
    .map((document, loaderDocumentIndex) => normalizeLoadedDocument(
      document,
      filePath,
      sourceType,
      loaderDocumentIndex,
      hash,
    ))
    .filter((document): document is Document => document !== null);
}

function createLoader(filePath: string, extension: string) {
  switch (extension) {
    case ".txt":
    case ".md":
      return new TextLoader(filePath);
    case ".pdf":
      return new PDFLoader(filePath);
    case ".doc":
      return new DocxLoader(filePath, { type: "doc" });
    case ".docx":
      return new DocxLoader(filePath, { type: "docx" });
    default:
      throw new Error(`Unsupported file extension: ${extension}`);
  }
}

function normalizeLoadedDocument(
  document: Document,
  sourcePath: string,
  sourceType: string,
  loaderDocumentIndex: number,
  sourceHash: string,
): Document | null {
  const pageContent = normalizeText(document.pageContent);
  if (pageContent.length === 0) {
    return null;
  }
  const metadata = sanitizeMetadata(document.metadata);
  const pageNumber = extractPageNumber(document.metadata);

  return new Document({
    pageContent,
    metadata: {
      ...metadata,
      ...(pageNumber === undefined ? {} : { pageNumber }),
      documentId: `file:${hashPath(sourcePath)}:${loaderDocumentIndex}`,
      sourcePath,
      sourceType,
      sourceHash,
    },
  });
}

function hashPath(sourcePath: string): string {
  return createHash("sha1")
    .update(path.resolve(sourcePath).toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

function sanitizeMetadata(metadata: Document["metadata"]): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => (
        value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
      )),
  ) as Record<string, string | number | boolean | null>;
}

function extractPageNumber(metadata: Document["metadata"]): number | undefined {
  const loc = metadata.loc;
  if (typeof loc !== "object" || loc === null || Array.isArray(loc)) {
    return undefined;
  }

  const pageNumber = (loc as { pageNumber?: unknown }).pageNumber;
  return typeof pageNumber === "number" ? pageNumber : undefined;
}
