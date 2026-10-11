import type { OverlayState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";

import { hasPendingRootHistorySelection, resolveRootHistorySelection } from "./root-history-bridge";
import { isRootMediaPickerOverlay } from "./root-overlay-model";
import { hasPendingRootQueueSelection, resolveRootQueueSelection } from "./root-queue-bridge";

/** Cancel a root overlay without orphaning a picker or workflow awaiting its result. */
export function cancelRootOverlay(
  overlay: OverlayState,
  stateManager: Pick<SessionStateManager, "dispatch">,
): void {
  if (isRootMediaPickerOverlay(overlay) && overlay.id) {
    stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
    return;
  }

  if (overlay.type === "tracks_panel") {
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

/**
 * Dismiss the whole overlay stack, settling every waiter it owes first —
 * bridge selections and media-picker promises each get the same null/cancel
 * they would see from an individual Esc. Used by "take me there" actions that
 * deliver an action to the session underneath the stack.
 */
export function cancelAllRootOverlays(
  overlays: readonly OverlayState[],
  stateManager: Pick<SessionStateManager, "dispatch">,
): void {
  for (const overlay of overlays) {
    if ((isRootMediaPickerOverlay(overlay) || overlay.type === "tracks_panel") && overlay.id) {
      stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
    }
    if (overlay.type === "history" && hasPendingRootHistorySelection()) {
      resolveRootHistorySelection(null);
    }
    if (overlay.type === "queue" && hasPendingRootQueueSelection()) {
      resolveRootQueueSelection(null);
    }
  }
  stateManager.dispatch({ type: "CLOSE_ALL_OVERLAYS" });
}
