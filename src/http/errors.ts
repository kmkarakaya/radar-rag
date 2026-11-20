import type { NextFunction, Request, Response } from "express";
import type { RequestContext } from "./requestContext.js";
import { RagQueryError } from "../rag.js";

export type ApiErrorCode =
  | "INVALID_REQUEST_BODY"
  | "COLLECTION_FORBIDDEN"
  | "COLLECTION_NOT_FOUND"
  | "COLLECTION_NOT_READY"
  | "COLLECTION_INDEX_ALREADY_RUNNING"
  | "NO_RELEVANT_CONTEXT"
  | "ANSWER_NOT_IN_RETRIEVED_CONTEXT"
  | "DISALLOWED_FALLBACK_ANSWER"
  | "COLLECTION_INDEXING"
  | "COLLECTION_STORAGE_INCONSISTENT"
  | "MODEL_BACKPRESSURE"
  | "INVALID_JOB_STATUS"
  | "UNAVAILABLE_MODEL"
  | "EMBEDDING_PROVIDER_NOT_CONFIGURED"
  | "EMBEDDING_PROVIDER_UNREACHABLE"
  | "EMBEDDING_PROVIDER_ERROR"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "RATE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "EMPTY_MODEL_RESPONSE"
  | "CHAT_NOT_CONFIGURED"
  | "CHAT_PROVIDER_UNREACHABLE"
  | "CHAT_PROVIDER_ERROR"
  | "ROUTE_NOT_FOUND"
  | "COLLECTION_FILES_READ_ONLY"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "UNSUPPORTED_FILE"
  | "DOCUMENT_NOT_FOUND"
  | "EMBEDDING_SERVICE_NOT_FOUND"
  | "EMBEDDING_SERVICE_IN_USE"
  | "EMBEDDING_SERVICE_READ_ONLY"
  | "CHAT_SERVICE_NOT_FOUND"
  | "CHAT_SERVICE_IN_USE"
  | "CHAT_SERVICE_READ_ONLY"
  | "CHAT_MODEL_MISSING"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = {
  error: string;
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function sendErrorResponse(
  res: Response,
  input: {
    statusCode: number;
    error: string;
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    context?: RequestContext;
  },
): void {
  res.locals.errorCode = input.code;

  const body: ApiErrorResponse = {
    error: input.error,
    code: input.code,
    message: input.message,
    requestId: input.context?.requestId,
    details: input.details,
  };

  res.status(input.statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendErrorResponse(res, {
    statusCode: 404,
    error: "Route not found",
    code: "ROUTE_NOT_FOUND",
    message: `No route matches ${req.method} ${req.path}.`,
    context: res.locals.requestContext as RequestContext | undefined,
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    sendErrorResponse(res, {
      statusCode: error.statusCode,
      error: "Request failed",
      code: error.code,
      message: error.message,
      details: error.details,
      context: res.locals.requestContext as RequestContext | undefined,
    });
    return;
  }

  // Handle generic errors with code property matching ApiErrorCode (e.g. from startReindexJob)
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as any).code === "string"
  ) {
    const code = (error as any).code;
    if (code === "COLLECTION_INDEX_ALREADY_RUNNING") {
      sendErrorResponse(res, {
        statusCode: 409,
        error: "Job Error",
        code: code,
        message: error.message,
        context: res.locals.requestContext as RequestContext | undefined,
      });
      return;
    }
  }

  if (error instanceof RagQueryError) {
    let statusCode = error.statusCode;
    // Map existing rag error codes if necessary
    sendErrorResponse(res, {
      statusCode: statusCode,
      error: "RAG query failed",
      code: error.code as unknown as ApiErrorCode,
      message: error.message,
      details: error.details,
      context: res.locals.requestContext as RequestContext | undefined,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  sendErrorResponse(res, {
    statusCode: 500,
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    message,
    context: res.locals.requestContext as RequestContext | undefined,
  });
}
