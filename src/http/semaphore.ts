export class Semaphore {
  private count = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
    if (this.count < this.limit) {
      this.count++;
      return;
    }

    return new Promise((resolve, reject) => {
      let isDone = false;

      const cleanup = () => {
        isDone = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        abortSignal?.removeEventListener("abort", onAbort);
      };

      const execute = () => {
        if (isDone) return;
        cleanup();
        this.count++;
        resolve();
      };

      const onAbort = () => {
        if (isDone) return;
        cleanup();
        const index = this.queue.indexOf(execute);
        if (index !== -1) this.queue.splice(index, 1);
        const err = new Error("Request aborted while waiting for semaphore");
        err.name = "AbortError";
        reject(err);
      };

      const onTimeout = () => {
        if (isDone) return;
        cleanup();
        const index = this.queue.indexOf(execute);
        if (index !== -1) this.queue.splice(index, 1);
        reject(new Error(`Timeout of ${timeoutMs}ms exceeded while waiting for semaphore`));
      };

      const timeoutTimer = setTimeout(onTimeout, timeoutMs);
      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener("abort", onAbort);
      }

      this.queue.push(execute);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.count--;
    }
  }

  async run<T>(
    task: () => Promise<T>,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<T> {
    await this.acquire(timeoutMs, abortSignal);
    try {
      if (abortSignal?.aborted) {
         const err = new Error("Request aborted before running task");
         err.name = "AbortError";
         throw err;
      }
      return await task();
    } finally {
      this.release();
    }
  }
}
