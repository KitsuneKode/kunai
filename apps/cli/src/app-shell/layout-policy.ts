export type ShellViewportKind = "browse" | "picker" | "playback";

export type ShellViewportBreakpoint = "narrow" | "medium" | "wide" | "blocked";
export type ShellTerminalProfile = "local" | "constrained";

export type ShellViewportPolicy = {
  columns: number;
  rows: number;
  terminalProfile: ShellTerminalProfile;
  breakpoint: ShellViewportBreakpoint;
  compact: boolean;
  ultraCompact: boolean;
  tooSmall: boolean;
  wideBrowse: boolean;
  mediumBrowse: boolean;
  previewRail: boolean;
  zen: boolean;
  minColumns: number;
  minRows: number;
  maxVisibleRows: number;
};

const GLOBAL_BLOCKED_MIN_COLS = 60;
const GLOBAL_BLOCKED_MIN_ROWS = 20;

/** Minimum dimensions per shell kind. */
const KIND_MINIMUMS: Record<ShellViewportKind, { minColumns: number; minRows: number }> = {
  browse: { minColumns: 60, minRows: 20 },
  picker: { minColumns: 60, minRows: 20 },
  playback: { minColumns: 60, minRows: 20 },
};

/**
 * Compute viewport policy for a given shell kind and terminal dimensions.
 *
 * Breakpoints:
 * - blocked: <60 cols or <20 rows → show resize blocker, no content
 * - narrow:  60–79 cols → companion hidden, compact footer
 * - medium:  80–119 cols → compact companion below list
 * - wide:    120+ cols → full companion right pane with poster
 */
export function getShellViewportPolicy(
  kind: ShellViewportKind,
  columns: number,
  rows: number,
  options: {
    forceCompact?: boolean;
    terminalProfile?: ShellTerminalProfile;
    /**
     * Zen mode: collapse to a single column (no companion / preview rail) at any
     * width for ani-cli-style minimal chrome, without forking the layout math.
     * Never overrides the blocked breakpoint — a too-small terminal is still
     * too-small. Treated as "narrow" so every single-column caller path applies.
     */
    zen?: boolean;
  } = {},
): ShellViewportPolicy {
  const forceCompact = options.forceCompact ?? false;
  const terminalProfile = options.terminalProfile ?? "local";
  const zen = options.zen ?? false;

  const blocked =
    forceCompact || columns < GLOBAL_BLOCKED_MIN_COLS || rows < GLOBAL_BLOCKED_MIN_ROWS;
  // Zen forces the single-column ("narrow") track for any unblocked terminal, so
  // medium/wide companions and the preview rail never appear regardless of width.
  const narrow = !blocked && (zen || columns < 80);
  const medium = !blocked && !narrow && columns < 120;
  const wide = !blocked && !narrow && !medium;

  const breakpoint: ShellViewportBreakpoint = blocked
    ? "blocked"
    : narrow
      ? "narrow"
      : medium
        ? "medium"
        : "wide";

  // Legacy compat flags — derived from new breakpoints so existing callers still work
  const compact = blocked || narrow;
  const ultraCompact = blocked;

  // Browse companion flags
  // wideBrowse: right-pane companion at wide (120+) — kept as compat flag for existing callers
  // mediumBrowse: compact companion below list at medium (80–119) — kept as compat flag for existing callers
  const wideBrowse = !blocked && kind === "browse" && wide;
  const mediumBrowse = !blocked && kind === "browse" && medium;
  const previewRail =
    wideBrowse && terminalProfile === "local" && columns >= 140 && rows >= GLOBAL_BLOCKED_MIN_ROWS;

  const { minColumns, minRows } = KIND_MINIMUMS[kind];
  const tooSmall = blocked || columns < minColumns || rows < minRows;

  const maxVisibleRowsBase = blocked || narrow ? 10 : medium ? 14 : 18;

  return {
    columns,
    rows,
    terminalProfile,
    breakpoint,
    compact,
    ultraCompact,
    tooSmall,
    wideBrowse,
    mediumBrowse,
    previewRail,
    zen,
    minColumns,
    minRows,
    maxVisibleRows: Math.max(5, rows - maxVisibleRowsBase),
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
  const maxVisible = Math.max(5, rows - (columns < 80 || rows < 20 ? 10 : columns < 120 ? 14 : 18));

  return { innerWidth, listWidth, companionWidth, rowWidth, showCompanion, maxVisible };
}

export function getBrowseCommandPaletteMaxVisible(
  rows: number,
  hasSubtitle: boolean,
  hasFilters: boolean,
): number {
  // Row accounting for commandMode=true in BrowseShell:
  // AppRoot/header safety(4), browse chrome(10-13), command input chrome(4),
  // command footer(5), and a small resize/Ink buffer(3). Keep the list bounded
  // on small terminals, but let tall terminals show enough commands to feel
  // useful instead of turning the palette into a tiny peephole. The extra
  // buffer row absorbs transient root banners, such as streak or presence
  // notices, which can otherwise make Ink reconcile the bottom "more" row over
  // the last visible command for a frame.
  const browseChromeRows = 1 + (hasSubtitle ? 1 : 0) + (hasFilters ? 2 : 0) + 9;
  const availableRows = rows - 4 - browseChromeRows - 4 - 5 - 3;
  return Math.max(1, Math.min(18, availableRows));
}

/** Rows consumed by AppRoot header, padding, and transient alert strip above shell content. */
export const ROOT_CHROME_ROWS = 4;

const BROWSE_BASE_CHROME_ROWS = 10;
const BROWSE_FOOTER_ROWS = 5;
const BROWSE_INK_BUFFER_ROWS = 3;
const SCROLL_AFFORDANCE_ROWS = 2;

export function getBrowseChromeRows(flags: {
  readonly hasResultSubtitle: boolean;
  readonly hasFilterBar: boolean;
  readonly hasFilterBadges: boolean;
  readonly hasCalendarChrome: boolean;
  readonly hasContextStrip: boolean;
  readonly hasQueryDirtyHint: boolean;
  readonly commandMode: boolean;
}): number {
  let rows = BROWSE_BASE_CHROME_ROWS;
  if (flags.hasResultSubtitle) rows += 1;
  if (flags.hasFilterBar) rows += 3;
  if (flags.hasFilterBadges) rows += 1;
  if (flags.hasCalendarChrome) rows += 2;
  if (flags.hasContextStrip) rows += 1;
  if (flags.hasQueryDirtyHint) rows += 1;
  if (flags.commandMode) rows += 4;
  return rows;
}

export function getBrowseListMaxVisible(
  rows: number,
  chromeRows: number,
  rootHeaderRows: number = ROOT_CHROME_ROWS,
): number {
  const available =
    rows -
    rootHeaderRows -
    chromeRows -
    BROWSE_FOOTER_ROWS -
    BROWSE_INK_BUFFER_ROWS -
    SCROLL_AFFORDANCE_ROWS;
  return Math.max(1, Math.min(18, available));
}

const PICKER_BASE_CHROME_ROWS = 8;
const PICKER_FOOTER_ROWS = 5;
const PICKER_INK_BUFFER_ROWS = 3;

export function getPickerChromeRows(flags: {
  readonly hasSubtitle: boolean;
  readonly commandMode: boolean;
  readonly extraRows?: number;
}): number {
  let rows = PICKER_BASE_CHROME_ROWS + (flags.extraRows ?? 0);
  if (flags.hasSubtitle) rows += 1;
  if (flags.commandMode) rows += 4;
  return rows;
}

export function getPickerListMaxVisible(
  rows: number,
  chromeRows: number,
  rootHeaderRows: number = ROOT_CHROME_ROWS,
): number {
  const available =
    rows -
    rootHeaderRows -
    chromeRows -
    PICKER_FOOTER_ROWS -
    PICKER_INK_BUFFER_ROWS -
    SCROLL_AFFORDANCE_ROWS;
  return Math.max(1, available);
}

export function getCommandPaletteVisibleCommandCount({
  maxRows,
  totalMatches,
  grouped,
}: {
  readonly maxRows: number;
  readonly totalMatches: number;
  readonly grouped: boolean;
}): number {
  if (totalMatches <= 0) return 0;
  const groupHeaderRows = grouped ? 3 : 0;
  // The ▲/▼ scroll-affordance lines are always rendered (as blank placeholders
  // when inactive) so paging never shifts the palette vertically — reserve both.
  const scrollIndicatorRows = 2;
  const available = maxRows - groupHeaderRows - scrollIndicatorRows;
  return Math.max(1, Math.min(totalMatches, available));
}
