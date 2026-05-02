import type {
  CachePolicy,
  EpisodeIdentity,
  ProviderFailure,
  ProviderId,
  ProviderResolveResult,
  ProviderRuntime,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";

import { createResolveTrace, createTraceStep } from "./trace";

export interface CliStreamInfoLike {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly subtitle?: string;
  readonly subtitleList?: readonly CliSubtitleTrackLike[];
  readonly subtitleSource?: "direct" | "wyzie" | "provider" | "none";
  readonly title?: string;
  readonly timestamp?: number;
}

export interface CliSubtitleTrackLike {
  readonly url: string;
  readonly display?: string;
  readonly language?: string;
  readonly release?: string;
}

export interface AdaptCliStreamResultInput {
  readonly providerId: ProviderId;
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly stream: CliStreamInfoLike;
  readonly cachePolicy: CachePolicy;
  readonly runtime: ProviderRuntime;
  readonly cacheHit?: boolean;
  readonly failures?: readonly ProviderFailure[];
}

export function adaptCliStreamResult(input: AdaptCliStreamResultInput): ProviderResolveResult {
  const stream = streamInfoToCandidate(input.stream, input.providerId, input.cachePolicy);
  const subtitles = streamInfoToSubtitleCandidates(
    input.stream,
    input.providerId,
    input.cachePolicy,
  );
  const trace = createResolveTrace({
    title: input.title,
    episode: input.episode,
    providerId: input.providerId,
    streamId: stream.id,
    cacheHit: input.cacheHit ?? false,
    runtime: input.runtime,
    endedAt: new Date().toISOString(),
    steps: [
      createTraceStep("provider", "Provider returned a CLI stream result", {
        providerId: input.providerId,
        attributes: { hasSubtitles: subtitles.length > 0 },
      }),
      createTraceStep("runtime", `Resolved through ${input.runtime}`, {
        providerId: input.providerId,
      }),
    ],
    failures: input.failures ?? [],
  });

  return {
    providerId: input.providerId,
    streams: [stream],
    subtitles,
    cachePolicy: input.cachePolicy,
    trace,
    failures: input.failures ?? [],
  };
}

export function streamInfoToCandidate(
  stream: CliStreamInfoLike,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
): StreamCandidate {
  const protocol = inferProtocol(stream.url);

  return {
    id: `stream:${providerId}:${hashCandidateId(stream.url)}`,
    providerId,
    url: stream.url,
    protocol,
    container: protocol === "hls" ? "m3u8" : protocol === "dash" ? "mpd" : "unknown",
    headers: stream.headers,
    confidence: 0.9,
    cachePolicy,
    metadata: {
      title: stream.title,
      observedAt: stream.timestamp,
    },
  };
}

export function streamInfoToSubtitleCandidates(
  stream: CliStreamInfoLike,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
): SubtitleCandidate[] {
  const candidates = new Map<string, SubtitleCandidate>();

  for (const track of stream.subtitleList ?? []) {
    candidates.set(
      track.url,
      subtitleTrackToCandidate(track, providerId, cachePolicy, stream.subtitleSource),
    );
  }

  if (stream.subtitle && !candidates.has(stream.subtitle)) {
    candidates.set(
      stream.subtitle,
      subtitleTrackToCandidate(
        { url: stream.subtitle, display: "Selected subtitle" },
        providerId,
        cachePolicy,
        stream.subtitleSource,
      ),
    );
  }

  return [...candidates.values()];
}

function subtitleTrackToCandidate(
  track: CliSubtitleTrackLike,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
  source: CliStreamInfoLike["subtitleSource"],
): SubtitleCandidate {
  return {
    id: `subtitle:${providerId}:${hashCandidateId(track.url)}`,
    providerId,
    url: track.url,
    language: track.language,
    label: track.display ?? track.release,
    format: inferSubtitleFormat(track.url),
    source: toSharedSubtitleSource(source),
    confidence: 0.75,
    syncEvidence: track.release,
    cachePolicy: {
      ...cachePolicy,
      ttlClass: "subtitle-list",
    },
  };
}

function toSharedSubtitleSource(
  source: CliStreamInfoLike["subtitleSource"],
): SubtitleCandidate["source"] {
  if (source === "direct" || source === "provider") return "provider";
  if (source === "wyzie") return "wyzie";
  return "unknown";
}

function inferProtocol(url: string): StreamCandidate["protocol"] {
  if (url.includes(".m3u8")) return "hls";
  if (url.includes(".mpd")) return "dash";
  if (url.includes(".mp4")) return "mp4";
  return "unknown";
}

function inferSubtitleFormat(url: string): SubtitleCandidate["format"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".ass")) return "ass";
  return "unknown";
}

function hashCandidateId(value: string): string {
  return Bun.hash(value).toString(36);
}
