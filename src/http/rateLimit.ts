import type { NextFunction, Request, Response } from "express";
import type { ResolvedConfig } from "../config.js";
import { sendErrorResponse } from "./errors.js";
import type { RequestContext } from "./requestContext.js";
import {
  emitOperationalLog,
  getHttpOperationTarget,
  type OperationalLogSink,
} from "../observability/logger.js";

export type RateLimitOperation = "query" | "retrieve" | "reindex";

export type RateLimitInput = {
  tenantId: string;
  userId: string;
  collectionId: string;
  operation: RateLimitOperation;
  nowMs?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterMs?: number;
};

export interface RequestRateLimiter {
  check(input: RateLimitInput): RateLimitDecision;
}

type Bucket = {
  count: number;
  resetAtMs: number;
};

export function createInMemoryRequestRateLimiter(input: {
  enabled: boolean;
  windowMs: number;
  maxRequestsPerWindow: number;
}): RequestRateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    check(request) {
      const key = createRateLimitKey(request);
      const nowMs = request.nowMs ?? Date.now();
      const resetAtMs = nowMs + input.windowMs;

      if (!input.enabled) {
        return {
          allowed: true,
          key,
          limit: input.maxRequestsPerWindow,
          remaining: input.maxRequestsPerWindow,
          resetAt: new Date(resetAtMs).toISOString(),
        };
      }

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAtMs <= nowMs) {
        buckets.set(key, { count: 1, resetAtMs });
        return {
          allowed: true,
          key,
          limit: input.maxRequestsPerWindow,
          remaining: Math.max(0, input.maxRequestsPerWindow - 1),
          resetAt: new Date(resetAtMs).toISOString(),
        };
      }

      if (bucket.count >= input.maxRequestsPerWindow) {
        return {
          allowed: false,
          key,
          limit: input.maxRequestsPerWindow,
          remaining: 0,
          resetAt: new Date(bucket.resetAtMs).toISOString(),
          retryAfterMs: Math.max(0, bucket.resetAtMs - nowMs),
        };
      }

      bucket.count += 1;
      return {
        allowed: true,
        key,
        limit: input.maxRequestsPerWindow,
        remaining: Math.max(0, input.maxRequestsPerWindow - bucket.count),
        resetAt: new Date(bucket.resetAtMs).toISOString(),
      };
    },
  };
}

export function createRateLimitKey(input: RateLimitInput): string {
  return [
    input.tenantId,
    input.userId,
    input.collectionId,
    input.operation,
  ].join(":");
}

export function createRateLimitMiddleware(input: {
  limiter: RequestRateLimiter;
  runtimeConfig: ResolvedConfig;
  logEvent?: OperationalLogSink;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const target = getRateLimitTarget(req);
    if (!target) {
      next();
      return;
    }

    const context = res.locals.requestContext as RequestContext | undefined;
    const decision = input.limiter.check({
      tenantId: context?.tenantId ?? "unknown",
      userId: context?.userId ?? "unknown",
      collectionId: target.collectionId,
      operation: target.operation,
    });

    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", decision.resetAt);

    if (decision.allowed) {
      next();
      return;
    }

    const retryAfterSeconds = Math.ceil((decision.retryAfterMs ?? input.runtimeConfig.rateLimitWindowMs) / 1000);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.locals.collectionId = target.collectionId;
    res.locals.errorCode = "RATE_LIMIT_EXCEEDED";

    emitOperationalLog(input.logEvent, {
      requestId: context?.requestId,
      tenantId: context?.tenantId,
      userId: context?.userId,
      collectionId: target.collectionId,
      operation: target.operation,
      status: "rejected",
      errorCode: "RATE_LIMIT_EXCEEDED",
      details: {
        key: decision.key,
        limit: decision.limit,
        resetAt: decision.resetAt,
        retryAfterMs: decision.retryAfterMs,
      },
    });

    sendErrorResponse(res, {
      statusCode: 429,
      error: "Rate limit exceeded",
      code: "RATE_LIMIT_EXCEEDED",
      message: `Rate limit exceeded for ${target.operation} on collection ${target.collectionId}.`,
      context,
      details: {
        operation: target.operation,
        collectionId: target.collectionId,
        limit: decision.limit,
        remaining: decision.remaining,
        resetAt: decision.resetAt,
        retryAfterMs: decision.retryAfterMs,
      },
    });
  };
}

function getRateLimitTarget(req: Request): { operation: RateLimitOperation; collectionId: string } | null {
  const target = getHttpOperationTarget(req);
  if (!target?.collectionId) {
    return null;
  }

  if (target.operation === "query" || target.operation === "retrieve" || target.operation === "reindex") {
    return {
      operation: target.operation,
      collectionId: target.collectionId,
    };
  }

  return null;
}
