import { parentPort, workerData } from "node:worker_threads";
import { loadBuiltinModelWithTransformers } from "./builtin.js";
import { getBuiltinEmbeddingModelSpec } from "./models.js";

/**
 * Worker thread that owns a built-in embedding model (see builtinWorkerHost.ts for the protocol). Inference
 * blocks this thread, not the HTTP server. transformers.js is only ever loaded here.
 */

const port = parentPort;
if (!port) throw new Error("builtinWorker must run as a worker thread.");

const { modelId, cacheDir } = workerData as { modelId: string; cacheDir: string };

async function main(): Promise<void> {
  const spec = getBuiltinEmbeddingModelSpec(modelId);
  if (!spec) {
    port!.postMessage({ type: "load-error", message: `${modelId} is not a supported built-in embedding model.` });
    return;
  }
  let model;
  try {
    model = await loadBuiltinModelWithTransformers(spec, cacheDir);
  } catch (error) {
    port!.postMessage({ type: "load-error", message: error instanceof Error ? error.message : String(error) });
    return;
  }
  port!.on("message", async (message: { type: string; id: number; texts: string[] }) => {
    if (message.type !== "embed") return;
    try {
      const vectors = (await model.embed(message.texts)).map((vector) => Float32Array.from(vector));
      port!.postMessage({ type: "vectors", id: message.id, vectors }, vectors.map((vector) => vector.buffer));
    } catch (error) {
      port!.postMessage({ type: "embed-error", id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  });
  port!.postMessage({ type: "loaded" });
}

void main();
