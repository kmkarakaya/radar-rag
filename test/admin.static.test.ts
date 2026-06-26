import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

async function readAdminFile(fileName: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), "admin", fileName), "utf8");
}

describe("admin panel static contract", () => {
  it("uses only the versioned collection endpoints and no unsafe HTML injection", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminFile("admin.js"),
    ]);

    assert.ok(!html.includes("/rag/query"));
    assert.ok(!html.includes("/rag/retrieve"));
    assert.ok(!js.includes("/rag/query"));
    assert.ok(!js.includes("/rag/retrieve"));
    assert.ok(js.includes('rag: "/v1/rag"'));
    assert.ok(js.includes('admin: "/v1/admin"'));
    assert.ok(!js.includes(".innerHTML"));
  });

  it("loads full editable settings through the admin collection detail endpoint", async () => {
    const js = await readAdminFile("admin.js");

    assert.ok(js.includes("function loadAdminCollectionDetail(collectionId)"));
    assert.ok(js.includes("apiRequest(adminCollectionUrl(collectionId))"));
    assert.ok(js.includes("setupEditorTab(merged)"));
    assert.ok(js.includes("mergeCollectionIntoState(detail)"));
  });

  it("keeps admin DOM id references aligned with index.html", async () => {
    const [html, js] = await Promise.all([
      readAdminFile("index.html"),
      readAdminFile("admin.js"),
    ]);

    const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const directIds = [...js.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
    const editFieldBlock = js.match(/const EDIT_FIELD_IDS = \{([\s\S]*?)\};/);
    assert.ok(editFieldBlock, "EDIT_FIELD_IDS should be present");
    const editFieldIds = [...editFieldBlock[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);

    for (const id of [...directIds, ...editFieldIds]) {
      assert.ok(htmlIds.has(id), `admin/index.html is missing id="${id}" referenced by admin.js`);
    }
  });

  it("keeps job, readiness and health contracts aligned with backend response shapes", async () => {
    const js = await readAdminFile("admin.js");

    assert.ok(js.includes("data?.job"), "Job polling should read the data.job wrapper");
    assert.ok(!js.includes("data.status"), "Job polling should not read bare data.status");
    assert.ok(!js.includes("data.updatedAt"), "Job polling should not read bare data.updatedAt");
    assert.ok(!js.includes("data.chunkCount"), "Job polling should not read bare data.chunkCount");
    assert.ok(!js.includes("data.documentCount"), "Job polling should not read bare data.documentCount");
    assert.ok(!js.includes("completed"), "Admin UI should not expect a completed job status");
    assert.ok(!js.includes("deriveReadinessBlockers"), "Collection readiness blockers should come from backend issues");
    assert.ok(js.includes("readiness.blockers"), "Collection readiness should render backend blockers");
    assert.ok(js.includes("readiness.warnings"), "Collection readiness should render backend warnings");
    assert.ok(js.includes("item.recommendedAction"), "Readiness issue rendering should surface backend recommended actions");
    assert.ok(!js.includes("strict=true"), "Health dashboard should not use ready?strict=true");
    assert.ok(js.includes("Promise.allSettled"), "Health dashboard should preserve summaries if details fail");
  });

  it("contains the planned playground and job monitor controls", async () => {
    const html = await readAdminFile("index.html");
    const js = await readAdminFile("admin.js");

    assert.ok(html.includes('id="pgK"'), "Retrieve K input should exist");
    assert.ok(html.includes("This monitor tracks jobs observed by this browser/admin session.") || js.includes("This monitor tracks jobs observed by this browser/admin session."));
    assert.ok(js.includes("function renderRetrieveResult"));
    assert.ok(js.includes("function renderQueryResult"));
    assert.ok(js.includes("function renderPlaygroundError"));
    assert.ok(js.includes("function renderSourceFields"));
  });
});
