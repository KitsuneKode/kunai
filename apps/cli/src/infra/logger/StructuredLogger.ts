// =============================================================================
// Structured Logger Implementation
//
// Structured logging to console and file.
// =============================================================================

import type { Logger, LogEntry } from "./Logger";

export interface StructuredLoggerOptions {
  console?: boolean;
  file?: string;
  debug?: boolean;
  write?: (line: string) => unknown;
  sanitize?: (value: unknown) => unknown;
}

export class StructuredLogger implements Logger {
  private traceId: string | undefined;
  private isDebugMode: boolean;

  constructor(
    private options: StructuredLoggerOptions = {},
    private readonly boundContext: Record<string, unknown> = {},
  ) {
    this.isDebugMode = options.debug ?? false;
  }

  child(context: Record<string, unknown>): Logger {
    const child = new StructuredLogger(this.options, { ...this.boundContext, ...context });
    return child;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log("fatal", message, context);
  }

  private log(level: LogEntry["level"], message: string, context?: Record<string, unknown>): void {
    // Silent by default - only log in debug mode
    if (!this.isDebugMode) return;

    const mergedContext =
      Object.keys(this.boundContext).length || context
        ? { ...this.boundContext, ...context }
        : undefined;
    const sanitizedMessage = this.options.sanitize?.(message) ?? message;
    const sanitizedContext = this.options.sanitize?.(mergedContext) ?? mergedContext;
    const serializedMessage =
      typeof sanitizedMessage === "string" ? sanitizedMessage : String(sanitizedMessage);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: serializedMessage,
      context: sanitizedContext as Record<string, unknown> | undefined,
      traceId: this.traceId,
    };

    if (this.options.console !== false) {
      const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
      const line = `[${entry.timestamp}] ${level.toUpperCase()}: ${entry.message}${ctx}\n`;
      (this.options.write ?? ((output) => process.stderr.write(output)))(line);
    }

    // File logging would go here
  }
}
