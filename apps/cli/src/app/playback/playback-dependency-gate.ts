import { buildMpvMissingProblem, type PlaybackProblem } from "@/domain/playback/playback-problem";

export interface DependencyRemediation {
  readonly platform: "linux" | "darwin" | "win32" | "other";
  readonly summary: string;
  readonly commands: readonly string[];
  readonly helpUrl?: string;
}

export type PlaybackDependencyGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly dependency: "mpv";
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
        summary: "Install mpv.net with winget, then retry playback.",
        commands: ["winget install --id mpv.net -e"],
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

export async function gatePlaybackDependencies(input: {
  readonly player: { isAvailable(): Promise<boolean> };
  readonly platform?: NodeJS.Platform;
}): Promise<PlaybackDependencyGateResult> {
  if (await input.player.isAvailable()) {
    return { ok: true };
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
