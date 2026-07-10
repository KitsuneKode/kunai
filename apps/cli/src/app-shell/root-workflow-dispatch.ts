import type { Container } from "@/container";
import { buildUiDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";

import type { ShellAction } from "./types";

type WorkflowModule = typeof import("./workflows");

export async function runRootWorkflowSafely({
  container,
  action,
  cancelPickerId,
  loadWorkflow = () => import("./workflows"),
}: {
  readonly container: Container;
  readonly action: ShellAction;
  readonly cancelPickerId?: string;
  readonly loadWorkflow?: () => Promise<WorkflowModule>;
}): Promise<void> {
  try {
    const { runShellWorkflowFromOverlay } = await loadWorkflow();
    await runShellWorkflowFromOverlay(container, action, { cancelPickerId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown workflow error";
    container.diagnosticsService.record(
      buildUiDiagnosticEvent({
        operation: "shell.workflow.failed",
        status: "failed",
        severity: "recoverable",
        failureClass: "unknown",
        recommendedAction: "export-diagnostics",
        message: `Shell workflow failed: ${action}`,
        context: { action, detail },
      }),
    );
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Could not run ${action}: ${detail}`,
    });
  }
}
