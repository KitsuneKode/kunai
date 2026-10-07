export const YOUTUBE_VIDEO_ID_PREFIX = "youtube:" as const;
export const YOUTUBE_PLAYLIST_ID_PREFIX = "youtube-playlist:" as const;
export const YOUTUBE_CHANNEL_ID_PREFIX = "youtube-channel:" as const;

export function toYoutubeVideoCatalogId(videoId: string): string {
  return `${YOUTUBE_VIDEO_ID_PREFIX}${videoId}`;
}

export function toYoutubePlaylistCatalogId(playlistId: string): string {
  return `${YOUTUBE_PLAYLIST_ID_PREFIX}${playlistId}`;
}

export function toYoutubeChannelCatalogId(channelId: string): string {
  return `${YOUTUBE_CHANNEL_ID_PREFIX}${channelId}`;
}

export function isYoutubeCollectionCatalogId(id: string): boolean {
  const kind = parseYoutubeCatalogId(id).kind;
  return kind === "channel" || kind === "playlist";
}

export function parseYoutubeCatalogId(id: string): {
  readonly kind: "video" | "playlist" | "channel" | "unknown";
  readonly nativeId: string;
} {
  if (id.startsWith(YOUTUBE_PLAYLIST_ID_PREFIX)) {
    return { kind: "playlist", nativeId: id.slice(YOUTUBE_PLAYLIST_ID_PREFIX.length) };
  }
  if (id.startsWith(YOUTUBE_CHANNEL_ID_PREFIX)) {
    return { kind: "channel", nativeId: id.slice(YOUTUBE_CHANNEL_ID_PREFIX.length) };
  }
  if (id.startsWith(YOUTUBE_VIDEO_ID_PREFIX)) {
    let nativeId = id.slice(YOUTUBE_VIDEO_ID_PREFIX.length);
    // Tolerate legacy/test ids like `youtube:video:<id>` (canonical is `youtube:<id>`).
    if (nativeId.startsWith("video:")) {
      nativeId = nativeId.slice("video:".length);
    }
    return { kind: "video", nativeId };
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return { kind: "video", nativeId: id };
  }
  return { kind: "unknown", nativeId: id };
}

/**
 * Poster URL derived from a video id alone.
 *
 * Every search backend drops thumbnails somewhere: `yt-dlp --flat-playlist` returns
 * `thumbnail: null`, Piped omits it on some instances, and Invidious points at an
 * instance that may already be cooling down. `i.ytimg.com` needs no lookup and is
 * served straight from YouTube's CDN, so it is the honest floor for any video we
 * can name — a result should never render with an empty poster.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Host-level YouTube check — substring matching let a hostile stream URL like
 * `http://169.254.169.254/x?u=youtu.be/` classify as "provider-attested" and
 * skip every reachability probe on the way to mpv. Only a real youtube.com /
 * youtu.be host qualifies.
 */
function isYoutubeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
}

export function isYoutubeWatchUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!isYoutubeHostname(host)) return false;
  if (host === "youtu.be") return true;
  const path = parsed.pathname;
  return path === "/watch" || path.startsWith("/live/") || path.startsWith("/shorts/");
}

export function extractYoutubeVideoIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!isYoutubeHostname(host)) return null;
  if (host === "youtu.be") {
    const shortMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
    return shortMatch?.[1] ?? null;
  }
  const videoId = parsed.searchParams.get("v");
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) return videoId;
  const deepMatch = parsed.pathname.match(/^\/(?:live|shorts)\/([a-zA-Z0-9_-]{11})/);
  return deepMatch?.[1] ?? null;
}
