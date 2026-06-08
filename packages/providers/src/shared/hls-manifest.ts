/** FFmpeg/mpv HLS over HTTP mis-parses large playlists with host-root segment paths. */

export const FFMPEG_HLS_PARTIAL_READ_BYTES = 131_072;

/** CDNs known to serve Videasy-style host-root VOD playlists (fast-path hint only). */
export const HOST_ROOT_HLS_CDN_HOSTS = [
  "light.goldweather.net",
  "usa6.shegu.net",
  "goldweather.net",
] as const;

export function isHlsPlaylistUrl(url: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(url);
}

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

export function parseFirstHlsMediaSegmentPath(manifestText: string): string | null {
  for (const line of manifestText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return null;
}

export function resolveHlsSegmentUrl(manifestUrl: string, segmentPath: string): string {
  if (segmentPath.startsWith("http://") || segmentPath.startsWith("https://")) {
    return segmentPath;
  }
  if (segmentPath.startsWith("/") && !segmentPath.startsWith("//")) {
    return `${new URL(manifestUrl).origin}${segmentPath}`;
  }
  return new URL(segmentPath, manifestUrl).toString();
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
