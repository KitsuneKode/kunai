import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import { buildUiDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";

import { forceCloseRootContent } from "./root-content-state";
import type { BrowseShellResult, ShellAction } from "./types";

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
    const result = await runShellWorkflowFromOverlay(container, action, { cancelPickerId });

    // A workflow that asks to start playing something used to be ignored here:
    // the result was awaited and dropped, so the workflow reported success and
    // nothing played. Settle the retained browse session instead — the same
    // channel offline playback and the inbox use to reach the phase loop.
    if (typeof result === "object" && result.type === "history-entry") {
      forceCloseRootContent<BrowseShellResult<SearchResult>>({
        type: "launch-playback",
        launch: { title: result.title, ...(result.episode ? { episode: result.episode } : {}) },
      });
    }
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
