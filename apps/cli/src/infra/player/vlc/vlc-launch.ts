import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

import { whichLive } from "../../os/which";

/**
 * How Kunai drives desktop VLC. Measured against VLC 3.0.24 (see
 * `.docs/player-dossiers/vlc.md`): the Lua HTTP interface on 127.0.0.1 reports
 * state, position and decode counters, and accepts pause/seek/stop. Everything
 * here is pure or filesystem-only so it is testable without VLC.
 */

export type VlcDiscoveryDeps = {
  readonly which?: (command: string) => string | null;
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
};

/** The VLC executable to run, or null when none is installed where we look. */
export function discoverVlcBinary(deps: VlcDiscoveryDeps = {}): string | null {
  const which = deps.which ?? whichLive;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const onPath = which("vlc");
  if (onPath) return onPath;
  if (platform === "darwin") {
    const home = deps.homeDir ?? homedir();
    // The app bundle is not on PATH for a drag-to-Applications install.
    const candidates = [
      "/Applications/VLC.app/Contents/MacOS/VLC",
      posix.join(home, "Applications/VLC.app/Contents/MacOS/VLC"),
    ];
    return candidates.find((path) => exists(path)) ?? null;
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter((root): root is string =>
      Boolean(root),
    );
    const candidates = roots.map((root) => win32.join(root, "VideoLAN", "VLC", "vlc.exe"));
    return candidates.find((path) => exists(path)) ?? null;
  }
  // Flatpak VLC is not used: its sandbox has a private /tmp, so the session
  // config Kunai writes would be invisible to it.
  return null;
}

/** Where the user's own VLC preferences live, so a session can keep them. */
export function userVlcConfigPath(
  input: {
    readonly platform?: NodeJS.Platform;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly homeDir?: string;
  } = {},
): string {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const home = input.homeDir ?? homedir();
  if (platform === "darwin") {
    return posix.join(home, "Library/Preferences/org.videolan.vlc/vlcrc");
  }
  if (platform === "win32") {
    return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "vlc", "vlcrc");
  }
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), "vlc", "vlcrc");
}

/**
 * Write the config file a VLC session starts with: a copy of the user's own
 * vlcrc, so their skins, hotkeys and audio settings survive, plus the HTTP
 * interface password in a trailing `[lua]` section. VLC applies the last value
 * of a key, so this wins over any password the user set. The password never
 * appears in argv; the file is owner-only inside a private temp directory.
 */
export async function writeVlcSessionConfig(input: {
  readonly dir: string;
  readonly password: string;
  readonly userConfigPath: string;
}): Promise<string> {
  let base = "";
  try {
    base = await readFile(input.userConfigPath, "utf8");
  } catch {
    // No user config yet (VLC never run, or never saved settings).
  }
  const path = join(input.dir, "vlcrc");
  const suffix = base.length === 0 || base.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${base}${suffix}\n[lua]\nhttp-password=${input.password}\n`, {
    mode: 0o600,
  });
  return path;
}

export type VlcLaunchInput = {
  readonly port: number;
  readonly configPath: string;
  readonly url: string;
  readonly title: string;
  readonly startAtSeconds?: number;
  /** One subtitle, attached to this input only (a global one leaks into the next). */
  readonly subtitle?: string;
  /** Test and headless hooks (`--intf=dummy`, `--vout=dummy`); empty in normal use. */
  readonly extraArgs?: readonly string[];
};

/**
 * argv for one VLC session. VLC keeps its own interface (the user's GUI); Kunai
 * only adds a loopback control interface and pins the behaviours that would
 * otherwise break observation.
 */
export function buildVlcArgs(input: VlcLaunchInput): string[] {
  const args = [
    "--extraintf=http",
    "--http-host=127.0.0.1",
    `--http-port=${input.port}`,
    `--config=${input.configPath}`,
    // A user's single-instance setting would hand the URL to another VLC and
    // exit at once; Kunai needs its own process to observe and to stop.
    "--no-one-instance",
    "--no-playlist-enqueue",
    // Loop/repeat/random from the user's config would keep the file from ending.
    "--no-loop",
    "--no-repeat",
    "--no-random",
    "--play-and-exit",
    "--no-video-title-show",
    "--no-qt-privacy-ask",
    ...(input.extraArgs ?? []),
    input.url,
    `:meta-title=${input.title}`,
  ];
  if (input.startAtSeconds !== undefined && input.startAtSeconds > 0) {
    args.push(`:start-time=${Math.floor(input.startAtSeconds)}`);
  }
  if (input.subtitle) {
    // Measured: `:input-slave` loads an HTTP subtitle; `:sub-file` does not.
    args.push(
      /^https?:\/\//i.test(input.subtitle)
        ? `:input-slave=${input.subtitle}`
        : `:sub-file=${input.subtitle}`,
    );
  }
  return args;
}
