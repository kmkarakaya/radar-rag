import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertValidChromaCollectionName,
  createPhysicalCollectionName,
  generateCollectionId,
  isValidChromaCollectionName,
  slugifyCollectionName,
} from "../src/collections/ids.js";

describe("collection ids", () => {
  it("slugifies display names into readable URL-safe text", () => {
    assert.equal(slugifyCollectionName("İK Belgeleri 2026"), "ik-belgeleri-2026");
    assert.equal(slugifyCollectionName("  ---  "), "collection");
  });

  it("generates public collection ids as slug plus random suffix", () => {
    const id = generateCollectionId("Vergi Özelgeleri");

    assert.match(id, /^vergi-ozelgeleri-[a-f0-9]{10}$/);
  });

  it("validates Chroma collection names", () => {
    assert.equal(isValidChromaCollectionName("abc"), true);
    assert.equal(isValidChromaCollectionName("rag_default_test-collection_20260601t120000z"), true);

    assert.equal(isValidChromaCollectionName("ab"), false);
    assert.equal(isValidChromaCollectionName("ABC"), false);
    assert.equal(isValidChromaCollectionName("abc..def"), false);
    assert.equal(isValidChromaCollectionName("192.168.1.1"), false);
    assert.equal(isValidChromaCollectionName("abc-"), false);
  });

  it("creates Chroma-safe physical collection names", () => {
    const physicalName = createPhysicalCollectionName({
      tenantId: "Default Tenant",
      collectionId: "Vergi Özelgeleri-abcdef1234",
      version: "20260601T120000Z",
    });

    assert.equal(physicalName, "rag_default-tenant_vergi-ozelgeleri-abcdef1234_20260601t120000z");
    assertValidChromaCollectionName(physicalName);
  });
});
