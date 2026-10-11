import { undisplayPlacementsKeepCache } from "@/app-shell/image-pane";

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
  if (process.stdout.isTTY) {
    undisplayPlacementsKeepCache();
    process.stdout.write("\x1b[2J\x1b[H");
  }
}
