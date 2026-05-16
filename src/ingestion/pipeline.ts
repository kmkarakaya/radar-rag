import { Document } from "@langchain/core/documents";
import { loadOzelgeRecords, type OzelgeRecord } from "./loaders/ozelgeJsonLoader.js";
import { normalizeText } from "./transformers/normalizeText.js";

export type IndexingSourceAnalysis = {
  records: OzelgeRecord[];
  sampledRecords: OzelgeRecord[];
  documents: Document[];
  sampleLimited: boolean;
};

export function toDocuments(records: OzelgeRecord[]): Document[] {
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
          ozelgeId: record.evrakOid ?? `record-${index}`,
          sayi: record.sayi ?? "",
          tarih: record.tarih ?? "",
          konu: record.konu ?? "",
        },
      });
    });

  return documents.filter((document): document is NonNullable<typeof document> => document !== null);
}

export async function analyzeOzelgeIndexingSource(
  dataPath: string,
  indexSampleSize: number,
): Promise<IndexingSourceAnalysis> {
  const records = await loadOzelgeRecords(dataPath);
  const sampledRecords = records.slice(0, indexSampleSize);
  const documents = toDocuments(sampledRecords);

  return {
    records,
    sampledRecords,
    documents,
    sampleLimited: sampledRecords.length < records.length,
  };
}

export async function loadSourceDocuments(
  dataPath: string,
  indexSampleSize: number,
): Promise<Document[]> {
  const analysis = await analyzeOzelgeIndexingSource(dataPath, indexSampleSize);
  return analysis.documents;
}