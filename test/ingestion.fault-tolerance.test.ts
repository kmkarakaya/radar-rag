import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import { analyzeIndexingSource } from "../src/ingestion/pipeline.js";
import type { OperationalLogEvent } from "../src/observability/logger.js";

describe("ingestion fault tolerance", () => {
  const testDir = path.resolve("test/data/fault-tolerance-test");

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "good.txt"), "This is a good file.");
    // DocxLoader expects a zip structure, so this should fail.
    await fs.writeFile(path.join(testDir, "broken.docx"), "This is NOT a docx file.");
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should continue indexing when a file fails to load", async () => {
    const logEvents: OperationalLogEvent[] = [];
    const analysis = await analyzeIndexingSource({
      sourcePath: testDir,
      ozelgeDataPath: path.resolve("non-existent.json"),
      indexSampleSize: 0,
      logEvent: (event) => {
        logEvents.push(event);
      }
    });

    // It should have loaded good.txt
    assert.ok(analysis.documents.some(d => d.pageContent.includes("This is a good file")), "Should have loaded good.txt");
    
    // It should have reported broken.docx as failed
    assert.ok(analysis.unsupportedFiles.some(f => f.path.endsWith("broken.docx") && f.reason.includes("Failed to load")), "Should have reported broken.docx as failed");
    
    // Check if the error was logged via operational logging
    assert.ok(logEvents.some(e => e.operation === "load_file" && e.status === "failed" && (e.details?.path as string).endsWith("broken.docx")), "Should have logged the failure");
    
    // Total documents should be 1 (from good.txt)
    assert.equal(analysis.documents.length, 1, "Should have exactly 1 document loaded");
    
    // The successful file should be in sourceFiles
    assert.ok(analysis.sourceFiles.some(f => f.path.endsWith("good.txt")), "good.txt should be in sourceFiles");
  });
});
