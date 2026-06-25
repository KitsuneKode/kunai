import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import type { SettingsInputMode, SettingsUiState } from "./types";

export function createSettingsUiState(snapshot: KitsuneConfig): SettingsUiState {
  return {
    draft: snapshot,
    snapshot,
    submenuId: null,
    parentIndex: 0,
    inputMode: { active: false },
    searchQuery: "",
    activeSectionIndex: 0,
    selectedIndex: 0,
    error: null,
    busy: false,
  };
}

export function patchSettingsDraft(
  state: SettingsUiState,
  patch: (draft: KitsuneConfig) => KitsuneConfig,
): SettingsUiState {
  return { ...state, draft: patch(state.draft), error: null };
}

export function enterSettingsInputMode(
  state: SettingsUiState,
  settingId: string,
  seed: string,
  initialBuffer?: string,
): SettingsUiState {
  return {
    ...state,
    submenuId: null,
    inputMode: {
      active: true,
      settingId,
      seed,
      buffer: initialBuffer ?? seed,
    },
    error: null,
  };
}

export function exitSettingsInputMode(state: SettingsUiState, _revert: boolean): SettingsUiState {
  if (!state.inputMode.active) return state;
  return {
    ...state,
    inputMode: { active: false },
    error: null,
  };
}

export function updateInputBuffer(state: SettingsUiState, buffer: string): SettingsUiState {
  if (!state.inputMode.active) return state;
  return { ...state, inputMode: { ...state.inputMode, buffer } };
}

export function enterSettingsSubmenu(
  state: SettingsUiState,
  submenuId: string,
  parentIndex: number,
): SettingsUiState {
  return {
    ...state,
    submenuId,
    parentIndex,
    inputMode: { active: false },
    searchQuery: "",
    selectedIndex: 0,
    error: null,
  };
}

export function exitSettingsSubmenu(state: SettingsUiState): SettingsUiState {
  return {
    ...state,
    submenuId: null,
    searchQuery: "",
    selectedIndex: state.parentIndex,
    error: null,
  };
}

export function isSettingsInputActive(
  mode: SettingsInputMode,
): mode is Extract<SettingsInputMode, { active: true }> {
  return mode.active;
}
