import { buildSettingsPage, listSettingsSectionLabels } from "./build-page";
import { buildSettingsSubmenuView } from "./build-submenu";
import {
  activateSettingsSelection,
  activateSettingsSubmenuSelection,
  type SettingsKeyContext,
  type SettingsKeyResult,
} from "./controller";
import { firstSelectableRowIndex, selectableSettingsRows } from "./navigation";
import type { SettingsUiState } from "./types";

export type SettingsPointerEvent =
  | { readonly type: "row"; readonly id: string }
  | { readonly type: "choice"; readonly value: string }
  | { readonly type: "section"; readonly index: number }
  | { readonly type: "search" }
  | { readonly type: "scroll"; readonly direction: "up" | "down" };

/** Pointer focus is explicit; clicks never masquerade as consent keystrokes. */
export function handleSettingsPointer(
  event: SettingsPointerEvent,
  state: SettingsUiState,
  ctx: SettingsKeyContext,
): SettingsKeyResult {
  if (state.busy || state.inputMode.active) return { handled: false, state };
  const page = buildSettingsPage(ctx.registryCtx, {
    searchQuery: state.searchQuery,
    activeSectionIndex: state.activeSectionIndex,
  });
  if (state.submenuId) {
    const submenu = buildSettingsSubmenuView(state.submenuId, ctx.registryCtx, page.defById);
    if (!submenu) return { handled: false, state };
    const choices = submenu.choices;
    if (event.type === "scroll") {
      return {
        handled: true,
        state: {
          ...state,
          selectedIndex: Math.max(
            0,
            Math.min(choices.length - 1, state.selectedIndex + (event.direction === "up" ? -1 : 1)),
          ),
        },
      };
    }
    if (event.type !== "choice") return { handled: false, state };
    const index = choices.findIndex((choice) => choice.value === event.value);
    if (index < 0) return { handled: false, state };
    if (index !== state.selectedIndex)
      return { handled: true, state: { ...state, selectedIndex: index } };
    if (page.defById.get(state.submenuId)?.kind === "reorder")
      return { handled: true, state, statusMessage: "Use [ and ] to reorder providers" };
    return activateSettingsSubmenuSelection(state, ctx);
  }
  if (event.type === "section") {
    const labels = listSettingsSectionLabels(ctx.registryCtx);
    if (!Number.isInteger(event.index) || event.index < 0 || event.index >= labels.length)
      return { handled: false, state };
    const next = {
      ...state,
      activeSectionIndex: event.index,
      searchQuery: "",
      searchFocused: false,
      error: null,
    };
    const nextPage = buildSettingsPage(ctx.registryCtx, { activeSectionIndex: event.index });
    return { handled: true, state: { ...next, selectedIndex: firstSelectableRowIndex(nextPage) } };
  }
  if (event.type === "search")
    return { handled: true, state: { ...state, searchFocused: true, error: null } };
  const rows = selectableSettingsRows(page);
  if (event.type === "scroll") {
    const current = rows.findIndex((row) => row.def.id === page.rows[state.selectedIndex]?.def.id);
    const index = Math.max(
      0,
      Math.min(rows.length - 1, current + (event.direction === "up" ? -1 : 1)),
    );
    const row = rows[index];
    return row
      ? {
          handled: true,
          state: { ...state, searchFocused: false, selectedIndex: page.rows.indexOf(row) },
        }
      : { handled: false, state };
  }
  if (event.type !== "row") return { handled: false, state };
  const row = rows.find((row) => row.def.id === event.id);
  if (!row) return { handled: false, state };
  const index = page.rows.indexOf(row);
  const focused = { ...state, searchFocused: false, selectedIndex: index, error: null };
  if (index !== state.selectedIndex || state.searchFocused)
    return { handled: true, state: focused };
  if (row.def.id === "usageAnalytics")
    return {
      handled: true,
      state: focused,
      statusMessage: "Analytics consent: press Enter",
    };
  return activateSettingsSelection(focused, ctx);
}
