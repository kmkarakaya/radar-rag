import { Worker } from "node:worker_threads";
import type { BuiltinModelLoader, EmbedPriority, LoadedBuiltinModel } from "./builtin.js";

/**
 * Runs a built-in embedding model in a worker thread. onnxruntime-node runs inference synchronously on the
 * thread that calls it, so in the main thread every embedding batch would stop the HTTP server from answering
 * (other collections' searches, the admin panel, /health). The worker owns the model (one copy, as before);
 * the main thread only queues texts and gets vectors back.
 *
 * One batch is sent to the worker at a time, so the queue decides the order: query embeddings go before
 * queued document batches, and a search waits at most for the batch that is running.
 *
 * Protocol (see builtinWorker.ts):
 *   worker -> main  { type: "loaded" } | { type: "load-error", message }
 *   main -> worker  { type: "embed", id, texts }
 *   worker -> main  { type: "vectors", id, vectors: Float32Array[] } | { type: "embed-error", id, message }
 */

export type WorkerModelLoaderOptions = {
  /** Worker script; defaults to builtinWorker (.ts under tsx, .js in dist). */
  workerUrl?: URL;
  /** Extra data for the worker (tests use it to configure a fake worker). */
  workerData?: Record<string, unknown>;
};

type QueuedEmbed = {
  id: number;
  texts: string[];
  priority: EmbedPriority;
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
};

/** Every worker that is starting or running, so they can all be stopped at shutdown. */
const liveWorkers = new Set<Worker>();
/** Workers stopped on purpose (close, shutdown): their exit is not reported as a crash. */
const closedWorkers = new WeakSet<Worker>();

export function defaultBuiltinWorkerUrl(): URL {
  // Under tsx (npm run dev, npm test) this module is the .ts source and the worker must be too. Compiled (dist/),
  // both are .js.
  return new URL(import.meta.url.endsWith(".ts") ? "./builtinWorker.ts" : "./builtinWorker.js", import.meta.url);
}

/** Starts a worker for a script; a TypeScript script (development only) is loaded through tsx. */
function spawnWorker(url: URL, workerData: Record<string, unknown>): Worker {
  if (!url.pathname.endsWith(".ts")) return new Worker(url, { workerData });
  // tsx's --import hook transforms TypeScript in a worker but does not map the NodeNext ".js" specifiers to their
  // ".ts" files there (tsx 4.21); registering tsx's API inside the worker does. Never used from dist/.
  const tsxApi = import.meta.resolve("tsx/esm/api");
  const code = `import { register } from ${JSON.stringify(tsxApi)}; register(); await import(${JSON.stringify(url.href)});`;
  return new Worker(code, { eval: true, workerData, execArgv: [] });
}

/** Stops every built-in embedding worker (server shutdown, tests). Requests still waiting are rejected. */
export async function closeBuiltinWorkers(): Promise<void> {
  const workers = [...liveWorkers];
  liveWorkers.clear();
  workers.forEach((worker) => closedWorkers.add(worker));
  await Promise.allSettled(workers.map((worker) => worker.terminate()));
}

class WorkerModel implements LoadedBuiltinModel {
  private readonly queue: QueuedEmbed[] = [];
  private running: QueuedEmbed | null = null;
  private nextId = 1;
  private stopped: Error | null = null;
  private readonly stoppedListeners: Array<() => void> = [];

  constructor(private readonly worker: Worker, private readonly modelId: string) {
    worker.on("message", (message: WorkerMessage) => this.onMessage(message));
    worker.on("error", (error) => this.stop(new Error(`Built-in embedding worker for ${modelId} failed: ${error.message}`)));
    worker.on("exit", (code) => this.stop(new Error(closedWorkers.has(worker)
      ? "The built-in embedding worker was stopped (the server is shutting down)."
      : `Built-in embedding worker stopped unexpectedly (exit code ${code}). The next request starts it again.`)));
    this.syncRef();
  }

  embed(texts: string[], options: { priority?: EmbedPriority } = {}): Promise<number[][]> {
    if (this.stopped) return Promise.reject(this.stopped);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, texts, priority: options.priority ?? "document", resolve, reject });
      this.pump();
    });
  }

  onStopped(listener: () => void): void {
    if (this.stopped) listener();
    else this.stoppedListeners.push(listener);
  }

  async close(): Promise<void> {
    closedWorkers.add(this.worker);
    liveWorkers.delete(this.worker);
    await this.worker.terminate();
  }

  private pump(): void {
    if (this.running || this.stopped || this.queue.length === 0) {
      this.syncRef();
      return;
    }
    const queryIndex = this.queue.findIndex((item) => item.priority === "query");
    const [next] = this.queue.splice(queryIndex >= 0 ? queryIndex : 0, 1);
    this.running = next;
    this.syncRef();
    this.worker.postMessage({ type: "embed", id: next.id, texts: next.texts });
  }

  private onMessage(message: WorkerMessage): void {
    const running = this.running;
    if (!running || !("id" in message) || message.id !== running.id) return;
    this.running = null;
    if (message.type === "vectors") running.resolve(message.vectors.map((vector) => Array.from(vector)));
    else if (message.type === "embed-error") running.reject(new Error(message.message));
    this.pump();
  }

  /** Keeps the process alive only while there is work, so a CLI or test run can exit once it is done. */
  private syncRef(): void {
    if (this.running || this.queue.length > 0) this.worker.ref();
    else this.worker.unref();
  }

  private stop(error: Error): void {
    if (this.stopped) return;
    this.stopped = error;
    liveWorkers.delete(this.worker);
    const waiting = [...(this.running ? [this.running] : []), ...this.queue.splice(0)];
    this.running = null;
    waiting.forEach((item) => item.reject(error));
    this.stoppedListeners.splice(0).forEach((listener) => listener());
  }
}

type WorkerMessage =
  | { type: "loaded" }
  | { type: "load-error"; message: string }
  | { type: "vectors"; id: number; vectors: Float32Array[] }
  | { type: "embed-error"; id: number; message: string };

/** A BuiltinModelLoader that loads the model in a worker thread (the default for BuiltinEmbeddings). */
export function createWorkerModelLoader(options: WorkerModelLoaderOptions = {}): BuiltinModelLoader {
  return (spec, cacheDir) => new Promise<LoadedBuiltinModel>((resolve, reject) => {
    const worker = spawnWorker(options.workerUrl ?? defaultBuiltinWorkerUrl(), { ...options.workerData, modelId: spec.id, cacheDir });
    liveWorkers.add(worker);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      liveWorkers.delete(worker);
      void worker.terminate();
      reject(error);
    };
    worker.once("error", (error) => fail(error));
    worker.once("exit", (code) => fail(new Error(`The built-in embedding worker exited while loading the model (exit code ${code}).`)));
    worker.on("message", function onLoad(message: WorkerMessage) {
      if (message.type === "load-error") {
        worker.off("message", onLoad);
        fail(new Error(message.message));
      } else if (message.type === "loaded") {
        worker.off("message", onLoad);
        if (settled) return;
        settled = true;
        worker.removeAllListeners("error");
        worker.removeAllListeners("exit");
        resolve(new WorkerModel(worker, spec.id));
      }
    });
  });
}

export const loadBuiltinModelInWorker: BuiltinModelLoader = createWorkerModelLoader();
