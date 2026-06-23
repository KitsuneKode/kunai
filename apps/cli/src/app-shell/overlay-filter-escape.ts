export type OverlayFilterEscapeAction = "clear-filter" | "close";

/**
 * Shared Esc semantics for filterable overlays (history, settings, provider, and
 * notification surfaces): the first Esc clears a non-empty filter, the second
 * closes. Mirrors {@link file://./picker-controller.ts}'s `resolvePickerEscape`
 * so every filterable surface behaves the same way.
 */
export function resolveOverlayFilterEscape(filterQuery: string): OverlayFilterEscapeAction {
  return filterQuery.length > 0 ? "clear-filter" : "close";
}
