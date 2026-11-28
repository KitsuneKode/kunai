// Pure URL helpers live in core so the CLI mpv relay (infra) can use them too;
// re-exported here to keep existing @kunai/providers consumers working.
import { isHlsPlaylistUrl, resolveHlsSegmentUrl } from "@kunai/core";

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

/**
 * Resolve a nested playlist reference, propagating an `api_key` query to a
 * same-origin child playlist that omits it. VidBolt-style CDNs sign every
 * playlist this way while still serving unsigned media segments; ordinary
 * segment references intentionally keep RFC resolution.
 */
export function resolveHlsPlaylistUrl(manifestUrl: string, playlistPath: string): string {
  const resolved = resolveHlsSegmentUrl(manifestUrl, playlistPath);
  try {
    const parent = new URL(manifestUrl);
    const child = new URL(resolved);
    const apiKey = parent.searchParams.get("api_key");
    if (
      apiKey &&
      child.origin === parent.origin &&
      !child.searchParams.has("api_key") &&
      isHlsPlaylistUrl(child.toString())
    ) {
      child.searchParams.set("api_key", apiKey);
      return child.toString();
    }
  } catch {
    // Invalid input already had the standard-resolution fallback above.
  }
  return resolved;
}

function isPlaylistReference(reference: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(reference);
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
  const lines = manifestText.split(/\r?\n/);
  // RFC 8216 puts the variant URI on the first non-tag line after
  // `#EXT-X-STREAM-INF`. The extension is not part of the contract: Rivestream
  // backends obfuscate playlists as `.m3u8.png`, so extension-based parsing
  // misreads a valid master as having no variant at all.
  const variants: { readonly uri: string; readonly hasResolution: boolean }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const tag = lines[index]?.trim() ?? "";
    if (!tag.startsWith("#EXT-X-STREAM-INF")) continue;
    for (let follow = index + 1; follow < lines.length; follow += 1) {
      const candidate = lines[follow]?.trim() ?? "";
      if (!candidate) continue;
      if (candidate.startsWith("#") && !candidate.startsWith("#EXT")) continue;
      if (candidate.startsWith("#EXT")) break;
      variants.push({ uri: candidate, hasResolution: /RESOLUTION=/i.test(tag) });
      break;
    }
  }
  // A STREAM-INF entry can be audio-only, so the first one is not always
  // video: prefer a declared resolution, then the filename heuristic.
  if (variants.length > 0) {
    return (
      variants.find((variant) => variant.hasResolution)?.uri ??
      preferVideoUri(variants.map((variant) => variant.uri))
    );
  }

  // Some packagers emit a bare list of nested playlists without STREAM-INF.
  return preferVideoUri(
    lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && isHlsPlaylistUrl(line)),
  );
}

function preferVideoUri(uris: readonly string[]): string | null {
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

/**
 * Rewrite every reference in a playlist to an absolute URL.
 *
 * A materialized playlist is read by mpv from a local temp file, so anything
 * left relative resolves against that file's directory. That covers segment
 * lines and the `URI="…"` attributes of `#EXT-X-KEY` (AES keys), `#EXT-X-MAP`
 * (fMP4 init segments) and `#EXT-X-MEDIA` (audio/subtitle renditions) —
 * host-root (`/a/b`) and plain relative (`seg-1.ts`) alike. `manifestUrl` must
 * be the URL the playlist was finally served from, after redirects.
 */
export function absolutizeHlsManifest(manifestText: string, manifestUrl: string): string {
  const absolute = (reference: string): string =>
    isPlaylistReference(reference)
      ? resolveHlsPlaylistUrl(manifestUrl, reference)
      : resolveHlsSegmentUrl(manifestUrl, reference);
  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(
          /(\bURI=")([^"]*)(")/g,
          (_match, open, reference, close) => `${open}${absolute(reference)}${close}`,
        );
      }
      return absolute(trimmed);
    })
    .join("\n");
}

export function shouldMaterializeHlsManifest(manifestUrl: string, manifestText: string): boolean {
  if (!isHlsPlaylistUrl(manifestUrl)) return false;
  try {
    if (new URL(manifestUrl).searchParams.has("api_key") && isHlsMasterPlaylist(manifestText)) {
      // The child playlists need the credential copied onto their own URLs;
      // ffmpeg/mpv otherwise drop it during RFC relative resolution.
      return true;
    }
  } catch {
    // Invalid URLs cannot be HLS playback input here; fall through to the
    // ordinary host-root heuristic.
  }
  if (!manifestUsesHostRootSegmentPaths(manifestText)) return false;
  return manifestText.length > FFMPEG_HLS_PARTIAL_READ_BYTES || isKnownHostRootHlsCdn(manifestUrl);
}
