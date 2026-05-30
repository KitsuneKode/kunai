// =============================================================================
// playback-startup-format.ts — pure startup/stream formatting helpers
//
// Extracted from PlaybackPhase to keep that file focused on flow control. These
// are pure (no container, no closure) and depend only on domain/player types.
// =============================================================================

import type { StreamInfo } from "@/domain/types";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import type { PlaybackStartupStage } from "@/services/playback/playback-startup-timeline";

export function playbackStartupStageForPlayerEvent(
  event: PlayerPlaybackEvent,
): PlaybackStartupStage | null {
  switch (event.type) {
    case "media-materialized":
      return "media-materialized";
    case "launching-player":
      return "player-launch";
    case "mpv-process-started":
      return "mpv-process-started";
    case "ipc-connected":
      return "ipc-connected";
    case "player-ready":
      return "player-ready";
    case "subtitle-attached":
      return "subtitle-attached";
    case "playback-progress":
      return "first-progress";
    default:
      return null;
  }
}

export function summarizeStartupStreamSource(stream: StreamInfo | null | undefined) {
  if (!stream?.providerResolveResult) return null;
  const result = stream.providerResolveResult;
  const selected =
    result.streams.find((candidate) => candidate.id === result.selectedStreamId) ??
    result.streams[0];
  const selectedSource = result.sources?.find((candidate) => candidate.id === selected?.sourceId);
  return {
    providerId: result.providerId,
    sourceId: selected?.sourceId ?? null,
    streamId: selected?.id ?? null,
    host: (selected?.url ? safeHostname(selected.url) : null) ?? selectedSource?.host ?? null,
    subtitleCount: result.subtitles.length,
    sourceCount: result.sources?.length ?? 0,
    streamCount: result.streams.length,
    hasTiming: hasProviderTimingMetadata(selected?.metadata),
  };
}

function hasProviderTimingMetadata(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return (
    Boolean(metadata.intro) ||
    Boolean(metadata.outro) ||
    Boolean(metadata.introStart) ||
    Boolean(metadata.introEnd) ||
    Boolean(metadata.outroStart) ||
    Boolean(metadata.outroEnd)
  );
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function formatPlaybackStreamRoute(stream: StreamInfo): string | null {
  const source = summarizeStartupStreamSource(stream);
  if (!source) return null;
  return [source.providerId, source.host ?? source.sourceId].filter(Boolean).join(" / ");
}
