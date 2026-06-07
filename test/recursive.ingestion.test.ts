import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { analyzeIndexingSource } from "../src/ingestion/pipeline.js";

describe("recursive ingestion", () => {
  it("should find files in subdirectories", async () => {
    const sourcePath = path.resolve("test/data/recursive");
    const ozelgeDataPath = path.resolve("test/data/dataset2/ozelge_veri.json"); // dummy path
    
    const analysis = await analyzeIndexingSource({
      sourcePath,
      ozelgeDataPath,
      indexSampleSize: 0
    });
    
    const foundFiles = analysis.sourceFiles.map(f => f.path);
    assert.ok(foundFiles.some(f => f.endsWith(path.join("sub", "test.txt"))));
  });
});
