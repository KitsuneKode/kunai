import type { PosterResult, PosterState } from "../poster-types";
import { usePosterPreview } from "../use-poster-preview";
import { useSettledValue } from "./use-settled-value";

/** Shared "no poster" sentinel so suppression doesn't allocate a new object per render. */
const POSTER_NONE: PosterResult = { kind: "none" };

/**
 * Poster source for a navigable preview RAIL (history, queue, and similar large
 * single-hero rails). It combines the two anti-churn pieces the calendar/browse
 * fix proved out:
 *   1. the poster pipeline is keyed on the SETTLED url, so a run of ↑/↓ never
 *      spawns a chafa/Kitty subprocess mid-navigation; and
 *   2. while navigating, the heavy chafa text block is suppressed (returned as
 *      `{ kind: "none" }`) so Ink does not re-emit the multi-row color block on
 *      every keystroke. Kitty posters are drawn out-of-band as a tiny placeholder,
 *      so they are left in place (suppressing them would orphan the on-screen image).
 *
 * Returns the already-suppressed `poster` ready to hand to `PreviewRail`, plus
 * `navigating` for callers that want to adjust surrounding chrome.
 */
export function useRailPoster(
  url: string | undefined,
  opts: {
    readonly rows: number;
    readonly cols: number;
    readonly enabled?: boolean;
    readonly variant?: "preview" | "detail";
    readonly allowKitty?: boolean;
  },
): { poster: PosterResult; posterState: PosterState; spinner: boolean; navigating: boolean } {
  const settledUrl = useSettledValue(url);
  const navigating = url !== settledUrl;
  const { poster, posterState, spinner } = usePosterPreview(settledUrl, {
    rows: opts.rows,
    cols: opts.cols,
    enabled: (opts.enabled ?? true) && Boolean(settledUrl),
    variant: opts.variant,
    allowKitty: opts.allowKitty,
    placementSlot: "browse-preview",
    // The settled url already absorbs the navigation burst.
    debounceMs: 16,
  });
  const displayPoster = navigating && poster.kind === "text" ? POSTER_NONE : poster;
  // Never spin mid-navigation: the settled url has not caught up, so a spinner
  // here would fire on every ↑/↓ — the thing the settle debounce exists to stop.
  return { poster: displayPoster, posterState, spinner: spinner && !navigating, navigating };
}
