// Structured JSON logger. One line per event on stdout/stderr so it is readable
// locally and parseable by hosting log drains.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): LogLevel | "silent" {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured === "silent") return configured;
  return configured && configured in LEVEL_ORDER ? (configured as LogLevel) : "info";
}

export function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause !== undefined ? { cause: serializeError(err.cause) } : {}),
    };
  }
  return { value: String(err) };
}

function normalize(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function write(level: LogLevel, event: string, base: LogContext, context?: LogContext) {
  const min = minLevel();
  if (min === "silent" || LEVEL_ORDER[level] < LEVEL_ORDER[min]) return;

  // Reserved fields go last so context can never overwrite them.
  const entry = {
    ...normalize(base),
    ...(context ? normalize(context) : {}),
    ts: new Date().toISOString(),
    level,
    event,
  };

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    // Circular or otherwise unserializable context: keep the event, drop the context.
    line = JSON.stringify({ ts: entry.ts, level, event, logError: "unserializable context" });
  }

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function createLogger(base: LogContext = {}): Logger {
  return {
    debug: (event, context) => write("debug", event, base, context),
    info: (event, context) => write("info", event, base, context),
    warn: (event, context) => write("warn", event, base, context),
    error: (event, context) => write("error", event, base, context),
    child: (context) => createLogger({ ...base, ...context }),
  };
}

export const log = createLogger();
