/** Parse a numeric height from labels like `1080p`, `HD 720 p`, or `best`. */
export function parseQualityHeight(qualityLabel?: string | null): number | null {
  if (!qualityLabel) return null;
  const normalized = qualityLabel.trim().toLowerCase();
  if (normalized === "best" || normalized === "auto" || normalized === "") return null;
  const match = qualityLabel.match(/(\d{3,4})\s*p/i);
  if (!match) return null;
  const height = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(height) && height > 0 ? height : null;
}

/** Pick the higher explicit quality ceiling when profile and playback disagree. */
export function resolveDownloadQualityCeiling(
  ...candidates: readonly (string | undefined | null)[]
): string | undefined {
  let bestHeight = -1;
  let bestLabel: string | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const height = parseQualityHeight(candidate);
    if (height === null) {
      if (!bestLabel) bestLabel = candidate;
      continue;
    }
    if (height > bestHeight) {
      bestHeight = height;
      bestLabel = candidate;
    }
  }
  return bestLabel;
}

export function streamMeetsDownloadQualityFloor(
  stream: { readonly qualityLabel?: string; readonly qualityRank?: number } | undefined,
  requiredQualityLabel?: string,
): boolean {
  const requiredHeight = parseQualityHeight(requiredQualityLabel);
  if (requiredHeight === null) return true;
  const streamHeight =
    stream?.qualityRank ??
    parseQualityHeight(stream?.qualityLabel) ??
    (stream?.qualityLabel ? Number.parseInt(stream.qualityLabel, 10) : null);
  if (streamHeight === null || !Number.isFinite(streamHeight)) {
    return false;
  }
  return streamHeight >= requiredHeight;
}

/** Rough per-episode byte budget from configured quality (for disk admission). */
export function estimateBytesForDownloadQuality(qualityLabel?: string): number {
  const height = parseQualityHeight(qualityLabel);
  if (height === null) return 768 * 1024 * 1024;
  if (height >= 1080) return 1_200 * 1024 * 1024;
  if (height >= 720) return 700 * 1024 * 1024;
  if (height >= 480) return 400 * 1024 * 1024;
  return 250 * 1024 * 1024;
}

import { buildYtdlFormatSelector } from "@kunai/providers/youtube";

/**
 * yt-dlp `-f` selector honoring a configured quality ceiling without an
 * unconstrained `/best` tail that can fall through to 360p.
 */
export function ytDlpFormatSelectorForQuality(qualityLabel?: string): string | undefined {
  const height = parseQualityHeight(qualityLabel);
  if (height === null) return undefined;
  return buildYtdlFormatSelector(`${height}p`);
}
