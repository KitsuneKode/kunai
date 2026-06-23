import type { SettingsChoiceValue } from "./overlay-panel";
import type { RootOwnedOverlay } from "./root-shell-state";
import { isSettingsTextInputChoice } from "./settings-text-input";

export {
  applySettingsTextInput,
  isSettingsTextInputChoice,
  SETTINGS_TEXT_INPUT_CHOICES,
  settingsTextInputPlaceholder,
} from "./settings-text-input";

/**
 * When false, overlay-level Esc / destructive cancel handlers should defer to
 * the line editor (reference Dialog `isCancelActive={false}` while typing).
 */
export function isOverlayCancelActive(input: {
  readonly overlay: RootOwnedOverlay;
  readonly settingsChoice: SettingsChoiceValue | null;
  readonly filterQuery: string;
  readonly pickerFilterQuery: string;
}): boolean {
  if (
    input.overlay.type === "settings" &&
    isSettingsTextInputChoice(input.settingsChoice) &&
    input.filterQuery.trim().length > 0
  ) {
    return false;
  }
  if (input.overlay.type === "provider_picker" && input.pickerFilterQuery.trim().length > 0) {
    return false;
  }
  return true;
}

export function shouldHandleOverlayEscape(input: {
  readonly overlay: RootOwnedOverlay;
  readonly settingsChoice: SettingsChoiceValue | null;
  readonly filterQuery: string;
  readonly pickerFilterQuery: string;
}): boolean {
  return isOverlayCancelActive(input);
}

export function overlayDestructiveCancelMessage(input: {
  readonly overlay: RootOwnedOverlay;
  readonly settingsDirty: boolean;
}): string | null {
  if (input.overlay.type === "settings" && input.settingsDirty) {
    return "Unsaved settings — press Ctrl+C again to discard and close";
  }
  return null;
}
