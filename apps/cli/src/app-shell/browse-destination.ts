// =============================================================================
// browse-destination.ts — header/footer destination pill for browse surfaces
//
// BrowseShell owns the live query/subtitle; AppHeader lives in ink-shell.
// This tiny store lets browse publish the destination label without stuffing
// route enums into SessionState.
// =============================================================================

import { useSyncExternalStore } from "react";

export type BrowseDestinationLabel =
  | "Browse"
  | "Search"
  | "Trending"
  | "Recommendations"
  | "Surprise"
  | "Random"
  | "Schedule";

const subscribers = new Set<() => void>();
let destinationLabel: BrowseDestinationLabel = "Browse";

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

export function getBrowseDestinationLabel(): BrowseDestinationLabel {
  return destinationLabel;
}

export function setBrowseDestinationLabel(label: BrowseDestinationLabel): void {
  if (destinationLabel === label) return;
  destinationLabel = label;
  notify();
}

export function subscribeBrowseDestinationLabel(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function useBrowseDestinationLabel(): BrowseDestinationLabel {
  return useSyncExternalStore(
    subscribeBrowseDestinationLabel,
    getBrowseDestinationLabel,
    getBrowseDestinationLabel,
  );
}

/** Pure resolver used by BrowseShell (and tests) from local browse signals. */
export function resolveBrowseDestinationLabel(input: {
  readonly isCalendar: boolean;
  readonly query: string;
  readonly resultSubtitle: string;
  readonly emptyMessage?: string;
  readonly hasResults: boolean;
  readonly searchState: "idle" | "loading" | "ready" | "error";
}): BrowseDestinationLabel {
  if (input.isCalendar) return "Schedule";

  const query = input.query.trim();
  if (query.length > 0) return "Search";

  // Subtitle is the destination of truth after a route load ("12 trending · TMDB").
  // Idle empty hints say "try /trending" — that must NOT flip the home label.
  // Loading emptyMessage is consulted only while searchState === "loading".
  const subtitle = input.resultSubtitle.toLowerCase();
  const loadingHint =
    input.searchState === "loading" ? (input.emptyMessage ?? "").toLowerCase() : "";
  const haystack = `${subtitle} ${loadingHint}`.trim();

  if (haystack.includes("recommend") || haystack.includes("discover")) {
    return "Recommendations";
  }
  if (haystack.includes("surprise")) return "Surprise";
  if (haystack.includes("random")) return "Random";
  if (
    haystack.includes("schedule") ||
    haystack.includes("calendar") ||
    haystack.includes("airing")
  ) {
    return "Schedule";
  }
  if (haystack.includes("trending")) return "Trending";

  // Home / idle with no loaded discovery route stays Browse — never invent Trending
  // just because leftover rows exist without a destination subtitle.
  return "Browse";
}
