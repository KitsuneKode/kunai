import type { ProviderFetchPort } from "@kunai/types";

import { isHlsMasterPlaylist, isHlsPlaylistUrl } from "./hls-manifest";
import { normalizeQualityLabel, qualityRankFromLabel } from "./source-inventory";
import { normalizeIsoLanguageCode } from "./subtitle-helpers";

export type HlsLadderVariant = {
  readonly url: string;
  readonly qualityLabel: string;
  readonly qualityRank: number;
  readonly bandwidth?: number;
};

/** A resolved `#EXT-X-MEDIA` rendition — an alternate audio or subtitle playlist. */
export type HlsRenditionTrack = {
  readonly url: string;
  readonly groupId: string;
  /** ISO language code when the master declares one. */
  readonly language?: string;
  /** The rendition NAME attribute — what a player would show. */
  readonly label: string;
  readonly isDefault: boolean;
};

/**
 * Everything a master playlist carries: ranked variants plus the alternate
 * rendition groups (`#EXT-X-MEDIA`) the Tracks panel shows as audio/subtitle
 * inventory. `audioLanguages` covers muxed audio too — a rendition may declare
 * a LANGUAGE without a URI, which still tells us the language exists.
 */
/**
 * Why an expansion returned what it did. Callers that only want variants ignore
 * this; callers deciding whether a stream host is *alive* (as opposed to merely
 * unlabeled or WAF-gatekept) branch on it — a 5xx/404/410 `http-error` is a dead
 * host, while `network`/`not-master`/403 stay ambiguous because gatekept CDNs
 * reject expansion fetches yet still play.
 */
export type HlsMasterProbe = {
  readonly kind: "ok" | "http-error" | "not-master" | "network";
  readonly httpStatus?: number;
};

/**
 * HTTP statuses that prove a stream host is dead, not merely gatekept.
 * 5xx and 404/410 mean mpv will fail identically on the same URL. 401/403 stay
 * ambiguous on purpose — WAF-fronted CDNs reject expansion fetches yet still
 * play once the player carries the provider's headers.
 */
export function isHlsDeadHostStatus(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || status === 404 || status === 410);
}

export type HlsMasterInventory = {
  readonly variants: readonly HlsLadderVariant[];
  readonly audioTracks: readonly HlsRenditionTrack[];
  readonly subtitleTracks: readonly HlsRenditionTrack[];
  readonly audioLanguages: readonly string[];
  readonly probe: HlsMasterProbe;
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
  return (await expandHlsMasterInventory(options)).variants;
}

/**
 * Same fetch + fallback contract as `expandHlsMasterPlaylist`, but also parses
 * `#EXT-X-MEDIA` rendition groups into audio/subtitle track inventory.
 */
export async function expandHlsMasterInventory(
  options: ExpandHlsMasterPlaylistOptions,
): Promise<HlsMasterInventory> {
  const { masterUrl, headers, signal, maxVariants = DEFAULT_MAX_VARIANTS } = options;
  const fallback: HlsLadderVariant = {
    url: masterUrl,
    qualityLabel: "auto",
    // Keep rank 0 so callers do not invent a fake 1080p height from auto.
    qualityRank: 0,
  };
  const empty = (probe: HlsMasterProbe): HlsMasterInventory => ({
    variants: [fallback],
    audioTracks: [],
    subtitleTracks: [],
    audioLanguages: [],
    probe,
  });

  try {
    const response = await options.fetch(masterUrl, {
      headers: headers ?? {},
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return empty({ kind: "http-error", httpStatus: response.status });
    }

    const text = await response.text();
    if (!isHlsMasterPlaylist(text)) {
      return empty({ kind: "not-master", httpStatus: response.status });
    }

    const variants = parseHlsMasterVariants(text, masterUrl);
    if (variants.length === 0) {
      return empty({ kind: "not-master", httpStatus: response.status });
    }

    const sorted = [...variants].sort((left, right) => right.qualityRank - left.qualityRank);
    const capped = maxVariants > 0 ? sorted.slice(0, maxVariants) : sorted;
    const renditions = parseHlsMasterRenditions(text, masterUrl);
    return { variants: capped, ...renditions, probe: { kind: "ok", httpStatus: response.status } };
  } catch {
    return empty({ kind: "network" });
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

/**
 * `#EXT-X-MEDIA` rows declare rendition groups: `TYPE=AUDIO|SUBTITLES|…`,
 * `GROUP-ID`, `NAME`, `LANGUAGE`, `URI`, `DEFAULT`. Audio renditions may omit
 * URI entirely (muxed into the variant) — those still feed `audioLanguages`
 * even though there is no separate playlist to hand to a player.
 *
 * CLOSED-CAPTIONS renditions are skipped: they never carry a URI and mpv reads
 * the embedded captions in-container.
 */
export function parseHlsMasterRenditions(
  manifestText: string,
  masterUrl: string,
): Pick<HlsMasterInventory, "audioTracks" | "subtitleTracks" | "audioLanguages"> {
  const audioTracks: HlsRenditionTrack[] = [];
  const subtitleTracks: HlsRenditionTrack[] = [];
  const audioLanguages: string[] = [];
  const seenAudioLanguages = new Set<string>();
  const seenUrls = new Set<string>();

  for (const rawLine of manifestText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    const attrs = parseHlsTagAttributes(line.slice("#EXT-X-MEDIA:".length));
    const type = attrs["TYPE"]?.toUpperCase();
    if (type !== "AUDIO" && type !== "SUBTITLES") continue;

    const language = normalizeIsoLanguageCode(attrs["LANGUAGE"]) ?? attrs["LANGUAGE"]?.trim();
    if (type === "AUDIO" && language && !seenAudioLanguages.has(language)) {
      seenAudioLanguages.add(language);
      audioLanguages.push(language);
    }

    const uri = attrs["URI"];
    if (!uri) continue; // muxed rendition — language recorded above, nothing to hand a player
    const url = resolveHlsVariantUrl(masterUrl, uri);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const track: HlsRenditionTrack = {
      url,
      groupId: attrs["GROUP-ID"] ?? "",
      ...(language ? { language } : {}),
      label: attrs["NAME"]?.trim() || language || url,
      isDefault: attrs["DEFAULT"]?.toUpperCase() === "YES",
    };
    if (type === "AUDIO") audioTracks.push(track);
    else subtitleTracks.push(track);
  }

  return { audioTracks, subtitleTracks, audioLanguages };
}

/**
 * Parse an `EXT-X` attribute list (`KEY=value,KEY="quoted"`). Quoted values may
 * contain commas; unquoted values terminate at the next comma per RFC 8216.
 */
function parseHlsTagAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Z0-9-]+)\s*=\s*("([^"]*)"|[^,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const key = match[1]?.toUpperCase();
    if (!key) continue;
    const value = match[2] ?? "";
    attrs[key] = value.startsWith('"') ? (match[3] ?? "") : value.trim();
  }
  return attrs;
}
