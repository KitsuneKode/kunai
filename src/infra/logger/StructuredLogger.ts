// =============================================================================
// Structured Logger Implementation
//
// Structured logging to console and file.
// =============================================================================

import type { Logger, LogEntry } from "./Logger";

export interface StructuredLoggerOptions {
  console?: boolean;
  file?: string;
}

export class StructuredLogger implements Logger {
  private traceId: string | undefined;
  
  constructor(private options: StructuredLoggerOptions = {}) {}
  
  child(context: Record<string, unknown>): Logger {
    const child = new StructuredLogger(this.options);
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
  
  private log(
    level: LogEntry["level"],
    message: string,
    context?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      traceId: this.traceId,
    };
    
    if (this.options.console !== false) {
      const ctx = context ? ` ${JSON.stringify(context)}` : "";
      console.log(`[${entry.timestamp}] ${level.toUpperCase()}: ${message}${ctx}`);
    }
    
    // File logging would go here
  }
}
