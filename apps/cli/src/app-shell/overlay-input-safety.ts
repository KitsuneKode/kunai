import { isListBackKey } from "./input-router";
import type { LineEditorKey } from "./line-editor";
import { isRootChoiceOverlay } from "./root-overlay-model";
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

/** Overlays where printable keys feed the shared line-editor filter before list chords. */
export function rootOverlayAcceptsTypedFilter(input: {
  readonly overlay: RootOwnedOverlay;
  readonly notificationPlayConfirm?: boolean;
  readonly notificationActionDedupKey?: string | null;
  readonly pendingDelete?: HistoryDeletePending | null;
  readonly sourceChoiceTitleId?: string | null;
}): boolean {
  if (!isRootChoiceOverlay(input.overlay)) return false;
  if (input.overlay.type === "settings") return false;
  if (
    input.overlay.type === "notifications" &&
    (input.notificationPlayConfirm || input.notificationActionDedupKey)
  ) {
    return false;
  }
  if (input.overlay.type === "history") {
    return shouldHistoryOverlayAcceptFilterInput({
      overlayType: "history",
      pendingDelete: input.pendingDelete ?? null,
      sourceChoiceTitleId: input.sourceChoiceTitleId ?? null,
    });
  }
  return true;
}

/**
 * Esc always participates in the overlay back stack. Bare `q` backs out where
 * nothing can be typed, and on letter-command overlays (History) while the
 * filter is empty; in pure type-to-filter pickers it is always a filter letter.
 */
export function isOverlayListBackKey(
  input: string,
  key: LineEditorKey,
  context: {
    readonly acceptsTypedFilter: boolean;
    readonly filterQuery: string;
    /**
     * The overlay also binds bare letters as commands (History: u/m/w), so its
     * filter can never start with those letters anyway. There `q` is one more
     * command: back, while the filter is empty.
     */
    readonly lettersAreCommands?: boolean;
  },
): boolean {
  if (!isListBackKey(input, key)) return false;
  if (key.escape) return true;
  if (!context.acceptsTypedFilter) return true;
  if (context.lettersAreCommands) return context.filterQuery.length === 0;
  // A pure type-to-filter picker owns every printable key, `q` included — even
  // on an empty filter, or no filter could ever start with "q" ("Queen's
  // Gambit"). Esc is the way out there.
  return false;
}
