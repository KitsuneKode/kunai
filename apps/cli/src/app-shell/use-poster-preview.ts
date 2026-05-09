import { startTransition, useEffect, useReducer } from "react";

import { clearRenderedPosterImages, fetchPoster } from "./image-pane";
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
  _state: PosterPreviewState,
  action: PosterPreviewAction,
): PosterPreviewState {
  switch (action.type) {
    case "reset":
      return { poster: { kind: "none" }, posterState: action.posterState };
    case "loading":
      return { poster: { kind: "none" }, posterState: "loading" };
    case "resolved":
      return {
        poster: action.result,
        posterState: action.result.kind === "none" ? "unavailable" : "ready",
      };
    default:
      return _state;
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
  }: {
    rows: number;
    cols: number;
    enabled?: boolean;
    debounceMs?: number;
    variant?: "preview" | "detail";
    allowKitty?: boolean;
  },
): { poster: PosterResult; posterState: PosterState } {
  const [state, dispatch] = useReducer(posterPreviewReducer, initialPosterPreviewState);

  useEffect(() => {
    clearRenderedPosterImages();

    if (!url || !enabled) {
      dispatch({ type: "reset", posterState: url ? "unavailable" : "idle" });
      return undefined;
    }

    let cancelled = false;
    dispatch({ type: "loading" });

    const timer = setTimeout(() => {
      fetchPoster(url, { rows, cols, variant, allowKitty })
        .then((result) => {
          if (cancelled) return undefined;
          startTransition(() => dispatch({ type: "resolved", result }));
          return undefined;
        })
        .catch(() => {
          if (cancelled) return;
          startTransition(() => dispatch({ type: "reset", posterState: "unavailable" }));
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allowKitty, cols, debounceMs, enabled, rows, url, variant]);

  return { poster: state.poster, posterState: state.posterState };
}

export const __testing = {
  initialPosterPreviewState,
  posterPreviewReducer,
};
