import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("frontend static file", () => {
  it("does not contain old /rag/query or /rag/retrieve strings", async () => {
    const indexPath = path.resolve(process.cwd(), "test_frontend/index.html");
    const content = await fs.readFile(indexPath, "utf8");

    assert.ok(!content.includes('"/rag/query"'), "Should not use legacy /rag/query route");
    assert.ok(!content.includes('"/rag/retrieve"'), "Should not use legacy /rag/retrieve route");
    
    // It should contain the new endpoints
    assert.ok(content.includes('"/v1/rag/collections"'), "Should include list endpoint");
    assert.ok(content.includes('`/v1/rag/collections/${collectionId}/query`'), "Should include scoped query endpoint");
  });

  it("keeps query actions disabled until a collection is available and selected", async () => {
    const indexPath = path.resolve(process.cwd(), "test_frontend/index.html");
    const content = await fs.readFile(indexPath, "utf8");

    assert.ok(content.includes('id="retrieve-button" class="action-button" disabled'));
    assert.ok(content.includes('id="ask-button" class="action-button" disabled'));
    assert.ok(content.includes('id="invalid-button" class="danger action-button" disabled'));
    assert.ok(content.includes('No collections available'));
    assert.ok(content.includes('Please create a collection via CLI or Admin API first.'));
    assert.ok(content.includes('updateQueryButtons(false);'));
  });
});
