// Pure HLS URL helpers.
//
// These live in core, not in the providers package, because the CLI's mpv HLS
// relay (infra) needs them too and infra must not import provider
// implementations. Pure string/URL logic with no provider coupling.

/**
 * True when the URL points at an HLS playlist (`.m3u8`, ignoring query/hash).
 * One short trailing extension is allowed too: CDNs obfuscate playlists as
 * `index.m3u8.png` and serve them as `image/png`, so neither the bare suffix
 * nor the content type alone identifies them. Missing one made the stream
 * probe treat a playlist as a plain file and pass it on a HEAD.
 */
export function isHlsPlaylistUrl(url: string): boolean {
  return /\.m3u8(?:\.[a-z0-9]{1,5})?(?:[?#]|$)/i.test(url);
}

/**
 * Absolute URL for a segment/variant referenced by a manifest.
 * Absolute stays as-is; host-root (`/x`, not `//host`) resolves against the
 * manifest origin; everything else resolves relative to the manifest.
 */
export function resolveHlsSegmentUrl(manifestUrl: string, segmentPath: string): string {
  if (segmentPath.startsWith("http://") || segmentPath.startsWith("https://")) {
    return segmentPath;
  }
  if (segmentPath.startsWith("/") && !segmentPath.startsWith("//")) {
    return `${new URL(manifestUrl).origin}${segmentPath}`;
  }
  return new URL(segmentPath, manifestUrl).toString();
}
