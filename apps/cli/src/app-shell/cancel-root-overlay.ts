import type { OverlayState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";

import { hasPendingRootHistorySelection, resolveRootHistorySelection } from "./root-history-bridge";
import { isRootMediaPickerOverlay } from "./root-overlay-model";
import { hasPendingRootQueueSelection, resolveRootQueueSelection } from "./root-queue-bridge";

/**
 * Close a shell overlay without orphaning whatever awaits its result.
 * The only safe way to remove a top overlay: media pickers and the
 * tracks panel settle `pickerResult` waiters, and history/queue settle
 * their bridge resolvers, before the modal itself pops. Every removal
 * path — Esc, palette workflows, setup, launch handoff — must route
 * through here; a bare CLOSE_TOP_OVERLAY leaves the waiter parked
 * forever and (for the queue/history bridges) leaves a stale resolver
 * that misroutes the next selection.
 */
export function cancelRootOverlay(
  overlay: OverlayState,
  stateManager: Pick<SessionStateManager, "dispatch">,
): void {
  if (isRootMediaPickerOverlay(overlay) && overlay.id) {
    stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
    return;
  }

  if (overlay.type === "tracks_panel") {
    stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
    return;
  }

  if (overlay.type === "history" && hasPendingRootHistorySelection()) {
    resolveRootHistorySelection(null);
  }
  if (overlay.type === "queue" && hasPendingRootQueueSelection()) {
    resolveRootQueueSelection(null);
  }
  stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
}
