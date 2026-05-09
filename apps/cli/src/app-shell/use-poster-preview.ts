import { startTransition, useEffect, useReducer } from "react";

import { clearRenderedPosterImages, fetchPoster } from "./image-pane";
import type { PosterResult, PosterState } from "./poster-types";

type PosterPreviewModel = {
  poster: PosterResult;
  posterState: PosterState;
};

type PosterPreviewAction =
  | { type: "reset"; posterState: Extract<PosterState, "idle" | "unavailable"> }
  | { type: "loading" }
  | { type: "resolved"; result: PosterResult };

const initialPosterPreviewState: PosterPreviewModel = {
  poster: { kind: "none" },
  posterState: "idle",
};

function posterPreviewReducer(
  state: PosterPreviewModel,
  action: PosterPreviewAction,
): PosterPreviewModel {
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
  }: {
    rows: number;
    cols: number;
    enabled?: boolean;
    debounceMs?: number;
    variant?: "preview" | "detail";
    allowKitty?: boolean;
  },
): { poster: PosterResult; posterState: PosterState } {
  const [{ poster, posterState }, dispatch] = useReducer(
    posterPreviewReducer,
    initialPosterPreviewState,
  );

  useEffect(() => {
    clearRenderedPosterImages();

    if (!url || !enabled) {
      dispatch({
        type: "reset",
        posterState: url ? "unavailable" : "idle",
      });
      return undefined;
    }

    let cancelled = false;
    dispatch({ type: "loading" });

    const timer = setTimeout(() => {
      fetchPoster(url, { rows, cols, variant, allowKitty })
        .then((result) => {
          if (cancelled) return undefined;
          startTransition(() => {
            dispatch({ type: "resolved", result });
          });
          return undefined;
        })
        .catch(() => {
          if (cancelled) return;
          startTransition(() => {
            dispatch({ type: "reset", posterState: "unavailable" });
          });
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allowKitty, cols, debounceMs, enabled, rows, url, variant]);

  return { poster, posterState };
}

export const __testing = {
  posterPreviewReducer,
  initialPosterPreviewState,
};
