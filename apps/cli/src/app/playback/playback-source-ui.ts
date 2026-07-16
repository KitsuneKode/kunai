import type { StreamInfo } from "@/domain/types";

export { isLocalPlaybackStream } from "@/domain/playback/local-playback-stream";

export function formatLocalPlaybackSourceLine(stream: StreamInfo): string {
  const title = stream.title?.trim();
  if (title) return `↓ Offline · ${title}`;
  return "↓ Offline · downloaded copy";
}
