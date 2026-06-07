import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { loadOzelgeRecords, type OzelgeRecord } from "./loaders/ozelgeJsonLoader.js";
import { normalizeText } from "./transformers/normalizeText.js";

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
  indexSampleSize: number;
  sampleLimited: boolean;
  records?: OzelgeRecord[];
  sampledRecords?: OzelgeRecord[];
  recordCount?: number;
  sampledRecordCount?: number;
};

export type AnalyzeIndexingSourceOptions = {
  sourcePath: string;
  ozelgeDataPath: string;
  indexSampleSize: number;
};

export function toDocuments(records: OzelgeRecord[], sourceHash: string): Document[] {
  const documents = records
    .map((record, index) => {
      const pageContent = typeof record.pdfText === "string"
        ? normalizeText(record.pdfText)
        : "";

      if (pageContent.length === 0) {
        return null;
      }

      return new Document({
        pageContent,
        metadata: {
          documentId: `ozelge:${record.evrakOid ?? `record-${index}`}`,
          sourcePath: "",
          sourceType: "ozelge-json",
          ozelgeId: record.evrakOid ?? `record-${index}`,
          sayi: record.sayi ?? "",
          tarih: record.tarih ?? "",
          konu: record.konu ?? "",
          sourceHash,
        },
      });
    });

  return documents.filter((document): document is NonNullable<typeof document> => document !== null);
}

export async function analyzeOzelgeIndexingSource(
  dataPath: string,
  indexSampleSize: number,
): Promise<IndexingSourceAnalysis> {
  const rawContent = await fs.readFile(dataPath);
  const hash = createHash("sha256").update(rawContent).digest("hex");
  const records = await loadOzelgeRecords(dataPath);
  const sampledRecords = sampleRecords(records, indexSampleSize);
  const documents = toDocuments(sampledRecords, hash).map((document) => withSourcePath(document, dataPath));

  return {
    sourcePath: dataPath,
    sourceFiles: [{
      path: dataPath,
      extension: ".json",
      sourceType: "ozelge-json",
      loadedDocumentCount: documents.length,
    }],
    fileCount: 1,
    loadedDocumentCount: documents.length,
    documents,
    unsupportedFiles: [],
    indexSampleSize,
    sampleLimited: sampledRecords.length < records.length,
    records,
    sampledRecords,
    recordCount: records.length,
    sampledRecordCount: sampledRecords.length,
  };
}

function sampleRecords(records: OzelgeRecord[], indexSampleSize: number): OzelgeRecord[] {
  return indexSampleSize === 0 ? records : records.slice(0, indexSampleSize);
}

export async function analyzeIndexingSource(
  options: AnalyzeIndexingSourceOptions,
): Promise<IndexingSourceAnalysis> {
  const sourcePath = path.resolve(options.sourcePath);
  const ozelgeDataPath = path.resolve(options.ozelgeDataPath);
  const sourceFilePaths = await collectSourceFiles(sourcePath);
  const sourceFiles: SourceFileSummary[] = [];
  const unsupportedFiles: UnsupportedSourceFile[] = [];
  const loadedDocuments: Document[] = [];
  let recordCount: number | undefined;
  let sampledRecordCount: number | undefined;
  let sourceSampleLimited = false;

  for (const filePath of sourceFilePaths) {
    const extension = path.extname(filePath).toLowerCase();

    if (path.resolve(filePath) === ozelgeDataPath) {
      const analysis = await analyzeOzelgeIndexingSource(filePath, options.indexSampleSize);
      loadedDocuments.push(...analysis.documents);
      sourceFiles.push(...analysis.sourceFiles);
      recordCount = analysis.recordCount;
      sampledRecordCount = analysis.sampledRecordCount;
      sourceSampleLimited = sourceSampleLimited || analysis.sampleLimited;
      continue;
    }

    const sourceType = sourceTypeForExtension(extension);
    if (!sourceType) {
      unsupportedFiles.push({
        path: filePath,
        extension: extension || "(none)",
        reason: extension === ".json"
          ? "Only the configured ozelge JSON file is supported in this version."
          : "Unsupported file extension.",
      });
      continue;
    }

    const documents = await loadFileDocuments(filePath, extension, sourceType);
    loadedDocuments.push(...documents);
    sourceFiles.push({
      path: filePath,
      extension,
      sourceType,
      loadedDocumentCount: documents.length,
    });
  }

  return {
    sourcePath,
    sourceFiles,
    fileCount: sourceFilePaths.length,
    loadedDocumentCount: loadedDocuments.length,
    documents: loadedDocuments,
    unsupportedFiles,
    indexSampleSize: options.indexSampleSize,
    sampleLimited: sourceSampleLimited,
    recordCount,
    sampledRecordCount,
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

function withSourcePath(document: Document, sourcePath: string): Document {
  return new Document({
    pageContent: document.pageContent,
    metadata: {
      ...document.metadata,
      sourcePath,
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
