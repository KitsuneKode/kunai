/**
 * Per-platform install commands, and how to pick the one that applies here.
 *
 * One source, three consumers: the setup wizard's dependency screen, the shell's
 * startup issue strip, and `kunai doctor`. Each of those used to carry its own
 * shorter, drifted copy — setup told everyone `brew install yt-dlp · pip install
 * yt-dlp` regardless of platform, and offered `Install ffprobe from your platform
 * media-tools package`, which is not a command on any platform.
 *
 * `remediation` lines are generated from this rather than written alongside it,
 * so a command can never be right in one surface and stale in another.
 */
export type PlatformInstall = {
  readonly darwin?: string;
  readonly win32?: string;
  readonly arch?: string;
  readonly debian?: string;
  readonly fedora?: string;
  readonly suse?: string;
  /** Shown when nothing platform-specific matches. */
  readonly fallback?: string;
  /** Replaces every command: the dependency cannot be installed, only shipped. */
  readonly note?: string;
};

/** Linux package managers we probe for, most specific first. */
const LINUX_MANAGERS = [
  { command: "pacman", key: "arch" },
  { command: "apt", key: "debian" },
  { command: "dnf", key: "fedora" },
  { command: "zypper", key: "suse" },
] as const;

export type InstallProbe = (command: string) => string | null;

/**
 * The single command to show on *this* machine.
 *
 * Printing all five at once is what the setup screen used to do, and it made the
 * one line that applied harder to find rather than easier.
 */
export function resolveInstallCommand(
  install: PlatformInstall,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly which?: InstallProbe;
  } = {},
): string | null {
  if (install.note) return install.note;
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") return install.darwin ?? install.fallback ?? null;
  if (platform === "win32") return install.win32 ?? install.fallback ?? null;

  const which = options.which ?? ((command: string) => Bun.which(command));
  for (const manager of LINUX_MANAGERS) {
    // Probe rather than read /etc/os-release: a user on Arch with `apt` from a
    // container, or on an immutable distro, is described by what they can run.
    if (which(manager.command)) {
      const command = install[manager.key];
      if (command) return command;
    }
  }
  return install.fallback ?? null;
}

const REMEDIATION_LABELS: readonly (readonly [keyof PlatformInstall, string])[] = [
  ["arch", "Arch"],
  ["debian", "Debian"],
  ["fedora", "Fedora"],
  ["suse", "openSUSE"],
  ["darwin", "macOS"],
  ["win32", "Windows"],
  ["fallback", "Other"],
];

/** Every command, labelled — what `kunai doctor` prints and diagnostics carry. */
export function buildRemediationLines(install: PlatformInstall): readonly string[] {
  if (install.note) return [install.note];
  const lines: string[] = [];
  for (const [key, label] of REMEDIATION_LABELS) {
    const command = install[key];
    if (command) lines.push(`${label.padEnd(8)}${command}`);
  }
  return lines;
}

export const MPV_INSTALL: PlatformInstall = {
  arch: "sudo pacman -S mpv",
  debian: "sudo apt install mpv",
  fedora: "sudo dnf install mpv",
  suse: "sudo zypper install mpv",
  darwin: "brew install mpv",
  win32: "winget install --id mpv-player.mpv-CI.MSVC -e",
  fallback: "https://mpv.io/installation/",
};

export const YT_DLP_INSTALL: PlatformInstall = {
  arch: "sudo pacman -S yt-dlp",
  debian: "sudo apt install yt-dlp",
  fedora: "sudo dnf install yt-dlp",
  suse: "sudo zypper install yt-dlp",
  darwin: "brew install yt-dlp",
  win32: "winget install yt-dlp",
  fallback: "pip install yt-dlp",
};

/**
 * Named `ffmpeg`, not `ffprobe`. No platform ships a package called ffprobe —
 * it arrives inside ffmpeg — so telling a user to install ffprobe is
 * unactionable on all six.
 */
export const FFMPEG_INSTALL: PlatformInstall = {
  arch: "sudo pacman -S ffmpeg",
  debian: "sudo apt install ffmpeg",
  fedora: "sudo dnf install ffmpeg",
  suse: "sudo zypper install ffmpeg",
  darwin: "brew install ffmpeg",
  win32: "winget install Gyan.FFmpeg",
  fallback: "https://ffmpeg.org/download.html",
};

export const CURL_INSTALL: PlatformInstall = {
  arch: "sudo pacman -S curl",
  debian: "sudo apt install curl",
  fedora: "sudo dnf install curl",
  suse: "sudo zypper install curl",
  darwin: "brew install curl",
  win32: "curl.exe ships with Windows 10 1803 and newer",
  // Every PlatformInstall needs a reachable answer on a Linux host whose
  // package manager we do not recognise — a minimal container, an immutable
  // distro, Nix. Without this, `resolveInstallCommand` returns null there and a
  // row that needs attention has no way to describe the fix.
  fallback: "install curl with your distribution's package manager",
};

/**
 * Verified against upstream on 2026-08-25. curl-impersonate has **no** package
 * on Windows, Debian, Fedora, or openSUSE — only a Homebrew tap and Arch — so
 * everywhere else falls back to the releases page. A plausible-looking
 * `apt install curl-impersonate` would name a package that does not exist,
 * which is worse than no hint at all.
 */
export const CURL_IMPERSONATE_INSTALL: PlatformInstall = {
  arch: "sudo pacman -S curl-impersonate",
  darwin: "brew install lexiforest/tap/curl-impersonate",
  fallback: "https://github.com/lexiforest/curl-impersonate/releases",
};
