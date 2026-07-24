import { startTransition, useEffect, useReducer, useRef } from "react";

import {
  fetchPoster,
  isPosterCached,
  releasePosterPlacement,
  undisplayRenderedPosterImages,
  type KittyPlacementSlot,
} from "./image-pane";
import type { PosterResult, PosterState } from "./poster-types";

/**
 * How long an uncached poster may stay pending before a surface may show a
 * spinner. Below this the fetch usually lands within a frame or two and the
 * spinner would read as a flicker, not as progress.
 */
export const POSTER_SPINNER_DELAY_MS = 150;

type PosterPreviewState = {
  readonly poster: PosterResult;
  readonly posterState: PosterState;
  /**
   * True only when this fetch missed the cache AND has been pending past
   * POSTER_SPINNER_DELAY_MS. Surfaces show a spinner on this, never on
   * `posterState === "loading"`, which is also true for cache hits.
   */
  readonly spinner: boolean;
};

type PosterPreviewAction =
  | { type: "reset"; posterState: PosterState }
  | { type: "loading" }
  | { type: "spinner" }
  | { type: "resolved"; result: PosterResult };

const initialPosterPreviewState: PosterPreviewState = {
  poster: { kind: "none" },
  posterState: "idle",
  spinner: false,
};

function posterPreviewReducer(
  state: PosterPreviewState,
  action: PosterPreviewAction,
): PosterPreviewState {
  switch (action.type) {
    case "reset":
      return { poster: { kind: "none" }, posterState: action.posterState, spinner: false };
    case "loading":
      // Already loading: return the SAME reference so React bails out of the
      // re-render. Without this, holding ↑/↓ dispatches "loading" on every
      // keystroke and each new object forces an extra render during navigation.
      if (state.posterState === "loading") return state;
      // Preserve previous poster while loading to avoid flash when switching episodes
      return { poster: state.poster, posterState: "loading", spinner: false };
    case "spinner":
      // Only a still-pending fetch may raise the spinner: the arming timer can
      // outlive the resolve it was armed for.
      if (state.spinner || state.posterState !== "loading") return state;
      return { ...state, spinner: true };
    case "resolved":
      return {
        poster: action.result,
        posterState: action.result.kind === "none" ? "unavailable" : "ready",
        spinner: false,
      };
    default:
      return state;
  }
}

/**
 * Release this hook's Kitty placement without wiping sibling slots.
 * Falls back to global wipe only when no placementSlot is bound.
 */
function releaseOwnedPlacement(
  placementSlot: KittyPlacementSlot | undefined,
  preserveTerminalImages: boolean,
): void {
  if (preserveTerminalImages) return;
  if (placementSlot) {
    releasePosterPlacement(placementSlot);
    return;
  }
  undisplayRenderedPosterImages();
}

export function usePosterPreview(
  url: string | undefined,
  {
    rows,
    cols,
    enabled = true,
    debounceMs = 120,
    variant = "preview",
    allowKitty = true,
    inkEmbedded = false,
    preserveTerminalImages = false,
    placementSlot,
  }: {
    rows: number;
    cols: number;
    enabled?: boolean;
    debounceMs?: number;
    variant?: "preview" | "detail";
    allowKitty?: boolean;
    inkEmbedded?: boolean;
    /** When true, never delete Kitty placements (chafa mini-tiles alongside a hero). */
    preserveTerminalImages?: boolean;
    /** Named Kitty slot — per-fetch cleanup deletes only this slot. */
    placementSlot?: KittyPlacementSlot;
  },
): { poster: PosterResult; posterState: PosterState; spinner: boolean } {
  const [state, dispatch] = useReducer(posterPreviewReducer, initialPosterPreviewState);
  const previousGeometry = useRef<{ readonly rows: number; readonly cols: number } | null>(null);
  // One delayed retry per URL: a transient fetch failure (busy machine right
  // after mpv teardown, slow TMDB edge) otherwise leaves the initials fallback
  // on screen forever because nothing re-arms the effect. Failed fetches are
  // never cached, so the retry genuinely refetches.
  const retryAttempted = useRef<string | null>(null);
  const [retryToken, bumpRetryToken] = useReducer((token: number) => token + 1, 0);

  useEffect(() => {
    const geometryChanged =
      previousGeometry.current !== null &&
      (previousGeometry.current.rows !== rows || previousGeometry.current.cols !== cols);
    previousGeometry.current = { rows, cols };

    if (!url || !enabled) {
      releaseOwnedPlacement(placementSlot, preserveTerminalImages);
      dispatch({ type: "reset", posterState: url ? "unavailable" : "idle" });
      return undefined;
    }

    // Chafa / denied-Kitty paths must still drop a prior Kitty for this slot so
    // a sibling (hero) can own the budget without a ghost rail image.
    if (placementSlot && (inkEmbedded || !allowKitty) && !preserveTerminalImages) {
      releasePosterPlacement(placementSlot);
    }

    // A Kitty placement is anchored to terminal cells. Keep the previous image while
    // changing titles, but clear this slot immediately when its geometry becomes invalid.
    // Geometry changes on a slotted preview only release this slot; unslotted previews
    // still use a global wipe because placeholders may misalign everywhere after resize.
    if (geometryChanged) {
      if (placementSlot && !preserveTerminalImages) {
        releasePosterPlacement(placementSlot);
      } else if (!preserveTerminalImages && !placementSlot) {
        undisplayRenderedPosterImages();
      }
    }

    let cancelled = false;
    const abort = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetryIfFirstFailure = () => {
      if (retryAttempted.current === url) return;
      retryAttempted.current = url;
      retryTimer = setTimeout(() => {
        if (!cancelled) bumpRetryToken();
      }, 1_500);
    };
    // Defer both the "loading" commit and the fetch until the debounce fires.
    // Dispatching "loading" immediately on enable forced an extra Ink frame on
    // every selection change (calendar mini-posters, rail previews) even when the
    // fetch was about to be cancelled by the next keystroke.
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Do NOT global-wipe before fetch. Slot registration replaces the previous
      // imageId for this slot; siblings keep their placements.
      dispatch({ type: "loading" });
      const fetchOptions = { rows, cols, variant, allowKitty, inkEmbedded, placementSlot };
      // Arm the spinner only for a genuine cache miss. A cached poster paints on
      // the next frame, so spinning for it would flash on every revisit — the
      // exact "spinner on every navigation move" this policy exists to avoid.
      if (!isPosterCached(url, fetchOptions)) {
        spinnerTimer = setTimeout(() => {
          if (!cancelled && !abort.signal.aborted) dispatch({ type: "spinner" });
        }, POSTER_SPINNER_DELAY_MS);
      }
      fetchPoster(url, { ...fetchOptions, signal: abort.signal })
        .then((result) => {
          if (cancelled || abort.signal.aborted) return undefined;
          if (result.kind === "none") scheduleRetryIfFirstFailure();
          startTransition(() => dispatch({ type: "resolved", result }));
          return undefined;
        })
        .catch(() => {
          if (cancelled || abort.signal.aborted) return;
          scheduleRetryIfFirstFailure();
          startTransition(() => dispatch({ type: "reset", posterState: "unavailable" }));
        })
        // Settled either way: stop the arming timer so a slow-but-successful
        // fetch cannot raise a spinner over an image that already painted.
        .finally(() => {
          if (spinnerTimer !== undefined) clearTimeout(spinnerTimer);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (spinnerTimer !== undefined) clearTimeout(spinnerTimer);
      // Do not release the slot here — the incoming effect's fetch registers a
      // replacement imageId (or the disable path releases explicitly).
    };
  }, [
    allowKitty,
    cols,
    debounceMs,
    enabled,
    inkEmbedded,
    placementSlot,
    preserveTerminalImages,
    retryToken,
    rows,
    url,
    variant,
  ]);

  return { poster: state.poster, posterState: state.posterState, spinner: state.spinner };
}

export const __testing = {
  initialPosterPreviewState,
  posterPreviewReducer,
};
