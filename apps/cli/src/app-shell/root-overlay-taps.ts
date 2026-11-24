import { applyProviderPickerSelection } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";

import { isRootMediaPickerOverlay } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";

/** Where a tap on a list row goes: move the cursor, or act like Enter. */
export type RowTaps = {
  readonly select: (index: number) => void;
  readonly activate: (index: number) => void;
};

/**
 * Picker actions shared by Enter and by taps, so a tap on a phone (Termux sends
 * taps as clicks) runs exactly the path the keyboard does.
 */
export function createRootPickerActions(input: {
  readonly container: Container;
  readonly overlay: RootOwnedOverlay;
  readonly commandMode: boolean;
  readonly pickerSelectedIndex: number;
  readonly providerOptions: readonly { readonly value: string }[];
  readonly mediaPickerOptions: readonly { readonly value: string }[];
  readonly setSelectedIndex: (index: number) => void;
}) {
  const { container, overlay } = input;
  const activateProviderOption = (index: number): void => {
    const picked = input.providerOptions[index]?.value;
    if (picked) {
      void applyProviderPickerSelection({
        container,
        pickedProviderId: picked,
        reason: "provider-picker-switch",
      });
    }
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  };
  const activateMediaPickerOption = (index: number): void => {
    const picked = input.mediaPickerOptions[index]?.value;
    if (!picked || !isRootMediaPickerOverlay(overlay) || !overlay.id) return;
    container.stateManager.dispatch({ type: "RESOLVE_PICKER", id: overlay.id, value: picked });
  };

  let taps: RowTaps | null = null;
  if (!input.commandMode && overlay.type === "provider_picker") {
    taps = { select: input.setSelectedIndex, activate: activateProviderOption };
  } else if (!input.commandMode && isRootMediaPickerOverlay(overlay) && overlay.id) {
    const id = overlay.id;
    taps = {
      // Media picker selection lives in session state and moves by delta.
      select: (index) =>
        container.stateManager.dispatch({
          type: "MOVE_PICKER_SELECTION",
          id,
          delta: index - input.pickerSelectedIndex,
        }),
      activate: activateMediaPickerOption,
    };
  }
  return { activateProviderOption, activateMediaPickerOption, taps };
}
