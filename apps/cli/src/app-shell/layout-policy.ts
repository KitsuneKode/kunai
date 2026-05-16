export type ShellViewportKind = "browse" | "picker" | "playback";

export type ShellViewportPolicy = {
  columns: number;
  rows: number;
  compact: boolean;
  ultraCompact: boolean;
  tooSmall: boolean;
  wideBrowse: boolean;
  mediumBrowse: boolean;
  minColumns: number;
  minRows: number;
  maxVisibleRows: number;
};

/** Minimum dimensions per shell kind. Picker needs more rows for list + header + footer. */
const KIND_MINIMUMS: Record<ShellViewportKind, { minColumns: number; minRows: number }> = {
  browse: { minColumns: 80, minRows: 20 },
  picker: { minColumns: 80, minRows: 24 },
  playback: { minColumns: 92, minRows: 22 },
};

/**
 * Compute viewport policy for a given shell kind and terminal dimensions.
 *
 * Breakpoints:
 * - ultraCompact: <92 cols or <28 rows  (list-only, no companion, minimal chrome)
 * - compact:      <110 cols or <34 rows (reduced chrome, no side companion)
 * - mediumBrowse: 110-139 cols + >=30 rows  (compact side companion with small poster)
 * - wideBrowse:     140+ cols + >=30 rows   (full side companion with poster)
 */
export function getShellViewportPolicy(
  kind: ShellViewportKind,
  columns: number,
  rows: number,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const forceCompact = options.forceCompact ?? false;
  const compact = forceCompact || columns < 110 || rows < 34;
  const ultraCompact = forceCompact || columns < 92 || rows < 28;
  const wideBrowse = !forceCompact && kind === "browse" && columns >= 140 && rows >= 30;
  const mediumBrowse =
    !forceCompact && kind === "browse" && !wideBrowse && columns >= 110 && rows >= 30;

  const { minColumns, minRows } = KIND_MINIMUMS[kind];

  if (kind === "picker") {
    return {
      columns,
      rows,
      compact,
      ultraCompact,
      tooSmall: columns < minColumns || rows < minRows,
      wideBrowse: false,
      mediumBrowse: false,
      minColumns,
      minRows,
      maxVisibleRows: Math.max(5, rows - (ultraCompact ? 18 : compact ? 22 : 26)),
    };
  }

  if (kind === "browse") {
    return {
      columns,
      rows,
      compact,
      ultraCompact,
      tooSmall: columns < minColumns || rows < minRows,
      wideBrowse,
      mediumBrowse,
      minColumns,
      minRows,
      maxVisibleRows: Math.max(5, rows - (compact ? 13 : 18)),
    };
  }

  return {
    columns,
    rows,
    compact,
    ultraCompact,
    tooSmall: columns < minColumns || rows < minRows,
    wideBrowse: false,
    mediumBrowse: false,
    minColumns,
    minRows,
    maxVisibleRows: Math.max(4, rows - (ultraCompact ? 16 : compact ? 18 : 20)),
  };
}

/**
 * Shared picker layout math used by checklist-shell and ink-shell picker mode.
 * Ensures consistent column widths, companion visibility, and list sizing.
 *
 * @param columns - terminal columns
 * @param rows    - terminal rows
 * @returns layout dimensions and visibility flags
 */
export function getPickerLayout(
  columns: number,
  rows: number,
): {
  innerWidth: number;
  listWidth: number | undefined;
  companionWidth: number;
  rowWidth: number;
  showCompanion: boolean;
  maxVisible: number;
} {
  const innerWidth = Math.max(24, columns - 8);
  // Companion appears at 120+ columns when there is enough vertical room
  const showCompanion = columns >= 120 && rows >= 26;
  const companionWidth = showCompanion ? Math.max(30, Math.floor(innerWidth * 0.32)) : 0;
  const listWidth = showCompanion ? Math.max(36, innerWidth - companionWidth - 3) : innerWidth;
  const rowWidth = Math.max(20, listWidth - 4);
  const maxVisible = Math.max(5, rows - (columns < 92 || rows < 28 ? 18 : columns < 110 ? 22 : 26));

  return { innerWidth, listWidth, companionWidth, rowWidth, showCompanion, maxVisible };
}
