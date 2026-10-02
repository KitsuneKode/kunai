import type { Container } from "@/container";
import { shellModeToProviderLane } from "@/domain/provider-lane";
import type { SessionState } from "@/domain/session/SessionState";
import type { SearchResult } from "@/domain/types";
import { buildUiDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";

import { cancelRootOverlay } from "./cancel-root-overlay";
import { PALETTE_WORKFLOW_ACTIONS } from "./dispatch-palette-command";
import { forceCloseRootContent } from "./root-content-state";
import { openDiagnosticsOverlay } from "./root-overlay-bridge";
import type { BrowseShellResult, ShellAction } from "./types";

type WorkflowModule = typeof import("./workflows");

/**
 * Resolve a palette command from any root surface — overlay host, idle
 * surface, or the error panel. Overlay opens dispatch `OPEN_OVERLAY`; workflow
 * commands go through `runRootWorkflowSafely`. A palette command replaces the
 * overlay it sat on: settle the top through `cancelRootOverlay` so a picker,
 * tracks panel, or queue/history bridge waiter is never left parked on a
 * modal that no longer renders.
 */
export function resolveRootSurfaceCommand({
  container,
  state,
  action,
}: {
  readonly container: Container;
  readonly state: SessionState;
  readonly action: ShellAction;
}): void {
  const settleTopOverlay = () => {
    const top = container.stateManager.getState().activeModals.at(-1);
    if (top) cancelRootOverlay(top, container.stateManager);
  };
  if (
    action === "settings" ||
    action === "presence" ||
    action === "help" ||
    action === "about" ||
    action === "diagnostics" ||
    action === "downloads" ||
    action === "notifications" ||
    action === "continue" ||
    action === "history" ||
    action === "provider"
  ) {
    if (action === "notifications" && !container.featureFlags.attentionInbox) {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Attention inbox is disabled.",
      });
      return;
    }
    settleTopOverlay();
    if (action === "diagnostics") {
      void openDiagnosticsOverlay(container, "diagnostics-overlay-command");
      return;
    }
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay:
        action === "provider"
          ? {
              type: "provider_picker" as const,
              currentProvider: state.provider,
              lane: shellModeToProviderLane(state.mode),
            }
          : action === "history" || action === "continue"
            ? { type: "history" as const, initialFilterMode: "watching" as const }
            : action === "notifications"
              ? { type: "notifications" as const }
              : action === "downloads"
                ? { type: "downloads" as const }
                : action === "settings" || action === "presence"
                  ? { type: "settings" as const }
                  : { type: action },
    });
    return;
  }
  if (action === "library") {
    settleTopOverlay();
    container.stateManager.dispatch({
      type: "OPEN_OVERLAY",
      overlay: { type: "library" as const, view: "library" as const },
    });
    return;
  }
  if (
    PALETTE_WORKFLOW_ACTIONS.has(action) ||
    // Enabled in the rootOverlay context but not in the palette workflow set —
    // they still have real shell-workflow handlers. Without this branch Enter
    // on /up-next, /watch, /playlists, /providers and /image-pane inside any
    // overlay was a silent dead key.
    action === "up-next" ||
    action === "watch" ||
    action === "playlists" ||
    action === "providers" ||
    action === "image-pane"
  ) {
    void runRootWorkflowSafely({ container, action });
  }
}

export async function runRootWorkflowSafely({
  container,
  action,
  loadWorkflow = () => import("./workflows"),
}: {
  readonly container: Container;
  readonly action: ShellAction;
  readonly loadWorkflow?: () => Promise<WorkflowModule>;
}): Promise<void> {
  try {
    const { runShellWorkflowFromOverlay } = await loadWorkflow();
    const result = await runShellWorkflowFromOverlay(container, action);

    // A workflow that asks to start playing something used to be ignored here:
    // the result was awaited and dropped, so the workflow reported success and
    // nothing played. Settle the retained browse session instead — the same
    // channel offline playback and the inbox use to reach the phase loop.
    if (typeof result === "object" && result.type === "history-entry") {
      const settled = forceCloseRootContent<BrowseShellResult<SearchResult>>(
        {
          type: "launch-playback",
          launch: {
            title: result.title,
            episode: result.episode,
            startSeconds: result.startSeconds,
          },
        },
        { kinds: ["browse", "post-playback"] },
      );
      if (!settled) {
        // The mounted session can't consume a launch (picker kind, or nothing
        // mounted) — the pick would otherwise die invisibly and, for a
        // queue-sourced launch, leave the row claimed in-flight forever.
        if (result.title.queuePlaybackIntent) {
          container.queueService.rollbackBeforeStart(result.title.queuePlaybackIntent, {
            code: "handoff-failed",
            stage: "handoff",
            at: new Date().toISOString(),
            detail: "no playback-capable root session for launch",
          });
        }
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "can't launch that title here — close this surface and retry",
        });
      }
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
