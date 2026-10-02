// Pure URL helpers live in core so the CLI mpv relay (infra) can use them too;
// re-exported here to keep existing @kunai/providers consumers working.
import { isHlsPlaylistUrl, resolveHlsSegmentUrl } from "@kunai/core";
import { blockedLiteralTargetReason } from "@kunai/types";

export { isHlsPlaylistUrl, resolveHlsSegmentUrl };

/** FFmpeg/mpv HLS over HTTP mis-parses large playlists with host-root segment paths. */

export const FFMPEG_HLS_PARTIAL_READ_BYTES = 131_072;

/** Minimum bytes for a ranged HLS media-segment probe to count as real media (not junk/HTML). */
export const HLS_SEGMENT_PROBE_MIN_BYTES = 1_024;

/** CDNs known to serve Videasy-style host-root VOD playlists (fast-path hint only). */
export const HOST_ROOT_HLS_CDN_HOSTS = [
  "light.goldweather.net",
  "usa6.shegu.net",
  "goldweather.net",
] as const;

export function isKnownHostRootHlsCdn(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOST_ROOT_HLS_CDN_HOSTS.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
  } catch {
    return false;
  }
}

/** Media playlist lines that start with `/` resolve against the CDN origin, not the manifest directory. */
export function manifestUsesHostRootSegmentPaths(manifestText: string): boolean {
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  }
  return false;
}

export function isHlsMasterPlaylist(manifestText: string): boolean {
  if (/#EXT-X-STREAM-INF/i.test(manifestText)) return true;
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (isHlsPlaylistUrl(trimmed) || /\.m3u8(?:[?#]|$)/i.test(trimmed)) return true;
  }
  return false;
}

/** First nested playlist URI from a master playlist; prefers video/index-v variants. */
export function parseFirstHlsVariantPath(manifestText: string): string | null {
  const uris: string[] = [];
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (isHlsPlaylistUrl(trimmed) || /\.m3u8(?:[?#]|$)/i.test(trimmed)) {
      uris.push(trimmed);
    }
  }
  if (uris.length === 0) return null;
  return (
    uris.find((uri) => /index-v|\/v\d|video|1080|720|480|360/i.test(uri)) ??
    uris.find((uri) => !/index-a|audio|\/a\d/i.test(uri)) ??
    uris[0] ??
    null
  );
}

/**
 * First media segment URI from a media playlist.
 * Skips nested `.m3u8` lines so master playlists do not masquerade as segments.
 * Accepts obfuscated CDN names (e.g. `seg-1-v1.ts.html`).
 */
export function parseFirstHlsMediaSegmentPath(manifestText: string): string | null {
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (isHlsPlaylistUrl(trimmed) || /\.m3u8(?:[?#]|$)/i.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

export function absolutizeHostRootHlsManifest(manifestText: string, manifestUrl: string): string {
  const origin = new URL(manifestUrl).origin;
  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
        return `${origin}${trimmed}`;
      }
      return line;
    })
    .join("\n");
}

export function shouldMaterializeHlsManifest(manifestUrl: string, manifestText: string): boolean {
  if (!isHlsPlaylistUrl(manifestUrl)) return false;
  if (!manifestUsesHostRootSegmentPaths(manifestText)) return false;
  return manifestText.length > FFMPEG_HLS_PARTIAL_READ_BYTES || isKnownHostRootHlsCdn(manifestUrl);
}

/** Schemes embedded URIs may carry; everything else is a fetch primitive on hosts we never vetted. */
const EMBEDDED_URI_ALLOWED_SCHEMES = new Set(["http:", "https:", "data:"]);
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const URI_ATTRIBUTE_PATTERN = /URI="([^"]+)"/g;

/**
 * Every URI a fetched manifest tells the player to request — media-segment
 * lines plus the URI= attributes on #EXT-X-KEY/MAP/MEDIA/I-FRAME-STREAM-INF
 * tags. mpv fetches these itself at play time, so a poisoned manifest is an
 * SSRF/file-read primitive regardless of whether we materialize the file.
 *
 * Returns the first block reason, or null when every URI is relative
 * (inherits the already-guarded manifest origin), a public http(s) literal,
 * or a self-contained `data:` URI (init-segment inlining, the reason ffmpeg's
 * protocol whitelist carries it).
 */
export function blockedHlsManifestUriReason(manifestText: string): string | null {
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      for (const match of trimmed.matchAll(URI_ATTRIBUTE_PATTERN)) {
        const uri = match[1];
        if (uri === undefined) continue;
        const reason = embeddedHlsUriBlockReason(uri);
        if (reason !== null) return reason;
      }
      continue;
    }
    const reason = embeddedHlsUriBlockReason(trimmed);
    if (reason !== null) return reason;
  }
  return null;
}

function embeddedHlsUriBlockReason(uri: string): string | null {
  if (uri.startsWith("//")) {
    // Scheme-relative inherits the manifest's https — the host itself is new.
    return blockedLiteralTargetReason(`https:${uri}`);
  }
  if (!URI_SCHEME_PATTERN.test(uri)) return null;
  const scheme = uri.slice(0, uri.indexOf(":") + 1).toLowerCase();
  if (!EMBEDDED_URI_ALLOWED_SCHEMES.has(scheme)) {
    return `embedded URI scheme ${scheme}`;
  }
  if (scheme === "data:") return null;
  return blockedLiteralTargetReason(uri);
}
