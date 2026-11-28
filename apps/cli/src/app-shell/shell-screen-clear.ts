import { undisplayPlacementsKeepCache } from "@/app-shell/image-pane";

import { plainModeEnabled, shouldSuppressRedraw } from "./plain-mode";

/**
 * Whether the mounted Ink root entered the alternate screen.
 * `null` means no root is mounted, so callers fall back to the live setting.
 * A settings toggle does not remount Ink, so this stays at the launch value
 * until `resetMountedInkScreen`.
 */
let mountedAlternateScreen: boolean | null = null;

/** Record the screen buffer `launchSessionApp` actually gave Ink. */
export function recordMountedInkScreen(alternateScreen: boolean): void {
  mountedAlternateScreen = alternateScreen;
}

/** Drop the launch record when the Ink root is released. */
export function resetMountedInkScreen(): void {
  mountedAlternateScreen = null;
}

function rootTransitionUsesAlternateScreen(): boolean {
  if (mountedAlternateScreen !== null) return mountedAlternateScreen;
  return !plainModeEnabled();
}

/**
 * Kitty/Ghostty image cleanup without full-frame ANSI clear (hot paths).
 * Placements only — the source/prepared byte caches stay warm so a surface
 * transition does not cold-start the whole poster pipeline.
 */
export function clearShellScreenArtifacts(): void {
  if (shouldSuppressRedraw() || !process.stdout.isTTY) return;
  undisplayPlacementsKeepCache();
}

/**
 * Erase the prior root-content frame before mounting a new session.
 * Used on root-content id transitions to avoid stale terminal rows.
 */
export function clearRootContentTransitionFrame(): void {
  if (!process.stdout.isTTY) return;
  undisplayPlacementsKeepCache();
  // ESC[2J moves the cursor without telling Ink. That is safe on the
  // alternate screen Ink owns, and it wipes the user's terminal when the
  // mounted root is still on the primary screen. The live plain-mode
  // setting is not that fact: it can change mid-session without a remount.
  if (!rootTransitionUsesAlternateScreen()) return;
  process.stdout.write("\x1b[2J\x1b[H");
}
