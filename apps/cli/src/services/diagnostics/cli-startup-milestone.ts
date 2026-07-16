import { buildDiagnosticEvent } from "./diagnostic-event-helpers";
import type { DiagnosticsService } from "./DiagnosticsService";

export type CliStartupMilestone =
  | "shell-module-loaded"
  | "shell-mounted"
  | "browse-mounted"
  | "idle-context-ready"
  | "idle-context-failed";

export function recordCliStartupMilestone(
  diagnostics: Pick<DiagnosticsService, "record">,
  milestone: CliStartupMilestone,
): void {
  const failed = milestone === "idle-context-failed";
  diagnostics.record(
    buildDiagnosticEvent({
      category: "session",
      operation: `session.startup.${milestone}`,
      status: failed ? "failed" : "succeeded",
      severity: failed ? "recoverable" : "healthy",
      recommendedAction: "none",
      message: `CLI startup milestone: ${milestone}`,
      context: { elapsedMs: Math.round(performance.now()) },
    }),
  );
}
