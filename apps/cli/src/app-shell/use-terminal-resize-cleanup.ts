import { useEffect, useRef } from "react";

import { undisplayPlacementsKeepCache } from "./image-pane";
import { useShellDimensions } from "./use-viewport-policy";

/**
 * Clears Kitty/Ghostty poster placements when the terminal settles to new
 * dimensions. Keeps source bytes + chafa text cache warm; drops Kitty cache
 * entries so dead imageIds are not resurrected after d=A.
 */
export function useTerminalResizeCleanup(): void {
  const { cols, rows } = useShellDimensions();
  const settledRef = useRef({ cols, rows });

  useEffect(() => {
    if (cols === settledRef.current.cols && rows === settledRef.current.rows) {
      return;
    }
    settledRef.current = { cols, rows };
    undisplayPlacementsKeepCache();
  }, [cols, rows]);
}
