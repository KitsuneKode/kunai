import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ImageCapability } from "@/image";
import { detectImageCapability } from "@/image";
import {
  buildRemediationLines,
  CURL_IMPERSONATE_INSTALL,
  CURL_INSTALL,
  FFMPEG_INSTALL,
  MPV_INSTALL,
  YT_DLP_INSTALL,
  type PlatformInstall,
} from "@/infra/os/install-commands";
import { resolveAnidbCurl } from "@kunai/providers";
import { getKunaiPaths } from "@kunai/storage";

// ── Dependency check ───────────────────────────────────────────────────────

export type CapabilitySeverity = "fatal" | "degraded";

export interface CapabilityIssue {
  readonly id:
    | "mpv-missing"
    | "yt-dlp-missing"
    | "ffmpeg-missing"
    | "curl-missing"
    | "curl-impersonate-missing"
    | "poster-rendering-unavailable";
  readonly severity: CapabilitySeverity;
  readonly message: string;
  /** Every platform's command, labelled. Generated from `install`. */
  readonly remediation: readonly string[];
  /** Structured source for `remediation`, so one surface can show one line. */
  readonly install: PlatformInstall;
}

/**
 * What kind of curl AniDB and Miruro can actually drive.
 *
 * A boolean was not enough and the gap was user-visible: plain curl is present
 * on nearly every machine, so `curl: true` reported "anime search ready" while
 * Cloudflare challenged every request and search came back empty with no
 * diagnostic anywhere. Presence and capability are different facts; both are
 * carried.
 */
export interface CurlCapability {
  /** Any usable curl — plain or an impersonate build. */
  readonly present: boolean;
  /** True only when a curl-impersonate build was selected. */
  readonly impersonates: boolean;
  /** Selected browser profile (`chrome150`), or `null` for plain curl / none. */
  readonly profile: string | null;
}

export interface CapabilitySnapshot {
  readonly mpv: boolean;
  /** Optional post-download probe (`ffprobe` on PATH); not required for the queue. */
  readonly ffprobe: boolean;
  readonly ytDlp: boolean;
  /**
   * The curl the AniDB provider can use. AniDB is the default anime provider and
   * anidb.app sits behind Cloudflare, so this is a real dependency of the
   * default route, not a nicety — and plain curl frequently is not enough.
   */
  readonly curl: CurlCapability;
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
  const curlBits = `${snapshot.curl.present ? "1" : "0"}:${snapshot.curl.profile ?? "plain"}`;
  return `mpv:${snapshot.mpv ? "1" : "0"}|ffprobe:${snapshot.ffprobe ? "1" : "0"}|ytDlp:${snapshot.ytDlp ? "1" : "0"}|curl:${curlBits}|image:${snapshot.image.renderer}|terminal:${snapshot.image.terminal}|issues:${issueBits}`;
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
    /** PATH listing seam for curl-impersonate discovery. Injected by tests. */
    listPathEntries?: () => readonly string[];
  } = {},
): Promise<CapabilitySnapshot> {
  const requireYtDlp = options.requireYtDlp ?? false;
  const which = options.which ?? ((command: string) => Bun.which(command));
  const issues: CapabilityIssue[] = [];
  const mpv = Boolean(which("mpv"));
  const ffprobe = Boolean(which("ffprobe"));
  const ytDlp = Boolean(which("yt-dlp"));
  // Ask the provider which binary it would actually drive rather than probing
  // for the literal "curl": it discovers curl-impersonate builds from PATH and
  // prefers them, so a literal probe both under-reports a capable host and
  // over-reports one carrying only plain curl.
  const resolvedCurl = resolveAnidbCurl({
    which,
    ...(options.listPathEntries ? { listPathEntries: options.listPathEntries } : {}),
  });
  const curl: CurlCapability = {
    present: resolvedCurl !== null,
    impersonates: resolvedCurl?.impersonates ?? false,
    profile: resolvedCurl?.profile ?? null,
  };
  const image = detectImageCapability();

  if (!mpv) {
    issues.push({
      id: "mpv-missing",
      // Missing mpv blocks playback only — setup and non-playback shell still mount.
      severity: "degraded",
      message: "mpv not found — required for playback (shell still available).",
      install: MPV_INSTALL,
      remediation: buildRemediationLines(MPV_INSTALL),
    });
  }

  if (!ytDlp) {
    issues.push({
      id: "yt-dlp-missing",
      severity: requireYtDlp ? "fatal" : "degraded",
      message: requireYtDlp
        ? "yt-dlp not found — required for YouTube mode playback and downloads."
        : "yt-dlp not found — YouTube playback and downloads require yt-dlp.",
      install: YT_DLP_INSTALL,
      remediation: buildRemediationLines(YT_DLP_INSTALL),
    });
  }

  // Named for the package a user can actually install. `ffprobe` is the binary
  // we probe, but it ships inside ffmpeg and no platform packages it alone.
  //
  // The consequence is also bigger than the old "validates downloaded files"
  // copy admitted: every yt-dlp format selector Kunai uses is a merge
  // (`bv*+ba/b`, `bestvideo[height<=N]+bestaudio`, `--merge-output-format mp4`),
  // and merging needs ffmpeg. Without it yt-dlp silently falls back to a single
  // progressive stream, so quality quietly caps rather than anything failing.
  if (!ffprobe) {
    issues.push({
      id: "ffmpeg-missing",
      severity: "degraded",
      message:
        "ffmpeg not found — yt-dlp cannot merge separate video and audio, so YouTube and downloads quietly cap at a lower quality.",
      install: FFMPEG_INSTALL,
      remediation: buildRemediationLines(FFMPEG_INSTALL),
    });
  }

  if (!curl.present) {
    issues.push({
      id: "curl-missing",
      // Anime is one mode, so this degrades that route rather than blocking the
      // shell — but it is the *default* anime route, so silence here means the
      // user sees an empty AniDB search with no explanation.
      severity: "degraded",
      message:
        "curl not found — AniDB (the default anime provider) sits behind Cloudflare and needs it; anime search may return nothing without it.",
      install: CURL_INSTALL,
      remediation: [
        ...buildRemediationLines(CURL_INSTALL),
        "",
        "Better — a curl-impersonate build matches a real browser handshake:",
        ...buildRemediationLines(CURL_IMPERSONATE_INSTALL),
      ],
    });
  } else if (!curl.impersonates) {
    issues.push({
      id: "curl-impersonate-missing",
      // Plain curl is present, so this is not "missing a dependency" — it is a
      // capability gap that only shows up as empty anime search results. It was
      // previously invisible: `curl: true` reported ready and the user had no
      // way to learn why AniDB returned nothing.
      severity: "degraded",
      message:
        "Only plain curl found — Cloudflare fingerprints the TLS handshake, so AniDB and Miruro may still be challenged. A curl-impersonate build matches a real browser.",
      install: CURL_IMPERSONATE_INSTALL,
      remediation: buildRemediationLines(CURL_IMPERSONATE_INSTALL),
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
