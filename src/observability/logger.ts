import type { NextFunction, Request, Response } from "express";
import type { RequestContext } from "../http/requestContext.js";

export type OperationalLogStatus = "started" | "succeeded" | "failed" | "rejected" | "skipped" | "cancelled";

export type OperationalLogEvent = {
  timestamp?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  collectionId?: string;
  physicalCollection?: string;
  jobId?: string;
  operation: string;
  status: OperationalLogStatus;
  latencyMs?: number;
  errorCode?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type OperationalLogSink = (event: OperationalLogEvent) => void;

export const noopLogSink: OperationalLogSink = () => {};

export function createConsoleLogSink(): OperationalLogSink {
  return (event) => {
    console.log(JSON.stringify(normalizeLogEvent(event)));
  };
}

export function emitOperationalLog(
  sink: OperationalLogSink | undefined,
  event: OperationalLogEvent,
): void {
  const target = sink ?? noopLogSink;
  const normalizedEvent = normalizeLogEvent(event);

  try {
    target(normalizedEvent);
  } catch (error) {
    try {
      console.error("Operational log sink failed", {
        operation: normalizedEvent.operation,
        status: normalizedEvent.status,
        error,
      });
    } catch {
      // Best-effort fallback only; logging must not affect the primary workflow.
    }
  }
}

export function normalizeLogEvent(event: OperationalLogEvent): OperationalLogEvent {
  return {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
}

export function createOperationalHttpLogger(logEvent: OperationalLogSink): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const startedAt = Date.now();
    const target = getHttpOperationTarget(req);
    if (!target) {
      next();
      return;
    }

    res.on("finish", () => {
      const context = res.locals.requestContext as RequestContext | undefined;
      emitOperationalLog(logEvent, {
        requestId: context?.requestId,
        tenantId: context?.tenantId,
        userId: context?.userId,
        collectionId: res.locals.collectionId ?? target.collectionId,
        physicalCollection: res.locals.physicalCollection,
        jobId: res.locals.jobId ?? target.jobId,
        operation: target.operation,
        status: res.statusCode >= 400 ? "failed" : "succeeded",
        latencyMs: Date.now() - startedAt,
        errorCode: res.locals.errorCode,
        details: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
        },
      });
    });

    next();
  };
}

export function getHttpOperationTarget(req: Request): { operation: string; collectionId?: string; jobId?: string } | null {
  if (req.method === "POST") {
    const ragMatch = /^\/v1\/rag\/collections\/([^/]+)\/(query|retrieve)$/.exec(req.path);
    if (ragMatch) {
      return {
        collectionId: decodeURIComponent(ragMatch[1] ?? ""),
        operation: ragMatch[2] ?? "rag",
      };
    }

    const reindexMatch = /^\/v1\/admin\/collections\/([^/]+)\/reindex$/.exec(req.path);
    if (reindexMatch) {
      return {
        collectionId: decodeURIComponent(reindexMatch[1] ?? ""),
        operation: "reindex",
      };
    }

    const jobDeleteMatch = /^\/v1\/admin\/jobs\/bulk-delete$/.exec(req.path);
    if (jobDeleteMatch) {
      return {
        operation: "job_delete_batch",
      };
    }
  }

  if (req.method === "GET") {
    const jobMatch = /^\/v1\/admin\/jobs\/([^/]+)$/.exec(req.path);
    if (jobMatch) {
      return {
        jobId: decodeURIComponent(jobMatch[1] ?? ""),
        operation: "job",
      };
    }
  }

  if (req.method === "DELETE") {
    const jobMatch = /^\/v1\/admin\/jobs\/([^/]+)$/.exec(req.path);
    if (jobMatch) {
      return {
        jobId: decodeURIComponent(jobMatch[1] ?? ""),
        operation: "job_delete",
      };
    }
  }

  return null;
}
