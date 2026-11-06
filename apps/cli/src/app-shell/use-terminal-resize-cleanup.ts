import { useEffect, useRef } from "react";

import { undisplayPlacementsForViewportResize } from "./image-pane";
import { useSettledShellDimensions } from "./use-viewport-policy";

/**
 * Clears poster placements when the terminal settles to new dimensions (shrink
 * immediately, grow after debounce — same timing as
 * `useDebouncedViewportPolicy`). Avoids wiping on every raw resize during a drag.
 * Kitty paths use per-slot `d=I` deletes when possible; others use a global wipe.
 */
export function useTerminalResizeCleanup(): void {
  const { cols, rows } = useSettledShellDimensions();
  const settledRef = useRef({ cols, rows });

  useEffect(() => {
    if (cols === settledRef.current.cols && rows === settledRef.current.rows) {
      return;
    }
    settledRef.current = { cols, rows };
    undisplayPlacementsForViewportResize();
  }, [cols, rows]);
}
