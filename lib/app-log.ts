// Persists important application events to the AppLog table, in addition to
// stdout. Persistence is best-effort: a logging failure never fails a request.
//
// Callers pass identifiers, counts, codes and durations only, never package
// contents, request bodies or raw error messages, which may contain user data or
// connection strings.

import type { Prisma } from "@/lib/generated/prisma/client";
import { getDb } from "@/lib/db";
import { log as rootLog, type LogContext, type Logger, type LogLevel } from "@/lib/log";

export interface AppLogEntry {
  level: LogLevel;
  event: string;
  requestId?: string;
  releaseId?: string;
  context?: LogContext;
}

const DB_LEVEL = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" } as const;

export async function persistAppLog(entry: AppLogEntry, logger: Logger = rootLog): Promise<void> {
  try {
    await getDb().appLog.create({
      data: {
        level: DB_LEVEL[entry.level],
        event: entry.event,
        requestId: entry.requestId,
        releaseId: entry.releaseId,
        context: (entry.context ?? {}) as Prisma.InputJsonObject,
      },
    });
  } catch (err) {
    logger.warn("app_log.persist_failed", {
      failedEvent: entry.event,
      error: { name: err instanceof Error ? err.name : "unknown" },
    });
  }
}

/** Log to stdout and persist to AppLog. */
export async function recordEvent(logger: Logger, entry: AppLogEntry): Promise<void> {
  logger[entry.level](entry.event, { ...(entry.releaseId ? { releaseId: entry.releaseId } : {}), ...entry.context });
  await persistAppLog(entry, logger);
}
