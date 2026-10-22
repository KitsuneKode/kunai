import type { ContentType, PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";
import {
  classifyTimingHttpStatus,
  classifyTimingThrownError,
  type PlaybackTimingSourceFetchResult,
} from "@/infra/timing/PlaybackTimingSource";

const INTRODB_API = "https://api.theintrodb.org/v4/media";

type IntroDbPayload = {
  tvdb_id?: number;
  season?: number;
  episode?: number;
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
  if (parentSignal?.aborted || signal?.aborted) {
    return { metadata: null, failureClass: "cancelled" };
  }
  if (
    !isUsableTmdbId(tmdbId) ||
    (type === "series" &&
      (!Number.isInteger(season) || season! < 0 || !Number.isInteger(episode) || episode! < 1))
  ) {
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

    const body: unknown = await response.json();
    if (parentSignal?.aborted || signal?.aborted) {
      return {
        metadata: null,
        failureClass: parentSignal?.aborted || !parentSignal ? "cancelled" : "timeout",
      };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { metadata: null, failureClass: "http-error" };
    }
    const payload = body as IntroDbPayload;
    // Raw v4 HTTP bodies have no SDK `kind` discriminator. Refuse the
    // versions/episodes alternatives and keep TVDB identity out of TMDB fields.
    if (
      !Number.isSafeInteger(payload.tvdb_id) ||
      payload.tvdb_id! <= 0 ||
      payload.type !== (type === "movie" ? "movie" : "tv") ||
      "versions" in body ||
      "episodes" in body ||
      (type === "series" && (payload.season !== season || payload.episode !== episode))
    ) {
      return { metadata: null, failureClass: "http-error" };
    }
    return {
      metadata: {
        tmdbId,
        type,
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
      failureClass: parentSignal?.aborted
        ? "cancelled"
        : classifyTimingThrownError(error, { parentSignal }),
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
  const startMs = toOptionalInt(entry.start_ms);
  const endMs = toOptionalInt(entry.end_ms);
  if (
    (entry.start_ms != null && startMs === null) ||
    (entry.end_ms != null && endMs === null) ||
    (startMs === null && endMs === null) ||
    (startMs !== null && endMs !== null && endMs <= startMs)
  )
    return null;
  return { startMs, endMs };
}

function toOptionalInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
