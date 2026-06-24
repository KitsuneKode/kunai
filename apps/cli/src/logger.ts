// Structured debug logger.
//
// Enabled by:   --debug flag  OR  KITSUNE_DEBUG=1 env var
// Output goes to stderr so it never pollutes stdout / @clack prompts.
// Routed through StructuredLogger when bound at container bootstrap.
//
// Usage:
//   import { dbg } from "./logger";
//   dbg("scraper", "m3u8 found", { url });

import type { Logger } from "./infra/logger/Logger";

let _debugEnabled = false;
let _structuredLogger: Logger | null = null;

export function initLogger(enabled: boolean, structuredLogger?: Logger): void {
  _debugEnabled = enabled;
  if (structuredLogger) {
    _structuredLogger = structuredLogger;
  }
}

export function dbg(module: string, msg: string, data?: Record<string, unknown>): void {
  if (!_debugEnabled) return;
  if (_structuredLogger) {
    _structuredLogger.child({ module }).debug(msg, data);
    return;
  }
  const line = JSON.stringify({
    t: new Date().toISOString(),
    module,
    msg,
    ...data,
  });
  process.stderr.write(`[debug] ${line}\n`);
}

export function dbgErr(module: string, msg: string, err: unknown): void {
  if (!_debugEnabled) return;
  if (_structuredLogger) {
    _structuredLogger.child({ module }).error(msg, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return;
  }
  dbg(module, msg, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}
