import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ImageCapability } from "@/image";
import { detectImageCapability } from "@/image";
import { resolveAnidbCurl } from "@kunai/providers";
import { getKunaiPaths } from "@kunai/storage";

// ── Dependency check ───────────────────────────────────────────────────────

export type CapabilitySeverity = "fatal" | "degraded";

export interface CapabilityIssue {
  readonly id: "mpv-missing" | "yt-dlp-missing" | "curl-missing" | "poster-rendering-unavailable";
  readonly severity: CapabilitySeverity;
  readonly message: string;
  readonly remediation: readonly string[];
}

export interface CapabilitySnapshot {
  readonly mpv: boolean;
  /** Optional post-download probe (`ffprobe` on PATH); not required for the queue. */
  readonly ffprobe: boolean;
  readonly ytDlp: boolean;
  /**
   * A curl the AniDB provider can use — plain `curl` or a curl-impersonate
   * build. AniDB is the default anime provider and anidb.app sits behind
   * Cloudflare, so this is a real dependency of the default route, not a nicety.
   */
  readonly curl: boolean;
  readonly image: ImageCapability;
  readonly issues: readonly CapabilityIssue[];
}

type CapabilityNoticeState = {
  readonly version: string;
  readonly fingerprint: string;
};

const NOTICE_DIR = getKunaiPaths().configDir;
const NOTICE_FILE = join(NOTICE_DIR, "capability-notice.json");

function capabilityFingerprint(snapshot: CapabilitySnapshot): string {
  const issueBits = [...snapshot.issues]
    .map((issue) => `${issue.id}:${issue.severity}`)
    .sort()
    .join(",");
  return `mpv:${snapshot.mpv ? "1" : "0"}|ffprobe:${snapshot.ffprobe ? "1" : "0"}|ytDlp:${snapshot.ytDlp ? "1" : "0"}|curl:${snapshot.curl ? "1" : "0"}|image:${snapshot.image.renderer}|terminal:${snapshot.image.terminal}|issues:${issueBits}`;
}

async function loadCapabilityNoticeState(): Promise<CapabilityNoticeState | null> {
  try {
    const file = Bun.file(NOTICE_FILE);
    if (!(await file.exists())) return null;
    const parsed = (await file.json()) as Partial<CapabilityNoticeState>;
    if (typeof parsed.version !== "string" || typeof parsed.fingerprint !== "string") {
      return null;
    }
    return { version: parsed.version, fingerprint: parsed.fingerprint };
  } catch {
    return null;
  }
}

async function saveCapabilityNoticeState(state: CapabilityNoticeState): Promise<void> {
  await mkdir(NOTICE_DIR, { recursive: true });
  await Bun.write(NOTICE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Read-only dependency/capability probe. Never persists notice state.
 * Prefer this for doctor and other inspection-only callers.
 */
export async function probeCapabilities(
  options: {
    requireYtDlp?: boolean;
    /** PATH lookup seam; defaults to the real one. Injected by tests. */
    which?: (command: string) => string | null;
  } = {},
): Promise<CapabilitySnapshot> {
  const requireYtDlp = options.requireYtDlp ?? false;
  const which = options.which ?? ((command: string) => Bun.which(command));
  const issues: CapabilityIssue[] = [];
  const mpv = Boolean(which("mpv"));
  const ffprobe = Boolean(which("ffprobe"));
  const ytDlp = Boolean(which("yt-dlp"));
  // Ask the provider which binaries it can actually drive: it prefers a
  // curl-impersonate build over plain curl, so probing for the literal "curl"
  // would report missing on a host that is fully capable.
  const curl = resolveAnidbCurl(which) !== null;
  const image = detectImageCapability();

  if (!mpv) {
    issues.push({
      id: "mpv-missing",
      // Missing mpv blocks playback only — setup and non-playback shell still mount.
      severity: "degraded",
      message: "mpv not found — required for playback (shell still available).",
      remediation: [
        "Arch:   sudo pacman -S mpv",
        "Debian: sudo apt install mpv",
        "macOS:  brew install mpv",
        "Windows: winget install --id mpv.net -e",
      ],
    });
  }

  if (!ytDlp) {
    issues.push({
      id: "yt-dlp-missing",
      severity: requireYtDlp ? "fatal" : "degraded",
      message: requireYtDlp
        ? "yt-dlp not found — required for YouTube mode playback and downloads."
        : "yt-dlp not found — YouTube playback and downloads require yt-dlp.",
      remediation: [
        "Arch:   sudo pacman -S yt-dlp",
        "Debian: sudo apt install yt-dlp",
        "Fedora: sudo dnf install yt-dlp",
        "Windows: winget install yt-dlp",
        "macOS:  brew install yt-dlp",
        "Other:  pip install yt-dlp",
      ],
    });
  }

  if (!curl) {
    issues.push({
      id: "curl-missing",
      // Anime is one mode, so this degrades that route rather than blocking the
      // shell — but it is the *default* anime route, so silence here means the
      // user sees an empty AniDB search with no explanation.
      severity: "degraded",
      message:
        "curl not found — AniDB (the default anime provider) sits behind Cloudflare and needs it; anime search may return nothing without it.",
      remediation: [
        "Arch:   sudo pacman -S curl",
        "Debian: sudo apt install curl",
        "Fedora: sudo dnf install curl",
        "macOS:  brew install curl",
        "Windows: curl.exe ships with Windows 10 1803+",
        "Best:   install a curl-impersonate build to match a browser TLS handshake",
      ],
    });
  }

  // Posters need no external binary at all now: every renderer consumes one
  // natively prepared image, and half-block is the universal floor. chafa and
  // ImageMagick were retired rather than reported.

  return {
    mpv,
    ffprobe,
    ytDlp,
    curl,
    image,
    issues,
  };
}

export async function checkDeps(
  appVersion = "0.1.0",
  options: { silent?: boolean; requireYtDlp?: boolean } = {},
): Promise<CapabilitySnapshot> {
  const silent = options.silent ?? false;
  const snapshot = await probeCapabilities({ requireYtDlp: options.requireYtDlp });

  if (!snapshot.mpv && !silent) {
    console.error("mpv not found — required for playback (shell still available).");
  }

  const fingerprint = capabilityFingerprint(snapshot);
  const previous = await loadCapabilityNoticeState();
  const shouldShowRemediation =
    !previous || previous.version !== appVersion || previous.fingerprint !== fingerprint;

  if (shouldShowRemediation && !silent) {
    for (const issue of snapshot.issues) {
      console.log(`${issue.message}\nFix:\n  ${issue.remediation.join("\n  ")}`);
    }
    await saveCapabilityNoticeState({
      version: appVersion,
      fingerprint,
    });
  } else if (shouldShowRemediation && silent) {
    // Suppress console output — TUI onboarding shows system status visually instead.
    await saveCapabilityNoticeState({ version: appVersion, fingerprint });
  }

  return snapshot;
}

export const __testing = {
  capabilityFingerprint,
};
