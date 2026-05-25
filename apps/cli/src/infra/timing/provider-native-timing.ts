import type {
  PlaybackTimingMetadata,
  PlaybackTimingSegment,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";

export function extractProviderNativeTiming(
  stream: StreamInfo,
  title: TitleInfo,
): PlaybackTimingMetadata | null {
  const selectedStream = stream.providerResolveResult?.streams.find(
    (candidate) => candidate.id === stream.providerResolveResult?.selectedStreamId,
  );
  const metadata = selectedStream?.metadata;
  if (!metadata) return null;

  const intro = normalizeProviderTimingSegment(metadata.intro);
  const credits = normalizeProviderTimingSegment(metadata.outro);
  if (!intro && !credits) return null;

  return {
    tmdbId: title.id,
    type: title.type === "movie" ? "movie" : "series",
    intro: intro ? [intro] : [],
    recap: [],
    credits: credits ? [credits] : [],
    preview: [],
  };
}

function normalizeProviderTimingSegment(value: unknown): PlaybackTimingSegment | null {
  if (!value || typeof value !== "object") return null;
  const segment = value as { readonly start?: unknown; readonly end?: unknown };
  if (typeof segment.start !== "number" || typeof segment.end !== "number") return null;
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  if (segment.end <= segment.start) return null;
  return {
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
  };
}
