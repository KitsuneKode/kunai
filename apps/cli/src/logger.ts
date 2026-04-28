// Structured debug logger.
//
// Enabled by:   --debug flag  OR  KITSUNE_DEBUG=1 env var
// Output goes to stderr so it never pollutes stdout / @clack prompts.
// Each line contains a JSON payload after the `[debug]` prefix:
//   bun run dev -- --debug 2> debug.log
//
// Usage:
//   import { dbg } from "./lib/logger";
//   dbg("scraper", "m3u8 found", { url });

let _debugEnabled = false;

export function initLogger(enabled: boolean) {
  _debugEnabled = enabled;
}

export function dbg(module: string, msg: string, data?: Record<string, unknown>) {
  if (!_debugEnabled) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    module,
    msg,
    ...data,
  });
  process.stderr.write(`[debug] ${line}\n`);
}

export function dbgErr(module: string, msg: string, err: unknown) {
  if (!_debugEnabled) return;
  dbg(module, msg, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}
