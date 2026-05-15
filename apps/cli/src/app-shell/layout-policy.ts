export type ShellViewportKind = "browse" | "picker" | "playback";

export type ShellViewportPolicy = {
  columns: number;
  rows: number;
  compact: boolean;
  ultraCompact: boolean;
  tooSmall: boolean;
  wideBrowse: boolean;
  minColumns: number;
  minRows: number;
  maxVisibleRows: number;
};

export function getShellViewportPolicy(
  kind: ShellViewportKind,
  columns: number,
  rows: number,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const forceCompact = options.forceCompact ?? false;
  const compact = forceCompact || columns < 110 || rows < 34;
  const ultraCompact = forceCompact || columns < 92 || rows < 28;
  const wideBrowse = !forceCompact && kind === "browse" && columns >= 164 && rows >= 30;
  const minColumns = 80;
  const minRows = 20;

  if (kind === "picker") {
    return {
      columns,
      rows,
      compact,
      ultraCompact,
      tooSmall: columns < minColumns || rows < minRows,
      wideBrowse: false,
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
    minColumns,
    minRows,
    maxVisibleRows: Math.max(4, rows - (ultraCompact ? 16 : compact ? 18 : 20)),
  };
}
