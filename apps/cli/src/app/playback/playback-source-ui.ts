import type { StreamInfo } from "@/domain/types";

/** True when playback is serving a verified local file instead of a provider resolve. */
export function isLocalPlaybackStream(stream: StreamInfo | null | undefined): boolean {
  if (!stream?.url) return false;
  if (stream.providerResolveResult) return false;
  const url = stream.url;
  if (url.startsWith("/") || url.startsWith("file:")) return true;
  return !/^https?:\/\//i.test(url);
}

export function formatLocalPlaybackSourceLine(stream: StreamInfo): string {
  const title = stream.title?.trim();
  if (title) return `↓ Offline · ${title}`;
  return "↓ Offline · downloaded copy";
}
