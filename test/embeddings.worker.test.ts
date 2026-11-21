import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import {
  BuiltinEmbeddings,
  BuiltinModelLoadError,
  clearLoadedBuiltinModels,
  closeBuiltinModels,
  type BuiltinModelLoader,
} from "../src/embeddings/builtin.js";
import { createWorkerModelLoader } from "../src/embeddings/builtinWorkerHost.js";
import { DEFAULT_BUILTIN_EMBEDDING_MODEL, getBuiltinEmbeddingModelSpec } from "../src/embeddings/models.js";

const MODEL = DEFAULT_BUILTIN_EMBEDDING_MODEL;
const FAKE_WORKER = new URL("./fixtures/fakeEmbeddingWorker.ts", import.meta.url);
const spec = getBuiltinEmbeddingModelSpec(MODEL)!;

function fakeLoader(workerData: Record<string, unknown>): BuiltinModelLoader {
  return createWorkerModelLoader({ workerUrl: FAKE_WORKER, workerData });
}

let cacheDirCounter = 0;
/** A cache dir per test, so each test gets its own model (and worker). */
function freshCacheDir(): string {
  cacheDirCounter += 1;
  return `worker-test-${cacheDirCounter}`;
}

afterEach(async () => {
  await closeBuiltinModels();
  clearLoadedBuiltinModels();
});

describe("built-in embeddings in a worker thread", () => {
  it("keeps the main thread free while a batch is being embedded", async () => {
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader: fakeLoader({ busyMs: 300 }), batchSize: 2 });
    await embeddings.embedQuery("warm up"); // the worker is loaded
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 20);
    try {
      const vectors = await embeddings.embedDocuments(["a", "b", "c", "d"]); // two batches, ~600 ms of blocking
      assert.equal(vectors.length, 4);
    } finally {
      clearInterval(timer);
    }
    // With the batches on the main thread there would be almost no ticks; in a worker there are many.
    assert.ok(ticks >= 10, `expected the main thread to keep running, got ${ticks} ticks`);
  });

  it("returns the worker's vectors normalized, in order", async () => {
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader: fakeLoader({}), batchSize: 2 });
    const vectors = await embeddings.embedDocuments(["x", "yy", "zzz"]);
    const prefix = spec.documentPrefix.length;
    const expected = [1, 2, 3].map((length) => {
      const raw = [prefix + length, 1];
      const norm = Math.hypot(...raw);
      return raw.map((value) => Math.fround(value) / Math.fround(norm));
    });
    vectors.forEach((vector, index) => {
      assert.ok(Math.abs(vector[0] - expected[index][0]) < 1e-6);
      assert.ok(Math.abs(vector[1] - expected[index][1]) < 1e-6);
    });
  });

  it("embeds a query before document batches that are still queued", async () => {
    const model = await fakeLoader({ busyMs: 150 })(spec, freshCacheDir());
    const order: string[] = [];
    const run = (text: string, priority: "query" | "document") =>
      model.embed([text], { priority }).then(() => { order.push(text); });
    const all = [run("d1", "document"), run("d2", "document"), run("d3", "document")];
    all.push(run("q", "query"));
    await Promise.all(all);
    // d1 was already running; the query goes next, before the queued d2 and d3.
    assert.deepEqual(order, ["d1", "q", "d2", "d3"]);
    await model.close?.();
  });

  it("rejects waiting requests when the worker crashes and starts a new one for the next request", async () => {
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader: fakeLoader({ busyMs: 100, crashOnText: "CRASH" }) });
    await embeddings.embedQuery("before");
    const crashing = embeddings.embedQuery("CRASH");
    const waiting = embeddings.embedQuery("queued behind the crash");
    await assert.rejects(crashing, /stopped unexpectedly \(exit code 3\)\. The next request starts it again\./);
    await assert.rejects(waiting, /stopped unexpectedly/);
    const after = await embeddings.embedQuery("after");
    assert.equal(after.length, 2);
  });

  it("reports a load failure as BuiltinModelLoadError and tries again on the next request", async () => {
    let loads = 0;
    const failing = fakeLoader({ failLoad: "Not enough free disk space to download it." });
    const loader: BuiltinModelLoader = (modelSpec, cacheDir) => { loads += 1; return failing(modelSpec, cacheDir); };
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(embeddings.embedQuery("q"), (error: unknown) => {
        assert.ok(error instanceof BuiltinModelLoadError);
        assert.match(error.message, /could not be loaded: Not enough free disk space/);
        return true;
      });
    }
    assert.equal(loads, 2);
  });

  it("closeBuiltinModels stops the workers and rejects requests still waiting", async () => {
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader: fakeLoader({ busyMs: 1000 }) });
    await embeddings.embedQuery("loaded");
    const pending = embeddings.embedQuery("long");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await closeBuiltinModels();
    await assert.rejects(pending, /was stopped/);
  });

  it("an idle worker does not keep the process alive", async () => {
    const model = await fakeLoader({})(spec, freshCacheDir());
    await model.embed(["x"]);
    // Not closed on purpose: if the idle worker were ref'd, this test file would never exit (node --test would hang).
    assert.ok(model);
  });

  it("the HTTP server answers while a long embedding runs", async () => {
    const embeddings = new BuiltinEmbeddings({ model: MODEL, cacheDir: freshCacheDir(), loader: fakeLoader({ busyMs: 800 }), batchSize: 1 });
    await embeddings.embedQuery("loaded");
    const app = createApp({ runtimeConfig: config });
    const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const { port } = server.address() as AddressInfo;
      const embedding = embeddings.embedDocuments(["a", "b", "c"]); // ~2.4 s of blocking in the worker
      await new Promise((resolve) => setTimeout(resolve, 100));
      const started = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const elapsed = performance.now() - started;
      assert.equal(response.status, 200);
      assert.ok(elapsed < 500, `GET /health took ${Math.round(elapsed)} ms while embedding`);
      await embedding;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("starts the real worker script (its imports resolve under tsx and in dist)", async () => {
    // An unknown model id makes the real builtinWorker report a load error before it touches transformers.js,
    // so this checks the worker's module graph without a model.
    const loader = createWorkerModelLoader();
    await assert.rejects(loader({ ...spec, id: "not-a-model" }, "unused"), /not-a-model is not a supported built-in embedding model\./);
  });

  it("loads transformers.js only in the worker, never in the server's main thread", async () => {
    const root = path.resolve(process.cwd(), "src");
    const files = (await fs.readdir(root, { recursive: true })).filter((file) => file.endsWith(".ts"));
    const importers: string[] = [];
    for (const file of files) {
      if ((await fs.readFile(path.join(root, file), "utf8")).includes("@huggingface/transformers")) importers.push(file.split(path.sep).join("/"));
    }
    // builtin.ts only imports it lazily inside loadBuiltinModelWithTransformers, which only builtinWorker.ts calls.
    assert.deepEqual(importers, ["embeddings/builtin.ts"]);
    const builtin = await fs.readFile(path.join(root, "embeddings", "builtin.ts"), "utf8");
    assert.ok(builtin.includes("this.loader = fields.loader ?? loadBuiltinModelInWorker;"));
    const callers: string[] = [];
    for (const file of files) {
      if ((await fs.readFile(path.join(root, file), "utf8")).includes("loadBuiltinModelWithTransformers(")) callers.push(file.split(path.sep).join("/"));
    }
    assert.deepEqual(callers.sort(), ["embeddings/builtinWorker.ts"]);
  });
});
