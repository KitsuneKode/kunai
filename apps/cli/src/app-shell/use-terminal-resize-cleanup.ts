import { useEffect, useRef } from "react";

import { clearRenderedPosterImages } from "./image-pane";
import { useShellDimensions } from "./use-viewport-policy";

/**
 * Clears Kitty/Ghostty poster placements when the terminal settles to new
 * dimensions. Does not evict the poster fetch cache — avoids refetch storms.
 */
export function useTerminalResizeCleanup(): void {
  const { cols, rows } = useShellDimensions();
  const settledRef = useRef({ cols, rows });

  useEffect(() => {
    if (cols === settledRef.current.cols && rows === settledRef.current.rows) {
      return;
    }
    settledRef.current = { cols, rows };
    clearRenderedPosterImages();
  }, [cols, rows]);
}
