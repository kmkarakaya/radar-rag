import { randomBytes } from "node:crypto";

const MAX_CHROMA_COLLECTION_NAME_LENGTH = 512;
const MIN_CHROMA_COLLECTION_NAME_LENGTH = 3;

const TURKISH_CHARACTERS: Record<string, string> = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  I: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u",
};

function normalizeText(value: string): string {
  return Array.from(value)
    .map((character) => TURKISH_CHARACTERS[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function trimSeparators(value: string): string {
  return value.replace(/^[._-]+|[._-]+$/g, "");
}

export function slugifyCollectionName(displayName: string): string {
  const slug = trimSeparators(
    normalizeText(displayName)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-"),
  );

  return slug.length > 0 ? slug : "collection";
}

export function generateCollectionId(displayName: string): string {
  const slug = slugifyCollectionName(displayName).slice(0, 80).replace(/-+$/g, "");
  const suffix = randomBytes(5).toString("hex");

  return `${slug || "collection"}-${suffix}`;
}

function slugifyPhysicalNamePart(value: string): string {
  const normalized = trimSeparators(
    normalizeText(value)
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/[-_]{2,}/g, "-"),
  );

  return normalized.length > 0 ? normalized : "x";
}

export function createPhysicalCollectionName(input: {
  tenantId: string;
  collectionId: string;
  version: string;
}): string {
  const tenant = slugifyPhysicalNamePart(input.tenantId);
  const collectionId = slugifyPhysicalNamePart(input.collectionId);
  const version = slugifyPhysicalNamePart(input.version.toLowerCase());
  let name = `rag_${tenant}_${collectionId}_${version}`;

  if (name.length > MAX_CHROMA_COLLECTION_NAME_LENGTH) {
    const overflow = name.length - MAX_CHROMA_COLLECTION_NAME_LENGTH;
    const trimmedCollectionId = collectionId.slice(0, Math.max(3, collectionId.length - overflow));
    name = `rag_${tenant}_${trimSeparators(trimmedCollectionId)}_${version}`;
  }

  assertValidChromaCollectionName(name);
  return name;
}

function isIPv4AddressLike(name: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) {
    return false;
  }

  return name.split(".").every((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

export function isValidChromaCollectionName(name: string): boolean {
  if (
    name.length < MIN_CHROMA_COLLECTION_NAME_LENGTH ||
    name.length > MAX_CHROMA_COLLECTION_NAME_LENGTH
  ) {
    return false;
  }

  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(name)) {
    return false;
  }

  if (name.includes("..")) {
    return false;
  }

  return !isIPv4AddressLike(name);
}

export function assertValidChromaCollectionName(name: string): void {
  if (!isValidChromaCollectionName(name)) {
    throw new Error(`Invalid Chroma collection name: ${name}`);
  }
}
