export type LayoutBreakpoint = "wide" | "medium" | "narrow" | "minimal";
export type PanePlacement = "right" | "bottom" | "hidden";
export type CompanionPaneMode = "details" | "diagnostics";
export type ImagePreviewPreference = "off" | "auto" | "always";

export interface ViewportSize {
  readonly columns: number;
  readonly rows: number;
}

export interface LayoutPreferences {
  readonly companionPaneOpen: boolean;
  readonly diagnosticsRequested: boolean;
  readonly imageSupported: boolean;
  readonly imagePreviewPreference: ImagePreviewPreference;
}

export interface ResponsiveLayoutState {
  readonly viewport: ViewportSize;
  readonly breakpoint: LayoutBreakpoint;
  readonly tooSmall: boolean;
  readonly blockerMessage: string | null;
  readonly note: string | null;
  readonly companion: {
    readonly mode: CompanionPaneMode;
    readonly visible: boolean;
    readonly placement: PanePlacement;
    readonly userCollapsed: boolean;
    readonly autoCollapsed: boolean;
  };
  readonly details: {
    readonly visible: boolean;
    readonly imageSupported: boolean;
    readonly imageVisible: boolean;
    readonly imageAutoCollapsed: boolean;
    readonly imagePreviewPreference: ImagePreviewPreference;
  };
  readonly diagnostics: {
    readonly requested: boolean;
    readonly visible: boolean;
    readonly placement: PanePlacement;
    readonly autoCollapsed: boolean;
  };
}

export const DEFAULT_VIEWPORT: ViewportSize = {
  columns: 140,
  rows: 36,
};

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  companionPaneOpen: true,
  diagnosticsRequested: false,
  imageSupported: false,
  imagePreviewPreference: "auto",
};

const MIN_COLUMNS = 72;
const MIN_ROWS = 18;
const WIDE_COLUMNS = 140;
const WIDE_ROWS = 36;
const MEDIUM_COLUMNS = 110;
const MEDIUM_ROWS = 28;
const NARROW_COLUMNS = 80;
const NARROW_ROWS = 22;

export function deriveResponsiveLayout(
  viewport: ViewportSize,
  preferences: LayoutPreferences,
): ResponsiveLayoutState {
  const tooSmall = viewport.columns < MIN_COLUMNS || viewport.rows < MIN_ROWS;
  const breakpoint = getBreakpoint(viewport, tooSmall);
  const companionMode: CompanionPaneMode = preferences.diagnosticsRequested
    ? "diagnostics"
    : "details";
  const userCollapsed = !preferences.companionPaneOpen;

  const autoCollapsed = !userCollapsed && (tooSmall || breakpoint === "narrow");
  const companionVisible = !userCollapsed && !autoCollapsed;
  const companionPlacement = companionVisible
    ? breakpoint === "wide"
      ? "right"
      : "bottom"
    : "hidden";

  const detailsVisible = companionVisible && companionMode === "details";
  const imageEnabled = preferences.imageSupported && preferences.imagePreviewPreference !== "off";
  const imageVisible =
    detailsVisible &&
    imageEnabled &&
    (breakpoint === "wide" ||
      (breakpoint === "medium" && preferences.imagePreviewPreference === "always"));
  const imageAutoCollapsed = imageEnabled && !imageVisible;

  const diagnosticsVisible = companionVisible && preferences.diagnosticsRequested;
  const diagnosticsPlacement = diagnosticsVisible ? companionPlacement : "hidden";

  return {
    viewport,
    breakpoint,
    tooSmall,
    blockerMessage: tooSmall
      ? `Terminal too small for the interactive shell (${MIN_COLUMNS}x${MIN_ROWS} minimum).`
      : null,
    note:
      !tooSmall && autoCollapsed
        ? "Secondary pane collapsed to protect primary navigation on narrow terminals."
        : null,
    companion: {
      mode: companionMode,
      visible: companionVisible,
      placement: companionPlacement,
      userCollapsed,
      autoCollapsed,
    },
    details: {
      visible: detailsVisible,
      imageSupported: preferences.imageSupported,
      imageVisible,
      imageAutoCollapsed,
      imagePreviewPreference: preferences.imagePreviewPreference,
    },
    diagnostics: {
      requested: preferences.diagnosticsRequested,
      visible: diagnosticsVisible,
      placement: diagnosticsPlacement,
      autoCollapsed: preferences.diagnosticsRequested && !diagnosticsVisible,
    },
  };
}

function getBreakpoint(viewport: ViewportSize, tooSmall: boolean): LayoutBreakpoint {
  if (tooSmall) return "minimal";
  if (viewport.columns >= WIDE_COLUMNS && viewport.rows >= WIDE_ROWS) {
    return "wide";
  }
  if (viewport.columns >= MEDIUM_COLUMNS && viewport.rows >= MEDIUM_ROWS) {
    return "medium";
  }
  if (viewport.columns >= NARROW_COLUMNS && viewport.rows >= NARROW_ROWS) {
    return "narrow";
  }
  return "minimal";
}
