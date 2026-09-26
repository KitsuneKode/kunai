// =============================================================================
// Structured Logger Implementation
//
// Structured logging to console and file.
// =============================================================================

import {
  appendFileSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";

import type { Logger, LogEntry } from "./Logger";

export interface StructuredLoggerOptions {
  console?: boolean | (() => boolean);
  file?: string;
  /** Rotation threshold for the file sink; defaults to {@link LOG_FILE_MAX_BYTES}. */
  fileMaxBytes?: number;
  debug?: boolean;
  write?: (line: string) => unknown;
  sanitize?: (value: unknown) => unknown;
}

/**
 * Owner-only. The file carries everything the session touched — titles,
 * providers, paths — so the umask default (644 on most machines) made a
 * world-readable watch history in the working directory.
 */
const LOG_FILE_MODE = 0o600;

/**
 * The debug log is bounded to the live file plus one `.old` generation;
 * verbose sessions used to grow `logs.txt` without limit.
 */
export const LOG_FILE_MAX_BYTES = 4 * 1024 * 1024;

type StructuredLoggerSinkState = {
  fileReady: boolean;
  approxBytes: number;
};

export class StructuredLogger implements Logger {
  private traceId: string | undefined;
  private isDebugMode: boolean;

  constructor(
    private options: StructuredLoggerOptions = {},
    private readonly boundContext: Record<string, unknown> = {},
    private readonly sinkState: StructuredLoggerSinkState = { fileReady: false, approxBytes: 0 },
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
        this.appendToFile(this.options.file, line);
      } catch {
        // Preserve playback and shell startup if the debug sink becomes unwritable.
      }
    }
  }

  /**
   * Bring the file into existence with owner-only permissions and seed the
   * size counter from what's already there. `fchmodSync` is not redundant with
   * the create mode — the mode argument only applies to a *new* file, and a
   * `logs.txt` written before this rule exists stays world-readable until it
   * is tightened.
   */
  private ensureFileSink(file: string): void {
    mkdirSync(dirname(file), { recursive: true });
    const fd = openSync(file, "a", LOG_FILE_MODE);
    try {
      fchmodSync(fd, LOG_FILE_MODE);
    } finally {
      closeSync(fd);
    }
    this.sinkState.approxBytes = statSync(file).size;
    this.sinkState.fileReady = true;
  }

  private appendToFile(file: string, line: string): void {
    if (!this.sinkState.fileReady) this.ensureFileSink(file);
    const lineBytes = Buffer.byteLength(line, "utf8");
    const maxBytes = this.options.fileMaxBytes ?? LOG_FILE_MAX_BYTES;
    if (this.sinkState.approxBytes + lineBytes > maxBytes) {
      // `rename` cannot overwrite on Windows — drop the previous generation
      // first. The fresh file is re-created by ensureFileSink at LOG_FILE_MODE.
      try {
        unlinkSync(`${file}.old`);
      } catch {
        // Nothing stale to remove.
      }
      renameSync(file, `${file}.old`);
      this.sinkState.fileReady = false;
      this.ensureFileSink(file);
    }
    // The mode applies only when append creates the file — which happens if
    // the live log was deleted mid-session. Without it, the recreation would
    // silently come back world-readable.
    appendFileSync(file, line, { encoding: "utf8", mode: LOG_FILE_MODE });
    this.sinkState.approxBytes += lineBytes;
  }

  private isConsoleEnabled(): boolean {
    if (typeof this.options.console === "function") return this.options.console();
    return this.options.console !== false;
  }
}
