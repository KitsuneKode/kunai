export type PlayerChoice = "auto" | "mpv" | "vlc";
export type DetachedPlayerTarget = "chooser" | "mpv" | "vlc";
export type SupportedPlayerPlatform = "android" | "linux" | "darwin" | "win32" | "other";

export type PlayerMode =
  | { readonly kind: "managed-mpv" }
  | { readonly kind: "android-handoff"; readonly target: DetachedPlayerTarget }
  | { readonly kind: "unsupported"; readonly choice: PlayerChoice };

export function parsePlayerChoice(value: string | undefined): PlayerChoice {
  if (value === undefined || value === "auto") return "auto";
  if (value === "mpv" || value === "vlc") return value;
  throw new Error(`Invalid --player value "${value}"; expected auto, mpv, or vlc.`);
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

export function resolvePlayerMode(input: {
  readonly choice: PlayerChoice;
  readonly platform: SupportedPlayerPlatform;
}): PlayerMode {
  if (input.platform === "android") {
    return {
      kind: "android-handoff",
      target: input.choice === "auto" ? "chooser" : input.choice,
    };
  }
  if (input.choice === "vlc") {
    return { kind: "unsupported", choice: "vlc" };
  }
  return { kind: "managed-mpv" };
}
