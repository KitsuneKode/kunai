import { deleteAllKittyImages } from "@/app-shell/image-pane";

/** Kitty/Ghostty image cleanup without full-frame ANSI clear (hot paths). */
export function clearShellScreenArtifacts(): void {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
}

/**
 * Erase the prior root-content frame before mounting a new session.
 * Used on root-content id transitions to avoid stale terminal rows.
 */
export function clearRootContentTransitionFrame(): void {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
    process.stdout.write("\x1b[2J\x1b[H");
  }
}
