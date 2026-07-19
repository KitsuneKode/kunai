import type { BuiltSettingsPage, BuiltSettingsRow } from "./types";

function isSelectableRow(row: BuiltSettingsRow): boolean {
  return row.def.kind !== "section" && row.def.kind !== "status";
}

export function selectableSettingsRows(page: BuiltSettingsPage): readonly BuiltSettingsRow[] {
  return page.rows.filter(isSelectableRow);
}

/** Index into `page.rows` for the first focusable setting, or 0 if none. */
export function firstSelectableRowIndex(page: BuiltSettingsPage): number {
  const index = page.rows.findIndex(isSelectableRow);
  return index >= 0 ? index : 0;
}

/**
 * Keep `preferred` when it still points at a focusable row; otherwise snap to
 * the first selectable row. Section/status headers are never focus targets.
 */
export function resolveSelectableRowIndex(page: BuiltSettingsPage, preferred: number): number {
  const row = page.rows[preferred];
  if (row && isSelectableRow(row)) return preferred;
  return firstSelectableRowIndex(page);
}

export function clampSelectedIndex(index: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(0, Math.min(index, rowCount - 1));
}

export function moveSelectedIndex(page: BuiltSettingsPage, current: number, delta: 1 | -1): number {
  const rows = selectableSettingsRows(page);
  if (rows.length === 0) return 0;
  const currentRow = page.rows[current];
  const selectableIndex = currentRow
    ? rows.findIndex((row) => row.def.id === currentRow.def.id)
    : -1;
  // If focus is on a non-selectable header, treat "down" as entering the first
  // setting and "up" as jumping to the last — don't skip past the first row.
  const base = selectableIndex >= 0 ? selectableIndex : delta > 0 ? -1 : 0;
  const next = (base + delta + rows.length) % rows.length;
  const target = rows[next];
  if (!target) return current;
  return page.rows.findIndex((row) => row.def.id === target.def.id);
}

export function windowStart(selectedIndex: number, total: number, maxVisible: number): number {
  if (total <= maxVisible) return 0;
  const half = Math.floor(maxVisible / 2);
  return Math.max(0, Math.min(selectedIndex - half, total - maxVisible));
}
