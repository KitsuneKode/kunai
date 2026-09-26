import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { whichLive } from "../os/which";

/**
 * How to invoke mpv on this host. `argv` is the full spawn prefix —
 * `["mpv"]` for a PATH binary, `["flatpak", "run", "io.mpv.Mpv"]` for the
 * Flatpak.
 */
export type MpvInvocation = {
  readonly argv: readonly string[];
  readonly via: "path" | "flatpak";
};

export type MpvDiscoveryDeps = {
  /** Command lookup; injected by tests and by runtime seams that already carry one. */
  readonly which?: (command: string) => string | null;
  /** File/dir existence probe; injected by tests. */
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
};

const FLATPAK_MPV_APP_ID = "io.mpv.Mpv";

/**
 * Find a runnable mpv. Bare `Bun.which("mpv")` is what every call site used to
 * do — which reports "not installed" on a Steam Deck or any Flatpak-only host
 * where `flatpak run io.mpv.Mpv` would work fine.
 *
 * The flatpak leg follows ani-cli's ladder: a directory satisfies the check.
 * `flatpak info` costs a spawned process and a few hundred ms; the app's
 * install dir answers the same question for free at both system
 * (`/var/lib/flatpak`) and user (`~/.local/share/flatpak`) scope.
 *
 * Sandboxing: the official io.mpv.Mpv flatpak ships `--filesystem=host`, so the
 * IPC socket under the OS temp dir and any `--sub-file` paths stay visible to
 * the sandboxed player.
 */
export function discoverMpvInvocation(deps: MpvDiscoveryDeps = {}): MpvInvocation | null {
  // whichLive, not bare Bun.which: lookups must see the PATH in force now,
  // not the one captured when this process started.
  const which = deps.which ?? whichLive;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;

  if (which("mpv")) return { argv: ["mpv"], via: "path" };

  if (platform === "linux" && which("flatpak")) {
    const home = deps.homeDir ?? homedir();
    const appDirs = [
      `/var/lib/flatpak/app/${FLATPAK_MPV_APP_ID}`,
      join(home, `.local/share/flatpak/app/${FLATPAK_MPV_APP_ID}`),
    ];
    if (appDirs.some((dir) => exists(dir))) {
      return { argv: ["flatpak", "run", FLATPAK_MPV_APP_ID], via: "flatpak" };
    }
  }

  return null;
}
