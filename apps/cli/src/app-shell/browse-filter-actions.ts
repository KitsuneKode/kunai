export type BrowseFilterActionDecision =
  | { readonly kind: "open-facets" }
  | { readonly kind: "open-narrow" }
  | { readonly kind: "ignore" };

export function decideBrowseFilterAction(input: {
  readonly action: "filters" | "narrow-results";
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly optionCount: number;
  readonly isCalendarView: boolean;
}): BrowseFilterActionDecision {
  if (input.isCalendarView) {
    return { kind: "ignore" };
  }

  if (input.action === "filters") {
    if (input.searchState === "idle" || input.searchState === "ready") {
      return { kind: "open-facets" };
    }
    return { kind: "ignore" };
  }

  if (input.searchState === "ready" && input.optionCount > 0) {
    return { kind: "open-narrow" };
  }

  return { kind: "ignore" };
}
