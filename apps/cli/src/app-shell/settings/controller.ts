import type { Container } from "@/container";
import type { Key } from "ink";

import { buildSettingsPage, listSettingsSectionLabels } from "./build-page";
import { buildSettingsSubmenuView } from "./build-submenu";
import { clampSelectedIndex, moveSelectedIndex, selectableSettingsRows } from "./navigation";
import { shouldDebouncePersist } from "./persist";
import type { PersistTiming } from "./persist";
import { moveProviderInOrder } from "./provider-order";
import {
  enterSettingsInputMode,
  enterSettingsSubmenu,
  exitSettingsInputMode,
  exitSettingsSubmenu,
  patchSettingsDraft,
  updateInputBuffer,
} from "./state";
import type { SettingRowDef, SettingsRegistryContext, SettingsUiState } from "./types";

export type SettingsKeyResult = {
  readonly state: SettingsUiState;
  readonly persist?: PersistTiming;
  readonly statusMessage?: string | null;
  readonly closeOverlay?: boolean;
  readonly runActionId?: string;
  readonly handled: boolean;
};

export type SettingsKeyContext = {
  readonly container: Container;
  readonly registryCtx: SettingsRegistryContext;
};

function pageFor(state: SettingsUiState, ctx: SettingsKeyContext) {
  return buildSettingsPage(ctx.registryCtx, {
    searchQuery: state.searchQuery,
    activeSectionIndex: state.activeSectionIndex,
  });
}

function selectedRow(state: SettingsUiState, ctx: SettingsKeyContext) {
  const page = pageFor(state, ctx);
  return page.rows[clampSelectedIndex(state.selectedIndex, page.rows.length)] ?? null;
}

function selectedDef(state: SettingsUiState, ctx: SettingsKeyContext): SettingRowDef | null {
  return selectedRow(state, ctx)?.def ?? null;
}

function isTextEnvLocked(def: SettingRowDef): boolean {
  return def.kind === "text" && Boolean(def.envOverride && process.env[def.envOverride]?.trim());
}

function commitTextInput(
  state: SettingsUiState,
  def: Extract<SettingRowDef, { kind: "text" }>,
  _ctx: SettingsKeyContext,
): SettingsKeyResult {
  const buffer = state.inputMode.active ? state.inputMode.buffer : "";
  const error = def.validate(buffer);
  if (error) {
    return { handled: true, state: { ...state, error }, persist: undefined };
  }
  const next = def.apply(state.draft, buffer);
  return {
    handled: true,
    state: {
      ...state,
      draft: next,
      inputMode: { active: false },
      error: null,
    },
    persist: "immediate",
    statusMessage: buffer.trim() ? "Saved — syncing to disk." : "Cleared — syncing to disk.",
  };
}

function printableInputChunk(input: string): string {
  return input
    .replaceAll("\u001B[200~", "")
    .replaceAll("\u001B[201~", "")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
    .join("");
}

function applySubmenuPick(
  state: SettingsUiState,
  def: SettingRowDef,
  value: string,
  ctx: SettingsKeyContext,
): SettingsKeyResult {
  if (def.kind === "enum") {
    const next = def.write(state.draft, value);
    return {
      handled: true,
      state: exitSettingsSubmenu({ ...state, draft: next, error: null }),
      persist: "immediate",
    };
  }
  if (def.kind === "submenu") {
    const result = def.onPick(state.draft, value, ctx.registryCtx);
    if (typeof result === "object" && "stay" in result) {
      return {
        handled: true,
        state: {
          ...state,
          draft: result.next,
          error: null,
        },
        persist: "immediate",
      };
    }
    return {
      handled: true,
      state: exitSettingsSubmenu({ ...state, draft: result, error: null }),
      persist: "immediate",
    };
  }
  return { handled: true, state };
}

function toggleBoolean(
  state: SettingsUiState,
  def: Extract<SettingRowDef, { kind: "boolean" }>,
): SettingsKeyResult {
  const next = def.write(state.draft, !def.read(state.draft));
  return {
    handled: true,
    state: patchSettingsDraft(state, () => next),
    persist: "immediate",
  };
}

function cycleEnumSegment(
  state: SettingsUiState,
  def: Extract<SettingRowDef, { kind: "enum" }>,
): SettingsKeyResult {
  const current = def.read(state.draft);
  const index = def.options.findIndex((option) => option.value === current);
  const nextOption = def.options[(index + 1 + def.options.length) % def.options.length];
  if (!nextOption) return { handled: true, state };
  const next = def.write(state.draft, nextOption.value);
  return {
    handled: true,
    state: patchSettingsDraft(state, () => next),
    persist: "immediate",
  };
}

function openRow(state: SettingsUiState, def: SettingRowDef, rowIndex: number): SettingsKeyResult {
  if (def.kind === "text") {
    if (isTextEnvLocked(def)) {
      return {
        handled: true,
        state: { ...state, error: `Unset ${def.envOverride} to edit this value in config.` },
      };
    }
    const seed = def.read(state.draft);
    return {
      handled: true,
      state: enterSettingsInputMode(state, def.id, seed, seed),
    };
  }
  if (def.kind === "enum" && def.presentation === "segment") {
    return cycleEnumSegment(state, def);
  }
  if (def.kind === "enum" || def.kind === "submenu" || def.kind === "reorder") {
    return {
      handled: true,
      state: enterSettingsSubmenu(state, def.id, rowIndex),
    };
  }
  return { handled: false, state };
}

function handleReorder(
  state: SettingsUiState,
  def: Extract<SettingRowDef, { kind: "reorder" }>,
  direction: "up" | "down",
  ctx: SettingsKeyContext,
): SettingsKeyResult {
  const submenu = buildSettingsSubmenuView(
    state.submenuId ?? "",
    ctx.registryCtx,
    pageFor(state, ctx).defById,
  );
  const picked =
    submenu?.choices[clampSelectedIndex(state.selectedIndex, submenu?.choices.length ?? 0)]?.value;
  if (!picked) return { handled: true, state };
  const order = def.resolveOrder(state.draft);
  const moved = moveProviderInOrder(order, picked, direction);
  if (moved.join("|") === order.join("|")) return { handled: true, state };
  return {
    handled: true,
    state: patchSettingsDraft(state, () => def.applyOrder(state.draft, moved)),
    persist: "debounced",
  };
}

export function handleSettingsKey(
  input: string,
  key: Key,
  state: SettingsUiState,
  ctx: SettingsKeyContext,
): SettingsKeyResult {
  const page = pageFor(state, ctx);

  if (state.inputMode.active) {
    const def = page.defById.get(state.inputMode.settingId);
    if (def?.kind !== "text") {
      return { handled: true, state: exitSettingsInputMode(state, true) };
    }

    if (key.escape) {
      return {
        handled: true,
        state: {
          ...exitSettingsInputMode(state, false),
          draft: def.apply(state.draft, state.inputMode.seed),
          error: null,
        },
      };
    }

    if (key.return) {
      return commitTextInput(state, def, ctx);
    }

    if (input === "u" && key.ctrl) {
      return {
        handled: true,
        state: { ...updateInputBuffer(state, ""), error: null },
      };
    }

    if (key.backspace || key.delete) {
      const buffer = state.inputMode.buffer;
      return {
        handled: true,
        state: updateInputBuffer(state, buffer.slice(0, -1)),
      };
    }

    const printable = !key.ctrl && !key.meta ? printableInputChunk(input) : "";
    if (printable) {
      return {
        handled: true,
        state: updateInputBuffer(state, state.inputMode.buffer + printable),
      };
    }

    return { handled: true, state };
  }

  if (state.submenuId) {
    const def = page.defById.get(state.submenuId);
    const submenu = buildSettingsSubmenuView(state.submenuId, ctx.registryCtx, page.defById);

    if (key.escape) {
      return { handled: true, state: exitSettingsSubmenu(state) };
    }

    if (def?.kind === "reorder") {
      const direction =
        input === "[" || (key.shift && key.upArrow)
          ? "up"
          : input === "]" || (key.shift && key.downArrow)
            ? "down"
            : null;
      if (direction) {
        return handleReorder(state, def, direction, ctx);
      }
      if (key.return) {
        return { handled: true, state };
      }
    }

    if (key.upArrow || input === "k") {
      const choices = submenu?.choices ?? [];
      return {
        handled: true,
        state: {
          ...state,
          selectedIndex: clampSelectedIndex(state.selectedIndex - 1, choices.length),
        },
      };
    }

    if (key.downArrow || input === "j") {
      const choices = submenu?.choices ?? [];
      return {
        handled: true,
        state: {
          ...state,
          selectedIndex: clampSelectedIndex(state.selectedIndex + 1, choices.length),
        },
      };
    }

    if (key.return && def && submenu) {
      const picked =
        submenu.choices[clampSelectedIndex(state.selectedIndex, submenu.choices.length)];
      if (!picked) return { handled: true, state };
      return applySubmenuPick(state, def, picked.value, ctx);
    }

    return { handled: true, state };
  }

  if (key.escape) {
    return { handled: true, state, closeOverlay: true };
  }

  if (input === "/" && !key.ctrl && !key.meta) {
    const nextQuery = state.searchQuery + "/";
    const filtered = buildSettingsPage(ctx.registryCtx, {
      searchQuery: nextQuery,
      activeSectionIndex: state.activeSectionIndex,
    });
    return {
      handled: true,
      state: {
        ...state,
        searchQuery: nextQuery,
        selectedIndex: clampSelectedIndex(
          0,
          selectableSettingsRows(filtered).length || filtered.rows.length,
        ),
        error: null,
      },
    };
  }

  if (key.tab && !state.searchQuery.trim()) {
    const sectionCount = listSettingsSectionLabels(ctx.registryCtx).length;
    if (sectionCount > 1) {
      const nextSection = (state.activeSectionIndex + 1) % sectionCount;
      const filtered = buildSettingsPage(ctx.registryCtx, { activeSectionIndex: nextSection });
      return {
        handled: true,
        state: {
          ...state,
          activeSectionIndex: nextSection,
          selectedIndex: clampSelectedIndex(0, selectableSettingsRows(filtered).length),
          error: null,
        },
      };
    }
  }

  if (key.backspace || key.delete) {
    if (state.searchQuery.length > 0) {
      return {
        handled: true,
        state: {
          ...state,
          searchQuery: state.searchQuery.slice(0, -1),
          selectedIndex: 0,
        },
      };
    }
    return { handled: false, state };
  }

  if (!key.ctrl && !key.meta && input.length === 1 && input >= " " && input !== "/") {
    const nextQuery = state.searchQuery + input;
    const filtered = buildSettingsPage(ctx.registryCtx, {
      searchQuery: nextQuery,
      activeSectionIndex: state.activeSectionIndex,
    });
    return {
      handled: true,
      state: {
        ...state,
        searchQuery: nextQuery,
        selectedIndex: clampSelectedIndex(
          state.selectedIndex,
          selectableSettingsRows(filtered).length || filtered.rows.length,
        ),
      },
    };
  }

  if (key.upArrow || input === "k") {
    return {
      handled: true,
      state: {
        ...state,
        selectedIndex: moveSelectedIndex(page, state.selectedIndex, -1),
      },
    };
  }

  if (key.downArrow || input === "j") {
    return {
      handled: true,
      state: {
        ...state,
        selectedIndex: moveSelectedIndex(page, state.selectedIndex, 1),
      },
    };
  }

  const def = selectedDef(state, ctx);
  if (!def) return { handled: true, state };

  if ((key.return || input === " ") && def.kind === "boolean") {
    return toggleBoolean(state, def);
  }

  if (input === " " && def.kind === "enum" && def.presentation === "segment") {
    return cycleEnumSegment(state, def);
  }

  if (key.return) {
    if (def.kind === "action") {
      if (state.busy) return { handled: true, state };
      return {
        handled: true,
        state: { ...state, busy: true, error: null },
        runActionId: def.id,
      };
    }
    const rowIndex = page.rows.findIndex((row) => row.def.id === def.id);
    return openRow(state, def, rowIndex >= 0 ? rowIndex : state.selectedIndex);
  }

  if (input === " " && def.kind === "boolean") {
    return toggleBoolean(state, def);
  }

  return { handled: false, state };
}

export function persistTimingForDef(def: SettingRowDef | null): PersistTiming {
  if (!def) return "immediate";
  return shouldDebouncePersist(def.kind) ? "debounced" : "immediate";
}
