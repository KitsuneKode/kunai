import { isAndroidRuntime } from "@/domain/platform-runtime";

export type PlayerChoice = "auto" | "mpv" | "vlc";
export type DetachedPlayerTarget = "chooser" | "mpv" | "vlc";
export type SupportedPlayerPlatform = "android" | "linux" | "darwin" | "win32" | "other";

export type PlayerMode =
  | { readonly kind: "managed-mpv" }
  | { readonly kind: "managed-vlc" }
  | { readonly kind: "android-handoff"; readonly target: DetachedPlayerTarget };

export type ManagedPlayerKind = "mpv" | "vlc";

/**
 * The managed desktop binary the selected mode must have, or null when playback
 * is handed to Android. Startup, setup, and doctor all read this instead of
 * re-deriving an mpv boolean, so an auto-VLC machine cannot be healthy in one
 * surface and broken in another.
 */
export function requiredManagedPlayer(mode: PlayerMode): ManagedPlayerKind | null {
  if (mode.kind === "managed-mpv") return "mpv";
  if (mode.kind === "managed-vlc") return "vlc";
  return null;
}

export function parsePlayerChoice(value: string | undefined): PlayerChoice {
  if (value === undefined || value === "auto") return "auto";
  if (value === "mpv" || value === "vlc") return value;
  throw new Error(`Invalid --player value "${value}"; expected auto, mpv, or vlc.`);
}

/**
 * The player for this launch: an explicit `--player` wins, then the choice
 * saved in Settings, then auto. A hand-edited, unknown saved value is auto
 * rather than a startup error.
 */
export function effectivePlayerChoice(
  flag: PlayerChoice | undefined,
  saved: string | undefined,
): PlayerChoice {
  if (flag) return flag;
  return saved === "mpv" || saved === "vlc" ? saved : "auto";
}

export function normalizePlayerPlatform(platform: string): SupportedPlayerPlatform {
  if (
    platform === "android" ||
    platform === "linux" ||
    platform === "darwin" ||
    platform === "win32"
  ) {
    return platform;
  }
  return "other";
}

export function detectPlayerPlatform(
  input: {
    readonly platform?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): SupportedPlayerPlatform {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  if (isAndroidRuntime(platform, env)) {
    return "android";
  }
  return normalizePlayerPlatform(platform);
}

/** Desktop players found on this machine; `--player auto` reads it. */
export type InstalledPlayers = { readonly mpv: boolean; readonly vlc: boolean };

export type ResolvePlayerModeInput = {
  readonly choice: PlayerChoice;
  readonly platform: SupportedPlayerPlatform;
  readonly installed?: InstalledPlayers;
};

export function resolvePlayerMode(input: ResolvePlayerModeInput): PlayerMode {
  if (input.platform === "android") {
    return {
      kind: "android-handoff",
      target: input.choice === "auto" ? "chooser" : input.choice,
    };
  }
  // Desktop VLC runs observed (`infra/player/vlc/vlc-player-service.ts`);
  // discovery looks on PATH, so this holds for BSDs and other desktops too.
  if (input.choice === "vlc") return { kind: "managed-vlc" };
  // `auto` with VLC but no mpv plays in VLC rather than telling a new user
  // nothing can play. With neither, mpv stays the choice so its install
  // guidance shows.
  if (input.choice === "auto" && input.installed?.vlc && !input.installed.mpv) {
    return { kind: "managed-vlc" };
  }
  return { kind: "managed-mpv" };
}
