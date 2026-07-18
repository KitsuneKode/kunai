import type { SessionStateManager } from "@/domain/session/SessionStateManager";

import { hasPendingRootHistorySelection, resolveRootHistorySelection } from "./root-history-bridge";
import { isRootMediaPickerOverlay } from "./root-overlay-model";
import { hasPendingRootQueueSelection, resolveRootQueueSelection } from "./root-queue-bridge";
import type { RootOwnedOverlay } from "./root-shell-state";

/** Cancel a root overlay without orphaning a picker or workflow awaiting its result. */
export function cancelRootOverlay(
  overlay: RootOwnedOverlay,
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
