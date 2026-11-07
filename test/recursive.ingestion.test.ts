import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeIndexingSource, registryExcludePaths } from "../src/ingestion/pipeline.js";

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

  it("skips the SQLite registry and its sidecar files when they live inside the source folder", async () => {
    const sourcePath = await fs.mkdtemp(path.join(os.tmpdir(), "vanilla-rag-exclude-"));
    try {
      const registryPath = path.join(sourcePath, "registry.sqlite");
      await fs.writeFile(path.join(sourcePath, "doc.txt"), "Merhaba dunya");
      await fs.writeFile(registryPath, "sqlite bytes");
      await fs.writeFile(`${registryPath}-wal`, "wal bytes");

      const analysis = await analyzeIndexingSource({
        sourcePath,
        ozelgeDataPath: path.join(sourcePath, "missing.json"),
        indexSampleSize: 0,
        excludePaths: registryExcludePaths(registryPath),
      });

      assert.equal(analysis.fileCount, 1);
      assert.deepEqual(analysis.unsupportedFiles, []);
      assert.deepEqual(analysis.sourceFiles.map((file) => path.basename(file.path)), ["doc.txt"]);
    } finally {
      await fs.rm(sourcePath, { recursive: true, force: true });
    }
  });
});
