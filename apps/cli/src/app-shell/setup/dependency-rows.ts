// =============================================================================
// dependency-rows.ts — what the machine has, as a pure row model
//
// Shared by the setup dependency screen and the shell's startup issue strip, so
// the two can never disagree about what is wrong or how to fix it.
// =============================================================================

import {
  resolveInstallCommand,
  type InstallProbe,
  type PlatformInstall,
} from "@/infra/os/install-commands";
import type { CapabilitySnapshot } from "@/ui";

export type DependencyState = "ok" | "degraded" | "blocking";

export type DependencyRow = {
  readonly id: string;
  /** The name of the thing a user installs, not the binary we probe for. */
  readonly name: string;
  readonly state: DependencyState;
  /** What it does here, in three words or so. */
  readonly role: string;
  /** Resolved path, or what is wrong. */
  readonly detail: string;
  /** The one command for this machine. `null` when nothing to install. */
  readonly fix: string | null;
  /** Longer explanation shown under the row when it needs attention. */
  readonly consequence?: string;
};

/** Which modes a row is relevant to. Used to keep the startup strip honest. */
export type DependencyScope = "always" | "downloads" | "youtube" | "anime";

export type ScopedDependencyRow = DependencyRow & { readonly scope: DependencyScope };

function fixFor(install: PlatformInstall, which?: InstallProbe): string | null {
  return resolveInstallCommand(install, which ? { which } : {});
}

/**
 * Build the row model from a probe result.
 *
 * `which` is threaded through only so the Linux package-manager probe can be
 * stubbed; everything else already comes from the snapshot.
 */
export function buildDependencyRows(
  snapshot: CapabilitySnapshot,
  options: { readonly which?: InstallProbe; readonly dataDir?: string } = {},
): readonly ScopedDependencyRow[] {
  const { which } = options;
  const issue = (id: string) => snapshot.issues.find((candidate) => candidate.id === id);

  const rows: ScopedDependencyRow[] = [];

  const mpvIssue = issue("mpv-missing");
  rows.push({
    id: "mpv",
    name: "mpv",
    scope: "always",
    // Degraded, not blocking: browsing, the watchlist, and the calendar all
    // work without it. Calling it blocking would be a lie about what is broken.
    state: snapshot.mpv ? "ok" : "degraded",
    role: "playback",
    detail: snapshot.mpv ? "found on PATH" : "not found",
    fix: mpvIssue ? fixFor(mpvIssue.install, which) : null,
    ...(snapshot.mpv ? {} : { consequence: "Nothing can play until this is installed." }),
  });

  const ytDlpIssue = issue("yt-dlp-missing");
  rows.push({
    id: "yt-dlp",
    name: "yt-dlp",
    scope: "youtube",
    state: snapshot.ytDlp ? "ok" : "degraded",
    role: "youtube · downloads",
    detail: snapshot.ytDlp ? "found on PATH" : "not found",
    fix: ytDlpIssue ? fixFor(ytDlpIssue.install, which) : null,
    ...(snapshot.ytDlp ? {} : { consequence: "YouTube playback and downloads need it." }),
  });

  // Named ffmpeg, because that is the package. `ffprobe` is only the binary we
  // can probe for, and no platform ships it separately.
  const ffmpegIssue = issue("ffmpeg-missing");
  rows.push({
    id: "ffmpeg",
    name: "ffmpeg",
    scope: "downloads",
    state: snapshot.ffprobe ? "ok" : "degraded",
    role: "quality · downloads",
    detail: snapshot.ffprobe ? "found on PATH" : "not found",
    fix: ffmpegIssue ? fixFor(ffmpegIssue.install, which) : null,
    ...(snapshot.ffprobe
      ? {}
      : {
          consequence: "Without it yt-dlp cannot merge streams, so quality quietly caps lower.",
        }),
  });

  const curlIssue = issue("curl-impersonate-missing") ?? issue("curl-missing");
  rows.push({
    id: "curl-impersonate",
    name: "curl-impersonate",
    scope: "anime",
    state: snapshot.curl.impersonates ? "ok" : "degraded",
    role: "anime search",
    detail: snapshot.curl.impersonates
      ? `matching ${snapshot.curl.profile}`
      : snapshot.curl.present
        ? "only plain curl"
        : "no curl at all",
    fix: curlIssue ? fixFor(curlIssue.install, which) : null,
    ...(snapshot.curl.impersonates
      ? {}
      : {
          consequence:
            "Cloudflare fingerprints the TLS handshake, so anime search can come back empty.",
        }),
  });

  rows.push({
    id: "posters",
    name: "posters",
    scope: "always",
    state: snapshot.image.renderer !== "none" ? "ok" : "degraded",
    role: "artwork",
    detail:
      snapshot.image.renderer !== "none"
        ? `${snapshot.image.renderer} · ${snapshot.image.terminal}`
        : snapshot.image.terminal && snapshot.image.terminal !== "unknown"
          ? `${snapshot.image.terminal} has no image support`
          : "this terminal has no image support",
    // Nothing to install: every renderer consumes one natively prepared image
    // and half-block is the universal floor.
    fix: null,
  });

  if (options.dataDir) {
    rows.push({
      id: "storage",
      name: "data & cache",
      scope: "always",
      state: "ok",
      role: "history · offline",
      detail: options.dataDir,
      fix: null,
    });
  }

  return rows;
}

/**
 * Rows worth raising at startup, given what this session is actually doing.
 *
 * A blanket warning list is what makes people stop reading warnings. An anime
 * user should not be told about ffmpeg when downloads are off, and a
 * shows-and-movies user should not be told about curl-impersonate at all.
 */
export function selectStartupIssueRows(
  rows: readonly ScopedDependencyRow[],
  context: {
    readonly mode: "series" | "anime" | "youtube";
    readonly downloadsEnabled: boolean;
  },
): readonly ScopedDependencyRow[] {
  return rows.filter((row) => {
    if (row.state === "ok") return false;
    // Posters degrading is a property of the terminal, not something the user
    // did wrong and not something they can fix with a command.
    if (row.fix === null) return false;
    switch (row.scope) {
      case "always":
        return true;
      case "anime":
        return context.mode === "anime";
      case "youtube":
        return context.mode === "youtube" || context.downloadsEnabled;
      case "downloads":
        return context.downloadsEnabled || context.mode === "youtube";
    }
  });
}
