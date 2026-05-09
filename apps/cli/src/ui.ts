import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ImageCapability } from "@/image";
import { detectImageCapability } from "@/image";

// ── Dependency check ───────────────────────────────────────────────────────

export type CapabilitySeverity = "fatal" | "degraded";

export interface CapabilityIssue {
  readonly id:
    | "mpv-missing"
    | "ffmpeg-missing"
    | "poster-rendering-unavailable"
    | "poster-rendering-degraded";
  readonly severity: CapabilitySeverity;
  readonly message: string;
  readonly remediation: readonly string[];
}

export interface CapabilitySnapshot {
  readonly mpv: boolean;
  readonly ffmpeg: boolean;
  readonly chafa: boolean;
  readonly magick: boolean;
  readonly image: ImageCapability;
  readonly issues: readonly CapabilityIssue[];
}

type CapabilityNoticeState = {
  readonly version: string;
  readonly fingerprint: string;
};

const NOTICE_DIR = join(process.env.HOME ?? "~", ".config", "kunai");
const NOTICE_FILE = join(NOTICE_DIR, "capability-notice.json");

function capabilityFingerprint(snapshot: CapabilitySnapshot): string {
  const issueBits = [...snapshot.issues]
    .map((issue) => `${issue.id}:${issue.severity}`)
    .sort()
    .join(",");
  return `mpv:${snapshot.mpv ? "1" : "0"}|ffmpeg:${snapshot.ffmpeg ? "1" : "0"}|chafa:${snapshot.chafa ? "1" : "0"}|magick:${snapshot.magick ? "1" : "0"}|image:${snapshot.image.renderer}|terminal:${snapshot.image.terminal}|issues:${issueBits}`;
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

export async function checkDeps(appVersion = "0.1.0"): Promise<CapabilitySnapshot> {
  const issues: CapabilityIssue[] = [];
  const mpv = Boolean(Bun.which("mpv"));
  const ffmpeg = Boolean(Bun.which("ffmpeg"));
  const chafa = Boolean(Bun.which("chafa"));
  const magick = Boolean(Bun.which("magick"));
  const image = detectImageCapability();

  if (!mpv) {
    const remediation = [
      "Arch:   sudo pacman -S mpv",
      "Debian: sudo apt install mpv",
      "macOS:  brew install mpv",
    ] as const;
    issues.push({
      id: "mpv-missing",
      severity: "fatal",
      message: "mpv not found — required for playback.",
      remediation,
    });
    console.error("mpv not found — required for playback.");
  }

  if (image.terminal === "windows-terminal" && !chafa) {
    issues.push({
      id: "poster-rendering-degraded",
      severity: "degraded",
      message:
        "Windows Terminal detected, but chafa is missing. Poster previews require chafa for Sixel output.",
      remediation: [
        "Windows: winget install hpjansson.Chafa",
        "Arch:    sudo pacman -S chafa",
        "Debian/Ubuntu: sudo apt install chafa",
        "macOS:   brew install chafa",
      ],
    });
  }

  if (image.renderer === "kitty-native" && !magick) {
    issues.push({
      id: "poster-rendering-degraded",
      severity: "degraded",
      message:
        "Kitty/Ghostty detected, but ImageMagick is missing. Non-PNG posters may be unavailable.",
      remediation: [
        "Arch:    sudo pacman -S imagemagick",
        "Debian/Ubuntu: sudo apt install imagemagick",
        "macOS:   brew install imagemagick",
        "Windows: winget install ImageMagick.ImageMagick",
      ],
    });
  }

  const snapshot: CapabilitySnapshot = { mpv, ffmpeg, chafa, magick, image, issues };
  const fingerprint = capabilityFingerprint(snapshot);
  const previous = await loadCapabilityNoticeState();
  const shouldShowRemediation =
    !previous || previous.version !== appVersion || previous.fingerprint !== fingerprint;

  if (shouldShowRemediation) {
    for (const issue of snapshot.issues) {
      console.log(`${issue.message}\nFix:\n  ${issue.remediation.join("\n  ")}`);
    }
    await saveCapabilityNoticeState({
      version: appVersion,
      fingerprint,
    });
  }

  return snapshot;
}
