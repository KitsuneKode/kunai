export type ShellViewportKind = "browse" | "picker" | "playback";

export type ShellViewportPolicy = {
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
): ShellViewportPolicy {
  const compact = columns < 110 || rows < 34;
  const ultraCompact = columns < 92 || rows < 28;
  const wideBrowse = kind === "browse" && columns >= 164 && rows >= 30;

  if (kind === "picker") {
    const minColumns = 84;
    const minRows = 24;
    return {
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
    const minColumns = 92;
    const minRows = 24;
    return {
      compact,
      ultraCompact,
      tooSmall: columns < minColumns || rows < minRows,
      wideBrowse,
      minColumns,
      minRows,
      maxVisibleRows: Math.max(5, rows - (compact ? 13 : 18)),
    };
  }

  const minColumns = 84;
  const minRows = 22;
  return {
    compact,
    ultraCompact,
    tooSmall: columns < minColumns || rows < minRows,
    wideBrowse: false,
    minColumns,
    minRows,
    maxVisibleRows: Math.max(4, rows - (ultraCompact ? 16 : compact ? 18 : 20)),
  };
}
