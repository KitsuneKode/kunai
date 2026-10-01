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

/**
 * Whether the overlay's shared line editor may consume this keystroke.
 *
 * Only surfaces that render a filter field may eat printable input. The queue
 * and the notifications inbox have none, so letters there are actions or inert
 * — feeding them to an unseen editor parked keystrokes in state nothing read,
 * and made the first Esc clear an invisible filter instead of closing. The
 * episode picker and history do render a filter, but only while their text
 * zone owns printable keys (focus-zone model); in the list zone letters are
 * actions. `y`/`l`/`s`/`x` while a history confirm owns focus must never reach
 * the editor either.
 */
export function shouldOverlayAcceptFilterInput(input: {
  readonly overlayType: RootOwnedOverlay["type"];
  /** True while the surface's text zone owns printable keys. */
  readonly textZoneActive: boolean;
  /** Notifications: only the nested action picker renders a filter field. */
  readonly notificationActionPickerActive: boolean;
  readonly historyPendingDelete: HistoryDeletePending | null;
  readonly historySourceChoiceTitleId: string | null;
}): boolean {
  switch (input.overlayType) {
    case "provider_picker":
    case "season_picker":
    case "subtitle_picker":
    case "recommendation_picker":
    case "list_picker":
      // No bare-letter actions on these pickers — the field is always live.
      return true;
    case "episode_picker":
      return input.textZoneActive;
    case "history":
      return (
        input.textZoneActive &&
        input.historyPendingDelete === null &&
        input.historySourceChoiceTitleId === null
      );
    case "notifications":
      return input.notificationActionPickerActive;
    default:
      return false;
  }
}

export function shouldHandleOverlayEscape(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
}): boolean {
  return isOverlayCancelActive(input);
}
