// =============================================================================
// tracks-panel-nav.ts — pure nested-navigation reducer for the Tracks panel.
//
// Mirrors browse-focus-zone.ts. Two panes: "sections" (left, the category list)
// and "options" (right, the focused section's rows). Indices are clamped against
// a context-provided count; the reducer never reads the capability groups directly.
// =============================================================================

export type TracksNavPane = "sections" | "options";

export type TracksNavState = {
  readonly focusedPane: TracksNavPane;
  readonly sectionIndex: number;
  readonly optionIndex: number;
};

export type TracksNavContext = {
  readonly sectionCount: number;
  /** Number of rows in the currently focused section. */
  readonly optionCount: number;
};

export type TracksNavEvent =
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "enter-section" }
  | { readonly type: "exit-section" };

const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));

export function createInitialTracksNav(input: {
  readonly initialSectionIndex?: number;
  readonly focusedPane?: TracksNavPane;
}): TracksNavState {
  return {
    focusedPane: input.focusedPane ?? "sections",
    sectionIndex: Math.max(0, input.initialSectionIndex ?? 0),
    optionIndex: 0,
  };
}

export function tracksPanelNavReducer(
  state: TracksNavState,
  event: TracksNavEvent,
  ctx: TracksNavContext,
): TracksNavState {
  switch (event.type) {
    case "down":
      return state.focusedPane === "sections"
        ? { ...state, sectionIndex: clamp(state.sectionIndex + 1, ctx.sectionCount - 1) }
        : { ...state, optionIndex: clamp(state.optionIndex + 1, ctx.optionCount - 1) };
    case "up":
      return state.focusedPane === "sections"
        ? { ...state, sectionIndex: clamp(state.sectionIndex - 1, ctx.sectionCount - 1) }
        : { ...state, optionIndex: clamp(state.optionIndex - 1, ctx.optionCount - 1) };
    case "enter-section":
      if (ctx.optionCount <= 0) return state;
      return { ...state, focusedPane: "options", optionIndex: 0 };
    case "exit-section":
      return { ...state, focusedPane: "sections", optionIndex: 0 };
    default:
      return state;
  }
}

export const isOptionsFocused = (state: TracksNavState): boolean => state.focusedPane === "options";
