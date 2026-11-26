import type { ShellPickerOption } from "@/app-shell/types";
import { applyProviderPickerSelection } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import type { NotificationActionId } from "@/services/notifications/NotificationActionRouter";

import type { RowTaps } from "./mouse/row-tap";
import { getSelectedNotificationActionId } from "./notification-overlay-model";
import { isRootMediaPickerOverlay } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";
import type { NotificationsOverlayState } from "./use-notifications-overlay-input";

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
  /** Notifications' action list or play confirmation, when one is open. */
  readonly activateNotificationSubPicker?: ((index: number) => void) | null;
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
  } else if (
    !input.commandMode &&
    overlay.type === "notifications" &&
    input.activateNotificationSubPicker
  ) {
    taps = { select: input.setSelectedIndex, activate: input.activateNotificationSubPicker };
  }
  return { activateProviderOption, activateMediaPickerOption, taps };
}

type NotificationRun = (
  dedupKey: string,
  actionId: NotificationActionId,
  options?: { readonly confirmedContextSwitch?: boolean },
) => void;

/**
 * Enter (or a confirming tap) on Notifications' nested pickers: the "play now?"
 * confirmation, or a notice's action list. Null while neither is open — the
 * inbox rows have their own tap path.
 */
export function createNotificationSubPickerActivation(input: {
  readonly playConfirm: {
    readonly dedupKey: string;
    readonly actionId: NotificationActionId;
  } | null;
  readonly playConfirmOptions: readonly { readonly value: "confirm" | "cancel" }[];
  readonly actionDedupKey: string | null;
  readonly actionOptions: readonly ShellPickerOption<NotificationActionId>[];
  readonly run: NotificationRun;
  readonly clearPlayConfirm: () => void;
  readonly closeActionPicker: () => void;
}): ((index: number) => void) | null {
  const { playConfirm, actionDedupKey } = input;
  if (playConfirm) {
    return (index) => {
      if ((input.playConfirmOptions[index]?.value ?? "cancel") === "confirm") {
        input.run(playConfirm.dedupKey, playConfirm.actionId, { confirmedContextSwitch: true });
      } else {
        input.clearPlayConfirm();
      }
    };
  }
  if (actionDedupKey) {
    return (index) => {
      const actionId = getSelectedNotificationActionId(input.actionOptions, index);
      if (!actionId) return;
      input.run(actionDedupKey, actionId);
      input.closeActionPicker();
    };
  }
  return null;
}

/**
 * Notifications inbox rows. A tap selects by identity, exactly as ↑/↓ do (the
 * inbox re-sorts, so an index would retarget); a confirming tap is Enter.
 */
export function createNotificationInboxTaps(input: {
  readonly commandMode: boolean;
  readonly rows: readonly { readonly dedupKey: string }[];
  readonly run: (dedupKey: string | null | undefined) => void;
  readonly setState: (
    update: (state: NotificationsOverlayState) => NotificationsOverlayState,
  ) => void;
}): RowTaps | null {
  if (input.commandMode) return null;
  return {
    select: (index) => {
      const dedupKey = input.rows[index]?.dedupKey;
      if (dedupKey) input.setState((state) => ({ ...state, selectedDedupKey: dedupKey }));
    },
    activate: (index) => input.run(input.rows[index]?.dedupKey),
  };
}
