import type { RootOwnedOverlay } from "./root-shell-state";

/**
 * When false, overlay-level Esc / destructive cancel handlers should defer to
 * the line editor (reference Dialog `isCancelActive={false}` while typing).
 */
export function isOverlayCancelActive(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
}): boolean {
  if (input.overlay.type === "provider_picker" && input.pickerFilterQuery.trim().length > 0) {
    return false;
  }
  return true;
}

export function shouldHandleOverlayEscape(input: {
  readonly overlay: RootOwnedOverlay;
  readonly pickerFilterQuery: string;
}): boolean {
  return isOverlayCancelActive(input);
}
