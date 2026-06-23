export type OverlayBackStackAction =
  | "clear-filter"
  | "exit-pane"
  | "cancel-confirmation"
  | "cancel-picker"
  | "close-overlay"
  | "defer-to-surface"
  | "no-op";

export type OverlayBackStackInput = {
  readonly cancelActive?: boolean;
  readonly filterQuery?: string;
  readonly nestedPaneActive?: boolean;
  readonly confirmationActive?: boolean;
  readonly pickerOverlay?: boolean;
  readonly surfaceOwnsEscape?: boolean;
};

/**
 * Pure Esc/back-stack policy for root-owned overlays.
 *
 * Order matters: a text filter is local state and should clear before any
 * broader navigation, nested panes should step back before confirmations are
 * cancelled, and overlays only close once already at their root state.
 */
export function resolveOverlayBackStack(input: OverlayBackStackInput): OverlayBackStackAction {
  if ((input.filterQuery ?? "").length > 0) return "clear-filter";
  if (input.cancelActive === false) return "no-op";
  if (input.nestedPaneActive) return "exit-pane";
  if (input.confirmationActive) return "cancel-confirmation";
  if (input.surfaceOwnsEscape) return "defer-to-surface";
  if (input.pickerOverlay) return "cancel-picker";
  return "close-overlay";
}
