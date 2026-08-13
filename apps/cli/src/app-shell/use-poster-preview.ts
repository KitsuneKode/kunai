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
  /** Input identity that produced `poster`; used to hide stale sixel overlays. */
  readonly sourceKey: string | null;
  /**
   * Input identity of the request the surface is currently waiting on. A
   * completion that does not match it belongs to a row the user already left,
   * so it must not paint over the settled one.
   */
  readonly pendingKey: string | null;
  /**
   * True only when this fetch missed the cache AND has been pending past
   * POSTER_SPINNER_DELAY_MS. Surfaces show a spinner on this, never on
   * `posterState === "loading"`, which is also true for cache hits.
   */
  readonly spinner: boolean;
};

type PosterPreviewAction =
  | { type: "reset"; posterState: PosterState }
  | { type: "loading"; sourceKey?: string }
  | { type: "spinner" }
  | { type: "resolved"; result: PosterResult; sourceKey?: string };

const initialPosterPreviewState: PosterPreviewState = {
  poster: { kind: "none" },
  posterState: "idle",
  sourceKey: null,
  pendingKey: null,
  spinner: false,
};

function posterPreviewReducer(
  state: PosterPreviewState,
  action: PosterPreviewAction,
): PosterPreviewState {
  switch (action.type) {
    case "reset":
      return {
        poster: { kind: "none" },
        posterState: action.posterState,
        sourceKey: null,
        pendingKey: null,
        spinner: false,
      };
    case "loading": {
      const pendingKey = action.sourceKey ?? null;
      // Already loading the SAME request: return the same reference so React
      // bails out of the re-render. Without this, holding ↑/↓ dispatches
      // "loading" on every keystroke and each new object forces an extra
      // render during navigation.
      if (state.posterState === "loading" && state.pendingKey === pendingKey) return state;
      // Preserve previous poster while loading to avoid flash when switching episodes
      return {
        poster: state.poster,
        posterState: "loading",
        sourceKey: state.sourceKey,
        pendingKey,
        spinner: false,
      };
    }
    case "spinner":
      // Only a still-pending fetch may raise the spinner: the arming timer can
      // outlive the resolve it was armed for.
      if (state.spinner || state.posterState !== "loading") return state;
      return { ...state, spinner: true };
    case "resolved": {
      const resolvedKey = action.sourceKey ?? null;
      // Last line of defence against a stale completion. Effect cleanup already
      // cancels the losing fetch, but a burst can settle row B and then let
      // row A's slower fetch land; that result must not paint.
      if (state.pendingKey !== null && resolvedKey !== state.pendingKey) return state;
      return {
        poster: action.result,
        posterState: action.result.kind === "none" ? "unavailable" : "ready",
        sourceKey: resolvedKey,
        pendingKey: state.pendingKey,
        spinner: false,
      };
    }
    default:
      return state;
  }
}

function posterRequestKey(
  url: string | undefined,
  options: {
    readonly rows: number;
    readonly cols: number;
    readonly variant: "preview" | "detail";
    readonly allowKitty: boolean;
    readonly allowSixel: boolean;
    readonly inkEmbedded: boolean;
    readonly placementSlot: KittyPlacementSlot | undefined;
  },
): string | null {
  if (!url) return null;
  return JSON.stringify([
    url,
    options.rows,
    options.cols,
    options.variant,
    options.allowKitty ? "kitty" : "no-kitty",
    options.allowSixel ? "sixel" : "no-sixel",
    options.inkEmbedded ? "ink" : "terminal",
    options.placementSlot ?? "unslotted",
  ]);
}

function visiblePosterPreviewState(
  state: PosterPreviewState,
  currentSourceKey: string | null,
): PosterPreviewState {
  if (state.poster.kind !== "sixel" || state.sourceKey === currentSourceKey) return state;
  // Sixel is a framebuffer overlay, so retaining a result from the previous
  // URL/geometry visibly paints stale pixels. Text and Kitty keep their existing
  // warm-transition policy; the overlay path must instead unmount and unregister.
  return {
    poster: { kind: "none" },
    posterState: currentSourceKey === null ? "idle" : "loading",
    sourceKey: state.sourceKey,
    pendingKey: state.pendingKey,
    spinner: false,
  };
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
    allowSixel = true,
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
    allowSixel?: boolean;
    inkEmbedded?: boolean;
    /** When true, never delete Kitty placements (text mini-tiles alongside a hero). */
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
  const requestKey = posterRequestKey(url, {
    rows,
    cols,
    variant,
    allowKitty,
    allowSixel,
    inkEmbedded,
    placementSlot,
  });

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
      dispatch({ type: "loading", sourceKey: requestKey ?? undefined });
      const fetchOptions = {
        rows,
        cols,
        variant,
        allowKitty,
        allowSixel,
        inkEmbedded,
        placementSlot,
      };
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
          startTransition(() =>
            dispatch({ type: "resolved", result, sourceKey: requestKey ?? undefined }),
          );
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
    allowSixel,
    cols,
    debounceMs,
    enabled,
    inkEmbedded,
    placementSlot,
    preserveTerminalImages,
    requestKey,
    retryToken,
    rows,
    url,
    variant,
  ]);

  const visibleState = visiblePosterPreviewState(state, enabled ? requestKey : null);
  return {
    poster: visibleState.poster,
    posterState: visibleState.posterState,
    spinner: visibleState.spinner,
  };
}

export const __testing = {
  initialPosterPreviewState,
  posterRequestKey,
  posterPreviewReducer,
  visiblePosterPreviewState,
};
