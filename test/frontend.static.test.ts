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

    assert.ok(content.includes('"/v1/rag/collections"'), "Should include list endpoint");
    assert.ok(content.includes('`/v1/rag/collections/${collection.id}/query`'), "Should include scoped query endpoint");
    assert.ok(content.includes('`/v1/rag/collections/${collection.id}/retrieve`'), "Should include scoped retrieve endpoint");
    assert.ok(content.includes('`/v1/rag/collections/${collection.id}`'), "Should include scoped detail endpoint");
    assert.ok(content.includes('"/ready?details=true"'), "Should expose system readiness details");
  });

  it("keeps query actions disabled until readiness enables them", async () => {
    const indexPath = path.resolve(process.cwd(), "test_frontend/index.html");
    const content = await fs.readFile(indexPath, "utf8");

    assert.ok(content.includes('id="retrieve-button" class="action-button" disabled'));
    assert.ok(content.includes('id="ask-button" class="action-button" disabled'));
    assert.ok(content.includes('id="invalid-button" class="danger action-button" disabled'));
    assert.ok(content.includes('id="collection-detail-button" class="secondary" disabled'));
    assert.ok(content.includes('No collections available'));
    assert.ok(content.includes('Please create a collection via CLI or Admin API first.'));
    assert.ok(content.includes("state.readinessById"), "Query actions should depend on collection-ready output");
    assert.ok(content.includes("readiness.capabilities.query === true"), "Query button should use ready endpoint query capability");
    assert.ok(content.includes("readiness.capabilities.retrieve === true"), "Retrieve button should use ready endpoint retrieve capability");
    assert.ok(content.includes("collection.readyUrl"), "Frontend should follow readyUrl from list response");
    assert.ok(content.includes('createCollectionOption'), 'Collection options should be rendered through DOM nodes');
    assert.ok(!content.includes('collectionSelect.innerHTML = collections.map'), 'Collection display names should not be injected through innerHTML');
  });

  it("sends request headers and surfaces diagnostics from docs", async () => {
    const indexPath = path.resolve(process.cwd(), "test_frontend/index.html");
    const content = await fs.readFile(indexPath, "utf8");

    assert.ok(content.includes('"x-tenant-id"'));
    assert.ok(content.includes('"x-user-id"'));
    assert.ok(content.includes('"x-request-id"'));
    assert.ok(content.includes("requestId"));
    assert.ok(content.includes("Retry-After"));
    assert.ok(content.includes("recommendedActions"));
    assert.ok(content.includes("RATE_LIMIT_EXCEEDED"));
    assert.ok(content.includes("Load Detail"));
  });
});
