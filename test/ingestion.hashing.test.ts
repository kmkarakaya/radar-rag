import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import fs from "node:fs/promises";
import { analyzeIndexingSource } from "../src/ingestion/pipeline.js";

describe("ingestion hashing", () => {
  it("should include sourceHash in document metadata and it should change when file content changes", async () => {
    const tempDir = path.resolve("test/data/temp_hashing");
    const filePath = path.join(tempDir, "test.txt");
    await fs.mkdir(tempDir, { recursive: true });
    
    // 1. Initial content
    await fs.writeFile(filePath, "initial content");
    
    const ozelgeDataPath = path.resolve("test/data/dataset2/ozelge_veri.json"); // dummy path
    
    const analysis1 = await analyzeIndexingSource({
      sourcePath: tempDir,
      ozelgeDataPath,
      indexSampleSize: 0
    });
    
    assert.strictEqual(analysis1.documents.length, 1);
    const hash1 = analysis1.documents[0].metadata.sourceHash;
    assert.ok(hash1, "sourceHash should be present");
    
    // 2. Updated content
    await fs.writeFile(filePath, "updated content");
    
    const analysis2 = await analyzeIndexingSource({
      sourcePath: tempDir,
      ozelgeDataPath,
      indexSampleSize: 0
    });
    
    assert.strictEqual(analysis2.documents.length, 1);
    const hash2 = analysis2.documents[0].metadata.sourceHash;
    assert.ok(hash2, "sourceHash should be present");
    assert.notStrictEqual(hash1, hash2, "sourceHash should change when content changes");
    
    // Clean up
    await fs.unlink(filePath);
    await fs.rmdir(tempDir);
  });
});
