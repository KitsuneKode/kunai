import { startTransition, useEffect, useReducer, useRef } from "react";

import { fetchPoster, undisplayRenderedPosterImages } from "./image-pane";
import type { PosterResult, PosterState } from "./poster-types";

type PosterPreviewState = {
  readonly poster: PosterResult;
  readonly posterState: PosterState;
};

type PosterPreviewAction =
  | { type: "reset"; posterState: PosterState }
  | { type: "loading" }
  | { type: "resolved"; result: PosterResult };

const initialPosterPreviewState: PosterPreviewState = {
  poster: { kind: "none" },
  posterState: "idle",
};

function posterPreviewReducer(
  state: PosterPreviewState,
  action: PosterPreviewAction,
): PosterPreviewState {
  switch (action.type) {
    case "reset":
      return { poster: { kind: "none" }, posterState: action.posterState };
    case "loading":
      // Already loading: return the SAME reference so React bails out of the
      // re-render. Without this, holding ↑/↓ dispatches "loading" on every
      // keystroke and each new object forces an extra render during navigation.
      if (state.posterState === "loading") return state;
      // Preserve previous poster while loading to avoid flash when switching episodes
      return { poster: state.poster, posterState: "loading" };
    case "resolved":
      return {
        poster: action.result,
        posterState: action.result.kind === "none" ? "unavailable" : "ready",
      };
    default:
      return state;
  }
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
  }: {
    rows: number;
    cols: number;
    enabled?: boolean;
    debounceMs?: number;
    variant?: "preview" | "detail";
    allowKitty?: boolean;
    inkEmbedded?: boolean;
    preserveTerminalImages?: boolean;
  },
): { poster: PosterResult; posterState: PosterState } {
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
      if (!preserveTerminalImages) undisplayRenderedPosterImages();
      dispatch({ type: "reset", posterState: url ? "unavailable" : "idle" });
      return undefined;
    }

    // A Kitty placement is anchored to terminal cells. Keep the previous image while
    // changing titles, but clear it immediately when its geometry becomes invalid.
    if (geometryChanged && !preserveTerminalImages) undisplayRenderedPosterImages();

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
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
      if (!preserveTerminalImages) undisplayRenderedPosterImages();
      dispatch({ type: "loading" });
      fetchPoster(url, { rows, cols, variant, allowKitty, inkEmbedded })
        .then((result) => {
          if (cancelled) return undefined;
          if (result.kind === "none") scheduleRetryIfFirstFailure();
          startTransition(() => dispatch({ type: "resolved", result }));
          return undefined;
        })
        .catch(() => {
          if (cancelled) return;
          scheduleRetryIfFirstFailure();
          startTransition(() => dispatch({ type: "reset", posterState: "unavailable" }));
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      // Do not call clearRenderedPosterImages here — the incoming effect's fetch
      // clears just before rendering its result, preserving the old image during load.
    };
  }, [
    allowKitty,
    cols,
    debounceMs,
    enabled,
    inkEmbedded,
    preserveTerminalImages,
    retryToken,
    rows,
    url,
    variant,
  ]);

  return { poster: state.poster, posterState: state.posterState };
}

export const __testing = {
  initialPosterPreviewState,
  posterPreviewReducer,
};
