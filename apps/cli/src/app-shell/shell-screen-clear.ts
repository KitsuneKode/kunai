import { undisplayPlacementsKeepCache } from "@/app-shell/image-pane";

import { plainModeEnabled } from "./plain-mode";

/**
 * Kitty/Ghostty image cleanup without full-frame ANSI clear (hot paths).
 * Placements only — the source/prepared byte caches stay warm so a surface
 * transition does not cold-start the whole poster pipeline.
 */
export function clearShellScreenArtifacts(): void {
  if (process.stdout.isTTY) {
    undisplayPlacementsKeepCache();
  }
}

/**
 * Erase the prior root-content frame before mounting a new session.
 * Used on root-content id transitions to avoid stale terminal rows.
 */
export function clearRootContentTransitionFrame(): void {
  if (!process.stdout.isTTY) return;
  undisplayPlacementsKeepCache();
  // Plain mode uses the primary screen. ESC[2J moves the cursor without
  // telling Ink, so the next frame's erase lands on the user's real terminal.
  if (plainModeEnabled()) return;
  process.stdout.write("\x1b[2J\x1b[H");
}
