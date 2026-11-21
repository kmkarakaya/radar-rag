import { parentPort, workerData } from "node:worker_threads";

/**
 * Stand-in for src/embeddings/builtinWorker.ts (same protocol) for tests: no model, no download.
 * Each embed blocks this thread for `busyMs` (like synchronous ONNX inference), returns [text length, 1]
 * per text, and exits the thread when a text contains `crashOnText`. `failLoad` reports a load error.
 */

const options = workerData as { busyMs?: number; failLoad?: string; crashOnText?: string };
const port = parentPort!;

if (options.failLoad) {
  port.postMessage({ type: "load-error", message: options.failLoad });
} else {
  port.on("message", (message: { type: string; id: number; texts: string[] }) => {
    if (message.type !== "embed") return;
    if (options.crashOnText && message.texts.some((text) => text.includes(options.crashOnText!))) process.exit(3);
    const until = Date.now() + (options.busyMs ?? 0);
    while (Date.now() < until) {
      // Busy wait: blocks this thread the way inference does.
    }
    const vectors = message.texts.map((text) => Float32Array.from([text.length, 1]));
    port.postMessage({ type: "vectors", id: message.id, vectors }, vectors.map((vector) => vector.buffer));
  });
  port.postMessage({ type: "loaded" });
}
