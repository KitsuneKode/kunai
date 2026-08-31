import { requirePortableHttpUrl } from "../../application/portable-url";

const VLC_STREAM_PREFIX = "vlc-x-callback://x-callback-url/stream?url=";

export function toVlcXCallbackUrl(mediaUrl: string): string {
  requirePortableHttpUrl(mediaUrl, "Media URL");
  return `${VLC_STREAM_PREFIX}${encodeURIComponent(mediaUrl)}`;
}
