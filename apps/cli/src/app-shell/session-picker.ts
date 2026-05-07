import type { OverlayPickerOption, PickerModalOverlayState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";

type PickerOverlayInputBase = {
  readonly options: readonly OverlayPickerOption[];
  readonly selectedIndex?: number;
  readonly filterQuery?: string;
  readonly emptyMessage?: string;
};

type PickerOverlayInput =
  | ({ readonly type: "subtitle_picker" } & PickerOverlayInputBase)
  | ({ readonly type: "source_picker" } & PickerOverlayInputBase)
  | ({ readonly type: "quality_picker" } & PickerOverlayInputBase)
  | ({ readonly type: "season_picker"; readonly currentSeason: number } & PickerOverlayInputBase)
  | ({
      readonly type: "episode_picker";
      readonly season: number;
      readonly initialIndex?: number;
    } & PickerOverlayInputBase);

export type SessionPickerOverlay = PickerModalOverlayState;

let pickerSequence = 0;

export function createSessionPickerId(prefix: string): string {
  pickerSequence += 1;
  return `${prefix}:${pickerSequence}`;
}

export function openSessionPicker(
  stateManager: SessionStateManager,
  picker: PickerOverlayInput & { readonly id?: string },
): Promise<string | null> {
  const id = picker.id ?? createSessionPickerId(picker.type);
  stateManager.dispatch({
    type: "OPEN_PICKER",
    picker: { ...picker, id } as SessionPickerOverlay,
  });
  return waitForSessionPicker(stateManager, id);
}

export function waitForSessionPicker(
  stateManager: SessionStateManager,
  id: string,
): Promise<string | null> {
  const current = stateManager.getState().pickerResult;
  if (current?.id === id) {
    return Promise.resolve(current.type === "selected" ? current.value : null);
  }

  return new Promise<string | null>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      const result = state.pickerResult;
      if (result?.id !== id) return;
      unsubscribe();
      resolve(result.type === "selected" ? result.value : null);
    });
  });
}
