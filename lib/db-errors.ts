// Maps Prisma / driver errors to safe API errors. Anything unrecognised is
// left to the generic 500 handler.

import { Prisma } from "@/lib/generated/prisma/client";
import { ApiError } from "@/lib/errors";

// Prisma connection codes plus raw driver codes surfaced by @prisma/adapter-pg.
const UNAVAILABLE_CODES = new Set([
  "P1001",
  "P1002",
  "P1017",
  "P2024",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

function driverErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function mapDbError(err: unknown): ApiError | undefined {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new ApiError(503, "SERVICE_UNAVAILABLE", "Database is unavailable", undefined, { cause: err });
  }
  // Connection failures while starting an interactive transaction surface as raw
  // pg-pool errors (e.g. an AggregateError with code ECONNREFUSED), not Prisma errors.
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) && UNAVAILABLE_CODES.has(driverErrorCode(err) ?? "")) {
    return new ApiError(503, "SERVICE_UNAVAILABLE", "Database is unavailable", undefined, { cause: err });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (UNAVAILABLE_CODES.has(err.code)) {
      return new ApiError(503, "SERVICE_UNAVAILABLE", "Database is unavailable", undefined, { cause: err });
    }
    if (err.code === "P2002") {
      return new ApiError(409, "CONFLICT", "The record was modified concurrently. Reload and try again.", undefined, {
        cause: err,
      });
    }
    if (err.code === "P2025") {
      return new ApiError(404, "NOT_FOUND", "Record not found", undefined, { cause: err });
    }
  }
  return undefined;
}

/** Stable, non-sensitive description of an error for persisted logs. */
export function errorKind(err: unknown): { name: string; code?: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return { name: err.name, code: err.code };
  if (err instanceof ApiError) return { name: err.name, code: err.code };
  const code = driverErrorCode(err);
  return { name: err instanceof Error ? err.name : "unknown", ...(code ? { code } : {}) };
}
