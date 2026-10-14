/**
 * yt-dlp release freshness. YouTube changes extraction constantly and a stale
 * yt-dlp degrades silently — resolve succeeds against cached metadata and the
 * failure only surfaces at mpv handoff. Naming the age in diagnostics turns
 * "YouTube broke" into "update yt-dlp".
 */

/** Warn when the installed yt-dlp release is older than this. */
export const YTDLP_STALE_AFTER_DAYS = 90;

const YTDLP_VERSION_PATTERN = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.\d+)?$/;

export function ytDlpReleaseAgeDays(
  version: string | undefined,
  nowMs: number = Date.now(),
): number | null {
  const match = YTDLP_VERSION_PATTERN.exec(version?.trim() ?? "");
  if (!match) return null;
  const releasedMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(releasedMs)) return null;
  const ageDays = Math.floor((nowMs - releasedMs) / 86_400_000);
  return ageDays >= 0 ? ageDays : null;
}

/** Non-null when the installed release is old enough to suspect. */
export function describeStaleYtDlp(
  version: string | undefined,
  nowMs: number = Date.now(),
): { readonly daysOld: number; readonly message: string } | null {
  const ageDays = ytDlpReleaseAgeDays(version, nowMs);
  if (ageDays === null || ageDays < YTDLP_STALE_AFTER_DAYS) return null;
  return {
    daysOld: ageDays,
    message: `yt-dlp ${version?.trim()} is ${ageDays} days old — update it for reliable extraction`,
  };
}
