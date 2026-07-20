import type { RootOwnedOverlay } from "./root-shell-state";
import type { HistoryDeletePending } from "./use-history-overlay-input";

/**
 * When false, overlay-level Esc / destructive cancel handlers should defer to
 * the line editor (reference Dialog `isCancelActive={false}` while typing).
 */
export function isOverlayCancelActive(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
  readonly historyPendingDelete?: HistoryDeletePending | null;
}): boolean {
  if (input.overlay.type === "history" && input.historyPendingDelete) {
    return true;
  }
  if (input.overlay.type === "provider_picker" && input.pickerFilterQuery.trim().length > 0) {
    return false;
  }
  return true;
}

/** History filter typing is disabled while delete confirm or source choice owns focus. */
export function shouldHistoryOverlayAcceptFilterInput(input: {
  readonly overlayType: RootOwnedOverlay["type"];
  readonly pendingDelete: HistoryDeletePending | null;
  readonly sourceChoiceTitleId: string | null;
}): boolean {
  if (input.overlayType !== "history") return true;
  if (input.pendingDelete !== null) return false;
  if (input.sourceChoiceTitleId !== null) return false;
  return true;
}

export function shouldHandleOverlayEscape(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
}): boolean {
  return isOverlayCancelActive(input);
}
