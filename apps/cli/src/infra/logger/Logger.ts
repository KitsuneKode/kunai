// =============================================================================
// Logger Interface
//
// Structured logging for observability.
// =============================================================================

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;

  // Create a child logger with bound context
  child(context: Record<string, unknown>): Logger;
}
