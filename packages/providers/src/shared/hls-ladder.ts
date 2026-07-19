import type { ProviderFetchPort } from "@kunai/types";

import { isHlsMasterPlaylist, isHlsPlaylistUrl } from "./hls-manifest";
import { normalizeQualityLabel, qualityRankFromLabel } from "./source-inventory";

export type HlsLadderVariant = {
  readonly url: string;
  readonly qualityLabel: string;
  readonly qualityRank: number;
  readonly bandwidth?: number;
};

export type ExpandHlsMasterPlaylistOptions = {
  readonly fetch: ProviderFetchPort["fetch"] | typeof fetch;
  readonly masterUrl: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  /** Cap variants after sort (highest quality first). */
  readonly maxVariants?: number;
};

const DEFAULT_MAX_VARIANTS = 12;

/**
 * Fetch a master HLS playlist and expand `#EXT-X-STREAM-INF` rows into ranked
 * variant URLs for the Tracks quality picker. Media playlists / parse failures
 * fall back to a single `auto` row pointing at the original URL.
 */
export async function expandHlsMasterPlaylist(
  options: ExpandHlsMasterPlaylistOptions,
): Promise<readonly HlsLadderVariant[]> {
  const { masterUrl, headers, signal, maxVariants = DEFAULT_MAX_VARIANTS } = options;
  const fallback: HlsLadderVariant = {
    url: masterUrl,
    qualityLabel: "auto",
    // Keep rank 0 so callers do not invent a fake 1080p height from auto.
    qualityRank: 0,
  };

  try {
    const response = await options.fetch(masterUrl, {
      headers: headers ?? {},
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [fallback];

    const text = await response.text();
    if (!isHlsMasterPlaylist(text)) {
      return [fallback];
    }

    const variants = parseHlsMasterVariants(text, masterUrl);
    if (variants.length === 0) return [fallback];

    const sorted = [...variants].sort((left, right) => right.qualityRank - left.qualityRank);
    const capped = maxVariants > 0 ? sorted.slice(0, maxVariants) : sorted;
    return capped;
  } catch {
    return [fallback];
  }
}

/** True when a stream URL looks like an HLS master (leaf or path hint). */
export function looksLikeHlsMasterUrl(url: string): boolean {
  if (!isHlsPlaylistUrl(url) && !/\.m3u8(?:[?#]|$)/i.test(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    const leaf = path.replace(/\/+$/, "").split("/").pop() ?? "";
    return leaf === "master.m3u8" || leaf.includes("master") || leaf === "index.m3u8";
  } catch {
    return /\bmaster\.m3u8\b/i.test(url);
  }
}

export function parseHlsMasterVariants(
  manifestText: string,
  masterUrl: string,
): HlsLadderVariant[] {
  const lines = manifestText.split(/\r?\n/);
  const variants: HlsLadderVariant[] = [];
  let currentResolution = "";
  let currentBandwidth = 0;
  let currentName = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const resMatch = /RESOLUTION=\d+x(\d+)/i.exec(line);
      currentResolution = resMatch?.[1] ? `${resMatch[1]}p` : "";
      const bwMatch = /BANDWIDTH=(\d+)/i.exec(line);
      currentBandwidth = bwMatch?.[1] ? Number.parseInt(bwMatch[1], 10) : 0;
      const nameMatch = /NAME="([^"]+)"/i.exec(line);
      currentName = nameMatch?.[1]?.trim() ?? "";
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    if (!currentResolution && !currentName && currentBandwidth <= 0) continue;

    const absoluteUrl = resolveHlsVariantUrl(masterUrl, line);
    const labelSource = currentName || currentResolution || (currentBandwidth > 0 ? "auto" : "");
    if (!labelSource || !absoluteUrl) {
      currentResolution = "";
      currentBandwidth = 0;
      currentName = "";
      continue;
    }

    const qualityLabel = normalizeQualityLabel(labelSource) ?? labelSource;
    const qualityRank =
      qualityRankFromLabel(qualityLabel) ??
      qualityRankFromLabel(currentResolution) ??
      currentBandwidth ??
      0;

    variants.push({
      url: absoluteUrl,
      qualityLabel,
      qualityRank,
      bandwidth: currentBandwidth > 0 ? currentBandwidth : undefined,
    });

    currentResolution = "";
    currentBandwidth = 0;
    currentName = "";
  }

  return dedupeHlsVariantsByUrl(variants);
}

function resolveHlsVariantUrl(masterUrl: string, href: string): string | null {
  try {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    return new URL(href, masterUrl).toString();
  } catch {
    return null;
  }
}

function dedupeHlsVariantsByUrl(variants: readonly HlsLadderVariant[]): HlsLadderVariant[] {
  const seen = new Set<string>();
  const out: HlsLadderVariant[] = [];
  for (const variant of variants) {
    if (seen.has(variant.url)) continue;
    seen.add(variant.url);
    out.push(variant);
  }
  return out;
}
