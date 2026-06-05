export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

export class OperationAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationAbortError";
  }
}

export async function withTimeoutAndAbort<T>(input: {
  promise: Promise<T>;
  timeoutMs: number;
  label: string;
  abortSignal?: AbortSignal;
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    throw new OperationAbortError(`${input.label} aborted before start.`);
  }

  let timeoutTimer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;

  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new OperationTimeoutError(`${input.label} timed out after ${input.timeoutMs}ms.`));
        }, input.timeoutMs);

        if (input.abortSignal) {
          abortHandler = () => {
            reject(new OperationAbortError(`${input.label} aborted.`));
          };
          input.abortSignal.addEventListener("abort", abortHandler, { once: true });
        }
      }),
    ]);
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    if (abortHandler) {
      input.abortSignal?.removeEventListener("abort", abortHandler);
    }
  }
}

export function isTimeoutOrAbortError(error: unknown): boolean {
  return error instanceof OperationTimeoutError
    || error instanceof OperationAbortError
    || (error instanceof Error && (
      error.name === "AbortError"
      || /timed out|timeout of|request aborted|aborted/i.test(error.message)
    ));
}
