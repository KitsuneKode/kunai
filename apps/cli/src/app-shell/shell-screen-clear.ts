import { deleteAllKittyImages } from "@/app-shell/image-pane";

/** Kitty/Ghostty image cleanup without full-frame ANSI clear (hot paths). */
export function clearShellScreenArtifacts(): void {
  if (process.stdout.isTTY) {
    deleteAllKittyImages();
  }
}

/**
 * Clean image artifacts before mounting a new root-content session.
 *
 * Prefer Kitty/Ghostty image cleanup only — a full ANSI `\x1b[2J` clear caused
 * blank-frame flashes between browse ↔ picker ↔ post-play. Ink's alternate
 * screen redraws the next frame; stale image protocols are the real leak.
 */
export function clearRootContentTransitionFrame(): void {
  clearShellScreenArtifacts();
}
