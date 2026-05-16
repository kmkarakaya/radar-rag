import fs from "node:fs/promises";

export type OzelgeRecord = {
  evrakOid?: string;
  sayi?: number | string;
  tarih?: string;
  konu?: string;
  pdfText?: string;
};

export async function loadOzelgeRecords(dataPath: string): Promise<OzelgeRecord[]> {
  const raw = await fs.readFile(dataPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${dataPath} to contain a JSON array`);
  }

  return parsed as OzelgeRecord[];
}