// =============================================================================
// Structured Logger Implementation
//
// Structured logging to console and file.
// =============================================================================

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Logger, LogEntry } from "./Logger";

export interface StructuredLoggerOptions {
  console?: boolean | (() => boolean);
  file?: string;
  debug?: boolean;
  write?: (line: string) => unknown;
  sanitize?: (value: unknown) => unknown;
}

type StructuredLoggerSinkState = {
  fileDirectoryReady: boolean;
};

export class StructuredLogger implements Logger {
  private traceId: string | undefined;
  private isDebugMode: boolean;

  constructor(
    private options: StructuredLoggerOptions = {},
    private readonly boundContext: Record<string, unknown> = {},
    private readonly sinkState: StructuredLoggerSinkState = { fileDirectoryReady: false },
  ) {
    this.isDebugMode = options.debug ?? false;
  }

  child(context: Record<string, unknown>): Logger {
    const child = new StructuredLogger(
      this.options,
      { ...this.boundContext, ...context },
      this.sinkState,
    );
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
    // Debug/info stay silent unless debug mode is on; warn/error/fatal always emit.
    if (!this.isDebugMode && level !== "warn" && level !== "error" && level !== "fatal") {
      return;
    }

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

    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    const line = `[${entry.timestamp}] ${level.toUpperCase()}: ${entry.message}${ctx}\n`;

    if (this.isConsoleEnabled()) {
      (this.options.write ?? ((output) => process.stderr.write(output)))(line);
    }

    if (this.options.file) {
      try {
        if (!this.sinkState.fileDirectoryReady) {
          mkdirSync(dirname(this.options.file), { recursive: true });
          this.sinkState.fileDirectoryReady = true;
        }
        appendFileSync(this.options.file, line, "utf8");
      } catch {
        // Preserve playback and shell startup if the debug sink becomes unwritable.
      }
    }
  }

  private isConsoleEnabled(): boolean {
    if (typeof this.options.console === "function") return this.options.console();
    return this.options.console !== false;
  }
}
