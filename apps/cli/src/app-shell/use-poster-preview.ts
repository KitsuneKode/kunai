import { useEffect, useState } from "react";

import { fetchPoster } from "./image-pane";
import type { PosterResult, PosterState } from "./poster-types";

export function usePosterPreview(
  url: string | undefined,
  {
    rows,
    cols,
    enabled = true,
    debounceMs = 120,
    variant = "preview",
  }: {
    rows: number;
    cols: number;
    enabled?: boolean;
    debounceMs?: number;
    variant?: "preview" | "detail";
  },
): { poster: PosterResult; posterState: PosterState } {
  const [poster, setPoster] = useState<PosterResult>({ kind: "none" });
  const [posterState, setPosterState] = useState<PosterState>("idle");

  useEffect(() => {
    if (!url || !enabled) {
      setPosterState(url ? "unavailable" : "idle");
      setPoster({ kind: "none" });
      return;
    }

    let cancelled = false;
    setPosterState("loading");
    const timer = setTimeout(() => {
      fetchPoster(url, { rows, cols, variant })
        .then((result) => {
          if (cancelled) return undefined;
          setPosterState(result.kind === "none" ? "unavailable" : "ready");
          setPoster(result);
          return undefined;
        })
        .catch(() => {
          if (cancelled) return;
          setPosterState("unavailable");
          setPoster({ kind: "none" });
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cols, debounceMs, enabled, rows, url, variant]);

  return { poster, posterState };
}
