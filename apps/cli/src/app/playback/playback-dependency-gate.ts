import {
  buildAndroidIntentMissingProblem,
  buildMpvMissingProblem,
  buildVlcMissingProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import type { PlayerMode } from "@/domain/playback/player-choice";
import {
  MPV_INSTALL,
  resolveInstallCommand,
  type InstallProbe,
  VLC_INSTALL,
} from "@/infra/os/install-commands";
import { whichLive } from "@/infra/os/which";

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
      readonly dependency: "mpv" | "vlc" | "android-intent";
      readonly problem: PlaybackProblem;
      readonly remediation: DependencyRemediation;
    };

function normalizePlatform(
  platform: NodeJS.Platform | undefined = process.platform,
): DependencyRemediation["platform"] {
  if (platform === "linux" || platform === "darwin" || platform === "win32") return platform;
  return "other";
}

function buildDesktopRemediation(
  player: "mpv" | "VLC",
  platform = process.platform,
  which: InstallProbe = whichLive,
): DependencyRemediation {
  const install = player === "mpv" ? MPV_INSTALL : VLC_INSTALL;
  const command = resolveInstallCommand(install, { platform, which });
  const tool = player === "mpv" ? "mpv" : "VLC with its ffmpeg decoder plugin";
  return {
    platform: normalizePlatform(platform),
    summary: `Install ${tool}, then retry playback.`,
    commands: command ? [command] : [],
    ...(command && command === install.fallback && { helpUrl: command }),
  };
}

export function buildMpvRemediation(
  platform?: NodeJS.Platform,
  which?: InstallProbe,
): DependencyRemediation {
  return buildDesktopRemediation("mpv", platform, which);
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
  readonly which?: InstallProbe;
}): Promise<PlaybackDependencyGateResult> {
  if (await input.player.isAvailable()) {
    return { ok: true };
  }

  if (input.playerMode?.kind === "managed-vlc") {
    const remediation = buildDesktopRemediation("VLC", input.platform, input.which);
    return {
      ok: false,
      dependency: "vlc",
      problem: buildVlcMissingProblem({
        remediationSummary: remediation.summary,
        commands: remediation.commands,
      }),
      remediation,
    };
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

  const remediation = buildMpvRemediation(input.platform, input.which);
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
