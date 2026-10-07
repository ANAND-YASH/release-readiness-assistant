export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "PACKAGE_INVALID"
  | "NO_CHANGES"
  | "ANALYSIS_BLOCKED"
  | "ANALYSIS_FAILED"
  | "BRIEF_BLOCKED"
  | "APPROVAL_BLOCKED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}
