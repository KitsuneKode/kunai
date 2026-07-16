export type MpvUrlKind = "remote" | "local";

/** Restricts provider-controlled media targets to HTTP(S); trusted local surfaces may use files. */
export function isAllowedMpvUrl(url: string, kind: MpvUrlKind): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("-")) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (kind !== "local") return false;
  if (/^file:\/\//i.test(trimmed)) return true;
  return !trimmed.includes("://");
}

/** Remote HTTP(S) HLS manifest URL. */
export function isRemoteHlsManifestPlaybackUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) && /\.m3u8(?:[?#]|$)/i.test(trimmed);
}

/** Local `.m3u8` paths produced by the HLS manifest materializer (not remote URLs). */
export function isLocalHlsManifestPlaybackUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false;
  return /\.m3u8(?:[?#]|$)/i.test(trimmed);
}

export function isYoutubeWatchUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/shorts\/)/i.test(
    url.trim(),
  );
}
