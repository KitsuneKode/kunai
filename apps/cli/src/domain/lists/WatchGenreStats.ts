import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import type { WatchStatsTitleSecondsRow } from "@kunai/storage";
import type { ProviderExternalIds } from "@kunai/types";

export type GenreBreakdownEntry = {
  readonly genreId: number;
  readonly label: string;
  readonly totalSeconds: number;
};

export type WatchGenreBreakdown = {
  readonly genres: readonly GenreBreakdownEntry[];
  readonly resolvedTitles: number;
  readonly totalTitles: number;
};

const TITLE_CONCURRENCY = 5;

/**
 * TMDB JSON reader seam. Injectable so tests can supply a fake without
 * replacing the shared `tmdb-proxy` module process-wide — a global module mock
 * leaks into every other suite that reads TMDB.
 */
export type TmdbJsonReader = (path: string) => Promise<unknown>;

export async function buildWatchGenreBreakdown(
  rows: readonly WatchStatsTitleSecondsRow[],
  fetchJson: TmdbJsonReader = fetchTmdbJsonCached,
): Promise<WatchGenreBreakdown> {
  if (rows.length === 0) {
    return { genres: [], resolvedTitles: 0, totalTitles: 0 };
  }

  const genreSeconds = new Map<number, { label: string; totalSeconds: number }>();
  let resolvedTitles = 0;

  for (let index = 0; index < rows.length; index += TITLE_CONCURRENCY) {
    const batch = rows.slice(index, index + TITLE_CONCURRENCY);
    const profiles = await Promise.all(
      batch.map(async (row) => {
        const resolved = await resolveWatchTitleTmdbIdentity(row, fetchJson);
        if (!resolved) return null;
        const genres = await fetchTitleGenres(resolved.id, resolved.mediaType, fetchJson).catch(
          () => [],
        );
        if (genres.length === 0) return null;
        return { row, genres };
      }),
    );

    for (const profile of profiles) {
      if (!profile) continue;
      resolvedTitles += 1;
      const share = profile.row.totalSeconds / profile.genres.length;
      for (const genre of profile.genres) {
        const existing = genreSeconds.get(genre.id);
        genreSeconds.set(genre.id, {
          label: genre.name,
          totalSeconds: (existing?.totalSeconds ?? 0) + share,
        });
      }
    }
  }

  const genres = [...genreSeconds.entries()]
    .map(([genreId, value]) => ({
      genreId,
      label: value.label,
      totalSeconds: Math.round(value.totalSeconds),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  return {
    genres,
    resolvedTitles,
    totalTitles: rows.length,
  };
}

/** Resolve TMDB id from stored ids, numeric title_id, or a bounded title search. */
export async function resolveWatchTitleTmdbIdentity(
  row: WatchStatsTitleSecondsRow,
  fetchJson: TmdbJsonReader = fetchTmdbJsonCached,
): Promise<{ id: string; mediaType: "movie" | "tv" } | null> {
  const fromIds = resolveTmdbIdentityFromStoredIds(row);
  if (fromIds) return fromIds;

  const title = row.title.trim();
  if (title.length === 0) return null;
  const mediaType = row.mediaKind === "movie" ? "movie" : "tv";
  return searchTmdbTitleByName(title, mediaType, fetchJson);
}

export function resolveTmdbIdentityFromStoredIds(
  row: Pick<WatchStatsTitleSecondsRow, "titleId" | "mediaKind" | "externalIdsJson">,
): { id: string; mediaType: "movie" | "tv" } | null {
  const externalIds = parseExternalIds(row.externalIdsJson);
  const mediaType = row.mediaKind === "movie" ? "movie" : "tv";
  const titleId = row.titleId.trim();

  if (externalIds?.tmdbId && /^\d+$/.test(externalIds.tmdbId)) {
    return { id: externalIds.tmdbId, mediaType };
  }
  if (/^\d+$/.test(titleId)) {
    return { id: titleId, mediaType };
  }
  const prefixed = /^tmdb:(\d+)$/.exec(titleId);
  if (prefixed?.[1]) {
    return { id: prefixed[1], mediaType };
  }
  return null;
}

function parseExternalIds(json: string | null): ProviderExternalIds | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as ProviderExternalIds;
  } catch {
    return undefined;
  }
}

async function searchTmdbTitleByName(
  title: string,
  mediaType: "movie" | "tv",
  fetchJson: TmdbJsonReader,
): Promise<{ id: string; mediaType: "movie" | "tv" } | null> {
  const data = (await fetchJson(
    `/search/${mediaType}?query=${encodeURIComponent(title)}&include_adult=false&page=1`,
  ).catch(() => null)) as { results?: Array<{ id?: number }> } | null;
  const match = data?.results?.find((item) => typeof item.id === "number");
  if (!match?.id) return null;
  return { id: String(match.id), mediaType };
}

async function fetchTitleGenres(
  id: string,
  mediaType: "movie" | "tv",
  fetchJson: TmdbJsonReader,
): Promise<readonly { id: number; name: string }[]> {
  const details = (await fetchJson(`/${mediaType}/${id}`)) as {
    genres?: Array<{ id?: number; name?: string }>;
  };
  return (details.genres ?? [])
    .map((genre) =>
      typeof genre.id === "number" && typeof genre.name === "string"
        ? { id: genre.id, name: genre.name }
        : null,
    )
    .filter((genre): genre is { id: number; name: string } => genre !== null);
}
