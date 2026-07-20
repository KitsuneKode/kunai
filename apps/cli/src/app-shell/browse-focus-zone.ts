// =============================================================================
// browse-focus-zone.ts — pure focus-zone reducer for browse shell
//
// Zones: query (default text) → list (bare hotkeys) → filter (local narrow) → idle
// Printable keys edit text only in query/filter; list owns i/enter/q/d without
// leaking keystrokes into the search box.
// =============================================================================

export type BrowseFocusZone = "query" | "filter" | "list" | "idle";

export type BrowseFocusZoneContext = {
  readonly hasResults: boolean;
  readonly hasFilterBar: boolean;
  readonly canFocusIdle: boolean;
  readonly selectedIndex: number;
};

export type BrowseFocusZoneEvent =
  | { readonly type: "focus-query" }
  | { readonly type: "focus-filter" }
  | { readonly type: "focus-list" }
  | { readonly type: "focus-idle" }
  | { readonly type: "focus-filter-shortcut" }
  | { readonly type: "arrow-down" }
  | { readonly type: "arrow-up" }
  | { readonly type: "escape" }
  | { readonly type: "clear-results" }
  | { readonly type: "results-became-empty" }
  | { readonly type: "blur-idle" };

export function createInitialBrowseFocusZone(input?: {
  readonly startIdle?: boolean;
}): BrowseFocusZone {
  return input?.startIdle ? "idle" : "query";
}

export function browseFocusZoneReducer(
  zone: BrowseFocusZone,
  event: BrowseFocusZoneEvent,
  ctx: BrowseFocusZoneContext,
): BrowseFocusZone {
  switch (event.type) {
    case "focus-query":
      return "query";
    case "focus-filter":
      return ctx.hasFilterBar ? "filter" : zone;
    case "focus-list":
      return ctx.hasResults ? "list" : zone;
    case "focus-idle":
      return ctx.canFocusIdle ? "idle" : zone;
    case "focus-filter-shortcut":
      return ctx.hasFilterBar && ctx.hasResults ? "filter" : zone;
    case "arrow-down":
      if (zone === "query") {
        if (ctx.hasResults) return "list";
        if (ctx.canFocusIdle) return "idle";
        return zone;
      }
      if (zone === "filter" && ctx.hasResults) return "list";
      return zone;
    case "arrow-up":
      if (zone === "list" && ctx.selectedIndex === 0) return "query";
      if (zone === "filter") return "query";
      if (zone === "idle") return "query";
      if (zone === "query" && ctx.hasResults) return "list";
      return zone;
    case "escape":
      if (zone === "list" || zone === "filter" || zone === "idle") return "query";
      return zone;
    case "clear-results":
    case "results-became-empty":
      return zone === "list" || zone === "filter" || zone === "idle" ? "query" : zone;
    case "blur-idle":
      return zone === "idle" ? "query" : zone;
    default:
      return zone;
  }
}

export function isBrowseListFocused(zone: BrowseFocusZone): boolean {
  return zone === "list";
}

export function isBrowseFilterFocused(zone: BrowseFocusZone): boolean {
  return zone === "filter";
}

export function isBrowseQueryFocused(zone: BrowseFocusZone): boolean {
  return zone === "query";
}

export function isBrowseIdleFocused(zone: BrowseFocusZone): boolean {
  return zone === "idle";
}

export function isBrowseTextInputZone(zone: BrowseFocusZone): boolean {
  return zone === "query" || zone === "filter";
}

/** True while command palette or a browse text field owns printable input. */
export function shouldSuppressBrowseLetterHotkeys(input: {
  readonly commandMode: boolean;
  readonly focusZone: BrowseFocusZone;
}): boolean {
  return input.commandMode || isBrowseTextInputZone(input.focusZone);
}

/** Bare a–z hotkeys (no modifiers) that must not fire while text input owns focus. */
export function isBareBrowseLetterHotkey(
  input: string,
  key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly shift?: boolean },
): boolean {
  if (key.ctrl || key.meta || key.shift) return false;
  return input.length === 1 && /^[a-zA-Z]$/.test(input);
}

/** Chords that still route while the search/command line owns focus (Ctrl+C, `/`, Esc). */
export function isReservedBrowseSurfaceChord(
  input: string,
  key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly escape?: boolean },
): boolean {
  if (key.escape) return true;
  if ((input === "c" && key.ctrl) || input === "\x03") return true;
  if (input === "/" && !key.ctrl && !key.meta) return true;
  return false;
}
