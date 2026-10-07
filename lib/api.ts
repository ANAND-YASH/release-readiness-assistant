// API envelope shared by every route handler.
//   success: { data }
//   failure: { error: { code, message, details?, requestId } }

import { z } from "zod";
import { persistAppLog } from "@/lib/app-log";
import { errorKind, mapDbError } from "@/lib/db-errors";
import { ApiError, type ErrorCode } from "@/lib/errors";
import { createLogger, type LogContext, type Logger } from "@/lib/log";

export { ApiError, type ErrorCode };

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId: string };
}

export interface ApiSuccessBody<T> {
  data: T;
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data } satisfies ApiSuccessBody<T>, { status });
}

/** Parse a JSON request body against a Zod schema, throwing ApiError on failure. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON");
  }
  return parseOrThrow(schema, body, "Request body failed validation");
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, message: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", message, formatZodIssues(parsed.error));
  }
  return parsed.data;
}

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export interface RequestAnnotations {
  releaseId?: string;
  versionNumber?: number;
}

export interface HandlerContext {
  requestId: string;
  log: Logger;
  /** Attach identifiers to this request's completion log entry. */
  annotate(annotations: RequestAnnotations): void;
}

const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

function resolveRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return (
    mapDbError(err) ??
    new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred", undefined, { cause: err })
  );
}

function errorResponse(apiError: ApiError, requestId: string): Response {
  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
      requestId,
    },
  };
  return Response.json(body, { status: apiError.status });
}

/**
 * Wraps a route handler with request id propagation, structured request logging
 * and conversion of thrown errors into the error envelope. Internal error details
 * are logged server-side, never returned to the client.
 *
 * Mutating requests and all server errors are also persisted to AppLog.
 */
export function withApiHandler<Ctx>(
  route: string,
  handler: (req: Request, ctx: Ctx, hc: HandlerContext) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = resolveRequestId(req);
    const reqLog = createLogger({ requestId, route, method: req.method });
    const annotations: RequestAnnotations = {};
    const started = performance.now();

    let response: Response;
    let failure: ApiError | undefined;
    try {
      response = await handler(req, ctx, {
        requestId,
        log: reqLog,
        annotate: (a) => Object.assign(annotations, a),
      });
    } catch (err) {
      failure = toApiError(err);
      response = errorResponse(failure, requestId);
    }

    response.headers.set("x-request-id", requestId);

    const durationMs = Math.round(performance.now() - started);
    const outcome = !failure ? "success" : failure.status >= 500 ? "error" : "rejected";
    const summary: LogContext = { status: response.status, durationMs, outcome, ...annotations };

    if (outcome === "error") {
      reqLog.error("api.request.failed", { ...summary, code: failure!.code, error: failure!.cause ?? failure });
    } else if (outcome === "rejected") {
      reqLog.warn("api.request.rejected", { ...summary, code: failure!.code, message: failure!.message });
    } else {
      reqLog.info("api.request.completed", summary);
    }

    if (req.method !== "GET" || outcome === "error") {
      await persistAppLog(
        {
          level: outcome === "error" ? "error" : outcome === "rejected" ? "warn" : "info",
          event: `api.request.${outcome === "success" ? "completed" : outcome === "error" ? "failed" : "rejected"}`,
          requestId,
          releaseId: annotations.releaseId,
          context: {
            route,
            method: req.method,
            ...summary,
            ...(failure ? { code: failure.code, error: errorKind(failure.cause ?? failure) } : {}),
          },
        },
        reqLog,
      );
    }
    return response;
  };
}
