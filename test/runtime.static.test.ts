import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const stalePattern = /data\.indexSampleSize|rag\.retrievalK|chroma\.collection|\/rag\/query|\/rag\/retrieve/;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }

    return entry.isFile() ? [fullPath] : [];
  }));

  return nested.flat();
}

describe("runtime static contract", () => {
  it("does not keep stale endpoints or config paths in product files", async () => {
    const srcFiles = (await listFiles(path.resolve(process.cwd(), "src")))
      .filter((filePath) => filePath.endsWith(".ts"));
    const productFiles = [
      ...srcFiles,
      path.resolve(process.cwd(), "README.md"),
      path.resolve(process.cwd(), "vanilla_rag_backend_mimarisi.md"),
      path.resolve(process.cwd(), "test_frontend/index.html"),
      path.resolve(process.cwd(), "config/rag.config.yaml"),
    ];

    for (const filePath of productFiles) {
      const content = await fs.readFile(filePath, "utf8");
      assert.equal(
        stalePattern.test(content),
        false,
        `Found stale runtime or product string in ${path.relative(process.cwd(), filePath)}`,
      );
    }
  });

  it("keeps cleanup and backpressure settings visible in runtime config", async () => {
    const configContent = await fs.readFile(path.resolve(process.cwd(), "config/rag.config.yaml"), "utf8");

    assert.match(configContent, /cleanup:\s*[\r\n]+\s+retentionMs:\s*3600000/);
    assert.match(configContent, /limits:\s*[\r\n]+\s+maxConcurrentEmbeddings:\s*5/);
    assert.match(configContent, /maxConcurrentGenerations:\s*2/);
  });

  it("documents that full request rate limiting is not enabled yet", async () => {
    const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf8");
    const architecture = await fs.readFile(
      path.resolve(process.cwd(), "vanilla_rag_backend_mimarisi.md"),
      "utf8",
    );

    assert.match(readme, /Henüz tam bir request rate limiter yoktur/i);
    assert.match(architecture, /Henüz tam bir request rate limiter yoktur/i);
  });
});