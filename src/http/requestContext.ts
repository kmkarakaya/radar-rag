import { randomUUID } from "node:crypto";
import type { Request } from "express";

export type RequestContext = {
  requestId: string;
  tenantId: string;
  userId: string;
};

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function createRequestContext(req: Request): RequestContext {
  return {
    requestId: readHeaderValue(req.headers["x-request-id"])?.trim() || randomUUID(),
    tenantId: readHeaderValue(req.headers["x-tenant-id"])?.trim() || "default",
    userId: readHeaderValue(req.headers["x-user-id"])?.trim() || "local-dev",
  };
}
