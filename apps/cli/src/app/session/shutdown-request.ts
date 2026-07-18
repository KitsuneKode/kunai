// =============================================================================
// Shutdown request bridge — how Ink surfaces ask the app to exit.
//
// Shell components must never call process.exit() or own cleanup sequencing;
// they request shutdown here and main.ts binds the coordinator as the single
// handler. The bridge is process-local so the shell never imports main.ts.
// =============================================================================

import type { ShutdownIntent } from "./shutdown-coordinator";

export type ShutdownRequestHandler = (intent: ShutdownIntent) => void | Promise<void>;

let handler: ShutdownRequestHandler | null = null;
let binding = 0;

export function bindShutdownRequestHandler(next: ShutdownRequestHandler): () => void {
  const token = ++binding;
  handler = next;
  return () => {
    if (binding === token) handler = null;
  };
}

export function requestAppShutdown(intent: Partial<ShutdownIntent> = {}): void {
  const normalized: ShutdownIntent = {
    reason: intent.reason ?? "shell-quit",
    exitCode: intent.exitCode ?? 0,
    fatal: intent.fatal ?? false,
  };
  if (handler) {
    void handler(normalized);
    return;
  }
  // Not bound yet (very early startup): fall back to the signal path so the
  // process-level handler still runs a coordinated exit. Never exit directly.
  process.kill(process.pid, "SIGINT");
}
