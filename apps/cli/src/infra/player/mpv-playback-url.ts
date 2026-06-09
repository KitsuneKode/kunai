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
