import type { ContentType, PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";
import {
  classifyTimingHttpStatus,
  classifyTimingThrownError,
  type PlaybackTimingSourceFetchResult,
} from "@/infra/timing/PlaybackTimingSource";

const INTRODB_API = "https://api.theintrodb.org/v2/media";

type IntroDbPayload = {
  tmdb_id?: number | string;
  type?: string;
  intro?: unknown;
  recap?: unknown;
  credits?: unknown;
  preview?: unknown;
};

export async function fetchPlaybackTimingMetadata(opts: {
  tmdbId: string;
  type: ContentType;
  season?: number;
  episode?: number;
  signal?: AbortSignal;
}): Promise<PlaybackTimingMetadata | null> {
  const detailed = await fetchPlaybackTimingMetadataDetailed(opts);
  return detailed.metadata;
}

export async function fetchPlaybackTimingMetadataDetailed(opts: {
  tmdbId: string;
  type: ContentType;
  season?: number;
  episode?: number;
  signal?: AbortSignal;
  parentSignal?: AbortSignal;
}): Promise<PlaybackTimingSourceFetchResult> {
  const { tmdbId, type, season, episode, signal, parentSignal } = opts;
  if (!isUsableTmdbId(tmdbId)) {
    return { metadata: null, failureClass: "identity-missing" };
  }

  const params = new URLSearchParams({ tmdb_id: tmdbId });
  if (type === "series" && season !== undefined) params.set("season", String(season));
  if (type === "series" && episode !== undefined) params.set("episode", String(episode));

  try {
    const response = await fetch(`${INTRODB_API}?${params.toString()}`, {
      signal: signal ?? AbortSignal.timeout(4_000),
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
    });

    if (!response.ok) {
      return {
        metadata: null,
        failureClass: classifyTimingHttpStatus(response.status),
      };
    }

    const payload = (await response.json()) as IntroDbPayload;
    return {
      metadata: {
        tmdbId: String(payload.tmdb_id ?? tmdbId),
        type: payload.type === "movie" ? "movie" : "series",
        intro: normalizeSegments(payload.intro),
        recap: normalizeSegments(payload.recap),
        credits: normalizeSegments(payload.credits),
        preview: normalizeSegments(payload.preview),
      },
      failureClass: null,
    };
  } catch (error) {
    return {
      metadata: null,
      failureClass: classifyTimingThrownError(error, { parentSignal }),
    };
  }
}

function isUsableTmdbId(id: string): boolean {
  return /^\d{1,12}$/.test(id);
}

function normalizeSegments(value: unknown): PlaybackTimingSegment[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeSegment(item))
    .filter((segment): segment is PlaybackTimingSegment => segment !== null);
}

function normalizeSegment(value: unknown): PlaybackTimingSegment | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  return {
    startMs: toOptionalInt(entry.start_ms),
    endMs: toOptionalInt(entry.end_ms),
  };
}

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
