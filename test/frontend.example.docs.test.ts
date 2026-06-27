import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("frontend example docs", () => {
  it("documents the current public rag contract and required headers", async () => {
    const readmePath = path.resolve(process.cwd(), "test_frontend/README.md");
    const content = await fs.readFile(readmePath, "utf8");

    assert.match(content, /\/v1\/rag\/collections\/:collectionId\/ready/);
    assert.match(content, /x-tenant-id/);
    assert.match(content, /x-user-id/);
    assert.match(content, /x-request-id/);
    assert.match(content, /Retry-After/);
    assert.match(content, /query\.sources/);
    assert.match(content, /does not use legacy `\/rag\/query` or `\/rag\/retrieve` routes/);
  });
});
