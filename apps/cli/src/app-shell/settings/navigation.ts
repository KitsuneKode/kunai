import type { BuiltSettingsPage, BuiltSettingsRow } from "./types";

export function selectableSettingsRows(page: BuiltSettingsPage): readonly BuiltSettingsRow[] {
  return page.rows.filter((row) => row.def.kind !== "section" && row.def.kind !== "status");
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
  const base = selectableIndex >= 0 ? selectableIndex : 0;
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
