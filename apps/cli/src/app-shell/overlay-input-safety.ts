import type { RootOwnedOverlay } from "./root-shell-state";

/**
 * When false, overlay-level Esc / destructive cancel handlers should defer to
 * the line editor (reference Dialog `isCancelActive={false}` while typing).
 */
export function isOverlayCancelActive(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
  readonly historyConfirmationActive?: boolean;
}): boolean {
  if (input.overlay.type === "history" && input.historyConfirmationActive) {
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
  readonly confirmationActive: boolean;
  readonly sourceChoiceTitleId: string | null;
}): boolean {
  if (input.overlayType !== "history") return true;
  if (input.confirmationActive) return false;
  if (input.sourceChoiceTitleId !== null) return false;
  return true;
}

/** Escape while the palette is open cancels an armed or failed strip and leaves the palette up. */
export function cancelOverlayConfirmationOnEscape(
  overlayType: string,
  history: {
    readonly getState: () => { readonly kind: string };
    readonly transition: (action: { readonly type: "cancel" }) => void;
  },
  queue: {
    readonly getState: () => { readonly kind: string };
    readonly transition: (action: { readonly type: "cancel" }) => void;
  },
): boolean {
  let confirm: typeof history | null = null;
  if (overlayType === "history") confirm = history;
  else if (overlayType === "queue") confirm = queue;
  if (!confirm) return false;
  const kind = confirm.getState().kind;
  if (kind !== "armed" && kind !== "failed") return false;
  confirm.transition({ type: "cancel" });
  return true;
}

export function shouldHandleOverlayEscape(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
}): boolean {
  return isOverlayCancelActive(input);
}
