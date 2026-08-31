import {
  buildAndroidIntentMissingProblem,
  buildMpvMissingProblem,
  buildUnsupportedPlayerProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import type { PlayerMode } from "@/domain/playback/player-choice";

export interface DependencyRemediation {
  readonly platform: "android" | "linux" | "darwin" | "win32" | "other";
  readonly summary: string;
  readonly commands: readonly string[];
  readonly helpUrl?: string;
}

export type PlaybackDependencyGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly dependency: "mpv" | "android-intent" | "player-selection";
      readonly problem: PlaybackProblem;
      readonly remediation: DependencyRemediation;
    };

function normalizePlatform(
  platform: NodeJS.Platform | undefined = process.platform,
): DependencyRemediation["platform"] {
  if (platform === "linux" || platform === "darwin" || platform === "win32") return platform;
  return "other";
}

export function buildMpvRemediation(platform?: NodeJS.Platform): DependencyRemediation {
  const normalized = normalizePlatform(platform);
  switch (normalized) {
    case "linux":
      return {
        platform: "linux",
        summary: "Install mpv with your distro package manager, then retry playback.",
        commands: ["sudo apt install mpv", "sudo pacman -S mpv", "sudo dnf install mpv"],
      };
    case "darwin":
      return {
        platform: "darwin",
        summary: "Install mpv with Homebrew, then retry playback.",
        commands: ["brew install mpv"],
      };
    case "win32":
      return {
        platform: "win32",
        summary: "Install mpv with winget, then retry playback.",
        commands: ["winget install --id mpv-player.mpv-CI.MSVC -e", "scoop install mpv"],
      };
    default:
      return {
        platform: "other",
        summary: "Install mpv for your platform and ensure it is on PATH.",
        commands: ["Install mpv from https://mpv.io/installation/"],
        helpUrl: "https://mpv.io/installation/",
      };
  }
}

export function buildAndroidPlayerRemediation(
  target: "chooser" | "vlc" | "mpv",
): DependencyRemediation {
  const app =
    target === "vlc" ? "VLC for Android" : target === "mpv" ? "mpv-android" : "VLC or mpv-android";
  return {
    platform: "android",
    summary: `Install ${app}, then install the termux-am package and retry.`,
    commands: ["pkg install termux-am"],
    helpUrl: "https://github.com/termux/TermuxAm",
  };
}

export async function gatePlaybackDependencies(input: {
  readonly player: { isAvailable(): Promise<boolean> };
  readonly playerMode?: PlayerMode;
  readonly platform?: NodeJS.Platform;
}): Promise<PlaybackDependencyGateResult> {
  if (input.playerMode?.kind === "unsupported") {
    return {
      ok: false,
      dependency: "player-selection",
      problem: buildUnsupportedPlayerProblem(),
      remediation: {
        platform: normalizePlatform(input.platform),
        summary: "Select the managed mpv player for this platform.",
        commands: ["kunai --player auto", "kunai --player mpv"],
      },
    };
  }

  if (await input.player.isAvailable()) {
    return { ok: true };
  }

  if (input.playerMode?.kind === "android-handoff") {
    const remediation = buildAndroidPlayerRemediation(input.playerMode.target);
    return {
      ok: false,
      dependency: "android-intent",
      problem: buildAndroidIntentMissingProblem({
        player: input.playerMode.target,
        remediationSummary: remediation.summary,
      }),
      remediation,
    };
  }

  const remediation = buildMpvRemediation(input.platform);
  return {
    ok: false,
    dependency: "mpv",
    problem: buildMpvMissingProblem({
      remediationSummary: remediation.summary,
      commands: remediation.commands,
    }),
    remediation,
  };
}
