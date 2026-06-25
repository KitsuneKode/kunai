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

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function isYoutubeWatchUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/shorts\/)/i.test(
    url.trim(),
  );
}

export function extractYoutubeVideoIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) return watchMatch[1];
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) return shortMatch[1];
  const liveMatch = trimmed.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
  if (liveMatch?.[1]) return liveMatch[1];
  const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch?.[1]) return shortsMatch[1];
  return null;
}
