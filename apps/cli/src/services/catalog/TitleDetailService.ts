// =============================================================================
// TitleDetailService — best-of-provider metadata + artwork for a title
//
// Public entry point: fetchTitleDetail(id, type, signal?)
//   → Promise<TitleDetail>
//
// Fetches from TMDB (via db.videasy.to proxy with direct-API fallback) and
// AniList in parallel, merges the results into the frozen TitleDetail contract
// defined in domain/catalog/title-detail.ts, and caches the outcome so
// repeated calls within a session are free.
//
// Content-kind routing:
//   • id starts with "anilist:" → AniList primary, TMDB secondary
//   • id starts with "tmdb:"    → TMDB primary, AniList secondary (anime only)
//   • type = "movie"            → TMDB only
//   • type = "series"           → TMDB primary, AniList secondary (if anilistId present)
//
// TVDB: the proxy and direct TMDB API do not expose TVDB data, and adding a
// live TVDB credential/infra layer is out of scope. Season posters from TMDB
// season detail endpoints are used instead and labeled "tmdb".
// =============================================================================

import {
  ARTWORK_PREFERENCE,
  type ArtworkCandidate,
  type CastMember,
  type MetadataSource,
  type SeasonSummary,
  type TitleDetail,
  type TitleStatus,
  episodeThumbKey,
  mergeArtwork,
} from "@/domain/catalog/title-detail";
import type { ContentType } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { clearTmdbSessionCache, fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import {
  filterPlayableEpisodes,
  isDefinitelyFutureAirDate,
  isPlayableEpisode,
  seasonHasPlayableEpisodes,
  seasonSummaryNeedsEpisodeVerification,
} from "@/services/catalog/tmdb-release";
import type { ProviderExternalIds } from "@kunai/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const ANILIST_GRAPHQL = "https://graphql.anilist.co";

const FETCH_TIMEOUT_MS = 8_000;
const CREDITS_CAST_LIMIT = 15;

// ---------------------------------------------------------------------------
// In-memory session cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly detail: TitleDetail;
  readonly fetchedAt: number;
}

// TTL: 5 minutes within a session (enough to survive repeated renders without
// re-fetching on every frame).
const CACHE_TTL_MS = 5 * 60 * 1_000;
const detailCache = new Map<string, CacheEntry>();

function cacheKey(id: string, type: ContentType): string {
  return `${type}:${id}`;
}

/** Clear the session cache (for testing or manual refresh). */
export function clearTitleDetailCache(): void {
  detailCache.clear();
  clearTmdbSessionCache();
}

/**
 * Synchronously return a cached `TitleDetail` if one is warm (within TTL), else
 * `undefined`. Never triggers a fetch — used by surfaces that must not block on
 * the network (e.g. the post-play rail reads this after an early prefetch).
 */
export function peekTitleDetail(id: string, type: ContentType): TitleDetail | undefined {
  const cached = detailCache.get(cacheKey(id, type));
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.detail;
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a fully-populated `TitleDetail` for the given title id and type.
 *
 * @param id    Canonical id in one of the recognized prefixed formats:
 *              `"tmdb:123"`, `"anilist:456"`, or a bare numeric string
 *              (treated as tmdb id for backward compat).
 * @param type  `"movie"` or `"series"`.
 * @param signal  Optional AbortSignal — propagated to all fetch calls.
 */
export async function fetchTitleDetail(
  id: string,
  type: ContentType,
  signal?: AbortSignal,
): Promise<TitleDetail> {
  const key = cacheKey(id, type);
  const now = Date.now();
  const cached = detailCache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.detail;
  }

  const detail = await resolveTitleDetail(id, type, signal);
  detailCache.set(key, { detail, fetchedAt: now });
  return detail;
}

// ---------------------------------------------------------------------------
// Resolution strategy
// ---------------------------------------------------------------------------

async function resolveTitleDetail(
  id: string,
  type: ContentType,
  signal?: AbortSignal,
): Promise<TitleDetail> {
  const tmdbId = extractTmdbId(id);
  const anilistId = extractAnilistId(id);

  // Determine what to fetch in parallel
  const fetches: Promise<unknown>[] = [];
  let tmdbFetch: Promise<TmdbDetailResult | null> | null = null;
  let anilistFetch: Promise<AniListDetailResult | null> | null = null;

  if (tmdbId) {
    tmdbFetch = fetchTmdbDetail(tmdbId, type, signal);
    fetches.push(tmdbFetch);
  }

  // AniList is relevant for anime series or when we have an explicit anilistId
  if (anilistId || (type === "series" && !tmdbId)) {
    const alId = anilistId ?? (tmdbId ? null : null);
    if (alId) {
      anilistFetch = fetchAniListDetail(alId, signal);
      fetches.push(anilistFetch);
    }
  }

  // If we have a tmdbId but this might be anime, also fetch AniList via
  // the externalId lookup (TMDB exposes anilist ID in external_ids endpoint).
  // We do that in a second wave after TMDB returns so we know if it is anime.

  await Promise.allSettled(fetches);

  const tmdb = tmdbFetch ? await tmdbFetch.catch(() => null) : null;
  let anilist = anilistFetch ? await anilistFetch.catch(() => null) : null;

  // Second-wave: if TMDB returned an anilist_id in its external IDs, fetch it
  if (tmdb && !anilist && tmdb.externalIds?.anilistId) {
    anilist = await fetchAniListDetail(tmdb.externalIds.anilistId, signal).catch(() => null);
  }

  return mergeDetails(id, type, tmdb, anilist);
}

// ---------------------------------------------------------------------------
// Merge TMDB + AniList into TitleDetail
// ---------------------------------------------------------------------------

function mergeDetails(
  id: string,
  type: ContentType,
  tmdb: TmdbDetailResult | null,
  anilist: AniListDetailResult | null,
): TitleDetail {
  const sources: MetadataSource[] = [];
  if (tmdb) sources.push("tmdb");
  if (anilist) sources.push("anilist");

  // Determine content kind for artwork preference
  const isAnime = anilist !== null || tmdb?.genres?.includes("Animation") === true;
  const artworkKind: "anime" | "series" | "movie" =
    type === "movie" ? "movie" : isAnime ? "anime" : "series";
  const preference = ARTWORK_PREFERENCE[artworkKind];

  // Collect artwork candidates
  const artworkCandidates: ArtworkCandidate[] = [];
  if (tmdb?.artwork) artworkCandidates.push(tmdb.artwork);
  if (anilist?.artwork) artworkCandidates.push(anilist.artwork);

  const artwork = mergeArtwork(artworkCandidates, preference);

  // Merge external IDs
  const externalIds: ProviderExternalIds = {
    ...tmdb?.externalIds,
    ...anilist?.externalIds,
  };

  // Prefer AniList title for anime, TMDB title for everything else
  const title =
    artworkKind === "anime"
      ? (anilist?.title ?? tmdb?.title ?? "Unknown")
      : (tmdb?.title ?? anilist?.title ?? "Unknown");

  const synopsis =
    artworkKind === "anime"
      ? (anilist?.synopsis ?? tmdb?.synopsis)
      : (tmdb?.synopsis ?? anilist?.synopsis);

  const genres = dedupe([...(tmdb?.genres ?? []), ...(anilist?.genres ?? [])]);
  const studios = dedupe([...(tmdb?.studios ?? []), ...(anilist?.studios ?? [])]);

  // Cast: prefer voice cast from AniList for anime, actor cast from TMDB otherwise
  const cast: CastMember[] =
    artworkKind === "anime"
      ? [...(anilist?.cast ?? []), ...(tmdb?.cast ?? [])]
      : [...(tmdb?.cast ?? []), ...(anilist?.cast ?? [])];

  // Seasons: always from TMDB (AniList does not expose season granularity)
  const seasons = tmdb?.seasons ?? undefined;

  // Status
  const status = tmdb?.status ?? anilist?.status ?? undefined;

  return {
    id,
    type,
    title,
    year: tmdb?.year ?? anilist?.year ?? undefined,
    synopsis,
    genres: genres.length ? genres : undefined,
    studios: studios.length ? studios : undefined,
    runtimeMinutes: tmdb?.runtimeMinutes ?? anilist?.runtimeMinutes ?? undefined,
    contentRating: tmdb?.contentRating ?? undefined,
    releaseDate: tmdb?.releaseDate ?? anilist?.releaseDate ?? undefined,
    status,
    seasonCount: tmdb?.seasonCount ?? undefined,
    episodeCount: tmdb?.episodeCount ?? anilist?.episodeCount ?? undefined,
    seasons,
    cast: cast.length ? cast : undefined,
    artwork: Object.keys(artwork).length ? artwork : undefined,
    externalIds: Object.keys(externalIds).length ? externalIds : undefined,
    sources: sources.length ? sources : undefined,
  };
}

// ---------------------------------------------------------------------------
// TMDB fetch
// ---------------------------------------------------------------------------

interface TmdbDetailResult {
  readonly title: string;
  readonly year?: string;
  readonly synopsis?: string;
  readonly genres?: readonly string[];
  readonly studios?: readonly string[];
  readonly runtimeMinutes?: number;
  readonly contentRating?: string;
  readonly releaseDate?: string;
  readonly status?: TitleStatus;
  readonly seasonCount?: number;
  readonly episodeCount?: number;
  readonly seasons?: readonly SeasonSummary[];
  readonly cast?: readonly CastMember[];
  readonly artwork: ArtworkCandidate;
  readonly externalIds?: ProviderExternalIds;
}

async function fetchTmdbDetail(
  tmdbId: string,
  type: ContentType,
  signal?: AbortSignal,
): Promise<TmdbDetailResult | null> {
  const mediaType = type === "movie" ? "movie" : "tv";

  // Fetch main detail + credits + external IDs in parallel
  const [detailRes, creditsRes, externalRes] = await Promise.allSettled([
    fetchJsonWithFallback(`/${mediaType}/${tmdbId}`, signal),
    fetchJsonWithFallback(`/${mediaType}/${tmdbId}/credits`, signal),
    fetchJsonWithFallback(`/${mediaType}/${tmdbId}/external_ids`, signal),
  ]);

  const detail = detailRes.status === "fulfilled" ? detailRes.value : null;
  if (!detail) return null;

  const d = readRecord(detail);
  const credits = creditsRes.status === "fulfilled" ? readRecord(creditsRes.value) : {};
  const externalIds = externalRes.status === "fulfilled" ? readRecord(externalRes.value) : {};

  // For TV: also fetch season details to get season-level posters + episode thumbs
  let seasons: SeasonSummary[] | undefined;
  let episodeThumbnails: Record<string, string> | undefined;
  let seasonPosters: Record<number, string> | undefined;

  if (type === "series") {
    const rawSeasons = Array.isArray(d.seasons) ? d.seasons.map(readRecord) : [];
    const nonSpecials = rawSeasons.filter(
      (s) => Number(s.season_number) > 0 && Number(s.episode_count) > 0,
    );

    if (nonSpecials.length > 0) {
      const episodeThumbnailMap: Record<string, string> = {};
      const seasonPosterMap: Record<number, string> = {};
      const playableSeasons: SeasonSummary[] = [];
      const ambiguousSeasons: Array<{ seasonNum: number; seasonMeta: Record<string, unknown> }> =
        [];
      const fetchedSeasonPayloads = new Map<number, Record<string, unknown>>();

      for (const seasonMeta of nonSpecials) {
        const seasonNum = Number(seasonMeta.season_number);
        const seasonAirDate = readString(seasonMeta.air_date);
        const posterPath = readString(seasonMeta.poster_path);

        if (posterPath) {
          seasonPosterMap[seasonNum] = tmdbImage(posterPath, "w342");
        }

        if (isDefinitelyFutureAirDate(seasonAirDate)) continue;

        if (seasonSummaryNeedsEpisodeVerification(seasonAirDate)) {
          ambiguousSeasons.push({ seasonNum, seasonMeta });
          continue;
        }

        playableSeasons.push({
          season: seasonNum,
          name: readString(seasonMeta.name) || `Season ${seasonNum}`,
          episodeCount: Number(seasonMeta.episode_count) || undefined,
          year: seasonAirDate.split("-")[0] || undefined,
          posterUrl: posterPath ? tmdbImage(posterPath, "w342") : undefined,
        });
      }

      if (ambiguousSeasons.length > 0) {
        const ambiguousResults = await Promise.allSettled(
          ambiguousSeasons.map(({ seasonNum }) =>
            fetchJsonWithFallback(`/tv/${tmdbId}/season/${seasonNum}`, signal).catch(() => null),
          ),
        );

        ambiguousResults.forEach((result, idx) => {
          const entry = ambiguousSeasons[idx];
          if (!entry || result.status !== "fulfilled" || !result.value) return;

          const { seasonNum, seasonMeta } = entry;
          const posterPath = readString(seasonMeta.poster_path);
          const sd = readRecord(result.value);
          fetchedSeasonPayloads.set(seasonNum, sd);
          const episodes = Array.isArray(sd.episodes) ? sd.episodes.map(readRecord) : [];
          const playableEpisodes = filterPlayableEpisodes(
            episodes.map((ep) => ({
              number: Number(ep.episode_number),
              airDate: readString(ep.air_date),
            })),
          );
          if (!seasonHasPlayableEpisodes(playableEpisodes)) return;

          playableSeasons.push({
            season: seasonNum,
            name: readString(seasonMeta.name) || `Season ${seasonNum}`,
            episodeCount: playableEpisodes.length || undefined,
            year: readString(seasonMeta.air_date)?.split("-")[0] || undefined,
            posterUrl: posterPath ? tmdbImage(posterPath, "w342") : undefined,
          });
        });
      }

      const thumbSeasonNums = playableSeasons
        .map((season) => season.season)
        .sort((left, right) => left - right)
        .slice(0, 3);
      const thumbFetches = await Promise.allSettled(
        thumbSeasonNums
          .filter((seasonNum) => !fetchedSeasonPayloads.has(seasonNum))
          .map((seasonNum) =>
            fetchJsonWithFallback(`/tv/${tmdbId}/season/${seasonNum}`, signal).catch(() => null),
          ),
      );
      const thumbFetchSeasonNums = thumbSeasonNums.filter(
        (seasonNum) => !fetchedSeasonPayloads.has(seasonNum),
      );

      for (const seasonNum of thumbSeasonNums) {
        const cached = fetchedSeasonPayloads.get(seasonNum);
        if (cached) {
          appendEpisodeThumbnails(episodeThumbnailMap, seasonNum, cached);
        }
      }

      thumbFetches.forEach((result, idx) => {
        if (result.status !== "fulfilled" || !result.value) return;
        const seasonNum = thumbFetchSeasonNums[idx];
        if (seasonNum === undefined) return;

        appendEpisodeThumbnails(episodeThumbnailMap, seasonNum, readRecord(result.value));
      });

      episodeThumbnails =
        Object.keys(episodeThumbnailMap).length > 0 ? episodeThumbnailMap : undefined;
      seasonPosters = Object.keys(seasonPosterMap).length > 0 ? seasonPosterMap : undefined;
      seasons =
        playableSeasons.length > 0
          ? playableSeasons.sort((a, b) => a.season - b.season)
          : undefined;
    }
  }

  // Content rating
  const contentRating = extractTmdbContentRating(d, type);

  // Cast
  const rawCast = Array.isArray(credits.cast) ? credits.cast.map(readRecord) : [];
  const cast: CastMember[] = rawCast.slice(0, CREDITS_CAST_LIMIT).map((member): CastMember => {
    const photoPath = readString(member.profile_path);
    return {
      name: readString(member.name) || "Unknown",
      role: readString(member.character) || undefined,
      kind: "actor",
      photoUrl: photoPath ? tmdbImage(photoPath, "w185") : undefined,
    };
  });

  // Artwork
  const posterPath = readString(d.poster_path);
  const backdropPath = readString(d.backdrop_path);
  const artwork: ArtworkCandidate = {
    source: "tmdb",
    poster: posterPath ? tmdbImage(posterPath, "w500") : undefined,
    backdrop: backdropPath ? tmdbImage(backdropPath, "w780") : undefined,
    ...(seasonPosters ? { seasonPosters } : {}),
    ...(episodeThumbnails ? { episodeThumbnails } : {}),
  };

  // External IDs
  const anilistId = readString(externalIds.anilist_id) || undefined;
  const imdbId = readString(externalIds.imdb_id) || undefined;
  const tmdbIdStr = String(d.id || tmdbId);

  // Genres
  const rawGenres = Array.isArray(d.genres) ? d.genres.map(readRecord) : [];
  const genres = rawGenres.map((g) => readString(g.name)).filter(Boolean);

  // Studios / networks
  const rawCompanies = Array.isArray(d.production_companies)
    ? d.production_companies.map(readRecord)
    : [];
  const rawNetworks = Array.isArray(d.networks) ? d.networks.map(readRecord) : [];
  const studios = [...rawCompanies, ...rawNetworks]
    .map((c) => readString(c.name))
    .filter(Boolean)
    .slice(0, 5);

  // Status
  const rawStatus = readString(d.status).toLowerCase();
  const status = mapTmdbStatus(rawStatus);

  // Runtime
  const runtimeMinutes =
    type === "movie"
      ? typeof d.runtime === "number"
        ? d.runtime
        : undefined
      : typeof d.episode_run_time === "object" && Array.isArray(d.episode_run_time)
        ? typeof d.episode_run_time[0] === "number"
          ? d.episode_run_time[0]
          : undefined
        : undefined;

  // Dates
  const releaseDate =
    type === "movie"
      ? readString(d.release_date) || undefined
      : readString(d.first_air_date) || undefined;
  const year = releaseDate?.split("-")[0] || undefined;

  // Season + episode counts (TV only) — playable rows only, not raw TMDB totals
  const seasonCount =
    type === "series" ? (seasons && seasons.length > 0 ? seasons.length : undefined) : undefined;
  const episodeCount =
    type === "series"
      ? seasons && seasons.length > 0
        ? seasons.reduce((total, season) => total + (season.episodeCount ?? 0), 0) || undefined
        : undefined
      : undefined;

  return {
    title: readString(d.title) || readString(d.name) || "Unknown",
    year,
    synopsis: readString(d.overview) || undefined,
    genres: genres.length ? genres : undefined,
    studios: studios.length ? studios : undefined,
    runtimeMinutes,
    contentRating,
    releaseDate,
    status,
    seasonCount,
    episodeCount,
    seasons,
    cast: cast.length ? cast : undefined,
    artwork,
    externalIds: {
      tmdbId: tmdbIdStr,
      ...(imdbId ? { imdbId } : {}),
      ...(anilistId ? { anilistId } : {}),
    },
  };
}

function extractTmdbContentRating(
  d: Record<string, unknown>,
  type: ContentType,
): string | undefined {
  if (type === "movie") {
    // release_dates.results[] → release_type 3 (theatrical) in US
    const rdContainer = readRecord(d.release_dates);
    const rdResults = Array.isArray(rdContainer.results) ? rdContainer.results.map(readRecord) : [];
    const us = rdResults.find((r) => readString(r.iso_3166_1) === "US");
    if (us) {
      const releaseDates = Array.isArray(us.release_dates) ? us.release_dates.map(readRecord) : [];
      const theatrical = releaseDates.find(
        (r) => Number(r.type) === 3 && readString(r.certification),
      );
      const cert = theatrical
        ? readString(theatrical.certification)
        : readString(releaseDates[0]?.certification ?? "");
      if (cert) return cert;
    }
  } else {
    // content_ratings.results[] for TV
    const crContainer = readRecord(d.content_ratings);
    const crResults = Array.isArray(crContainer.results) ? crContainer.results.map(readRecord) : [];
    const us = crResults.find((r) => readString(r.iso_3166_1) === "US");
    if (us) {
      const rating = readString(us.rating);
      if (rating) return rating;
    }
  }
  return undefined;
}

function mapTmdbStatus(raw: string): TitleStatus | undefined {
  if (raw === "released" || raw === "post production" || raw === "in production") return "released";
  if (raw === "planned" || raw === "announced") return "upcoming";
  if (raw === "returning series") return "airing";
  if (raw === "ended" || raw === "canceled" || raw === "cancelled") return "released";
  return undefined;
}

function tmdbImage(path: string, size: string): string {
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

// ---------------------------------------------------------------------------
// AniList fetch
// ---------------------------------------------------------------------------

interface AniListDetailResult {
  readonly title: string;
  readonly year?: string;
  readonly synopsis?: string;
  readonly genres?: readonly string[];
  readonly studios?: readonly string[];
  readonly runtimeMinutes?: number;
  readonly releaseDate?: string;
  readonly status?: TitleStatus;
  readonly episodeCount?: number;
  readonly cast?: readonly CastMember[];
  readonly artwork: ArtworkCandidate;
  readonly externalIds?: ProviderExternalIds;
}

const ANILIST_DETAIL_QUERY = `
query($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    genres
    episodes
    duration
    status
    startDate { year month day }
    endDate { year }
    coverImage { extraLarge large }
    bannerImage
    studios(isMain: true) { nodes { name } }
    characters(role: MAIN, page: 1, perPage: 15, sort: [ROLE]) {
      nodes {
        name { full }
        image { medium }
        gender
      }
    }
    externalLinks { site url type }
  }
}
`;

async function fetchAniListDetail(
  anilistId: string,
  signal?: AbortSignal,
): Promise<AniListDetailResult | null> {
  const res = await fetch(ANILIST_GRAPHQL, {
    method: "POST",
    signal: withTimeoutSignal(signal, FETCH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: ANILIST_DETAIL_QUERY,
      variables: { id: Number(anilistId) },
    }),
  }).catch(() => null);

  if (!res || !res.ok) return null;

  const json = (await res.json().catch(() => null)) as {
    readonly data?: {
      readonly Media?: unknown;
    };
  } | null;

  const media = readRecord(json?.data?.Media);
  if (!media.id) return null;

  const title =
    readString(media.title && readRecord(media.title).english) ||
    readString(media.title && readRecord(media.title).romaji) ||
    readString(media.title && readRecord(media.title).native) ||
    "Unknown";

  const startDate = readRecord(media.startDate);
  const year = typeof startDate.year === "number" ? String(startDate.year) : undefined;
  const month =
    typeof startDate.month === "number" ? String(startDate.month).padStart(2, "0") : undefined;
  const day =
    typeof startDate.day === "number" ? String(startDate.day).padStart(2, "0") : undefined;
  const releaseDate = year && month && day ? `${year}-${month}-${day}` : undefined;

  const synopsis =
    readString(media.description).replace(/[<>]/g, "").replace(/\s+/g, " ").trim() || undefined;

  const genres = Array.isArray(media.genres)
    ? media.genres.filter((g): g is string => typeof g === "string")
    : [];

  const studiosNode = readRecord(media.studios);
  const studioNodes = Array.isArray(studiosNode.nodes) ? studiosNode.nodes.map(readRecord) : [];
  const studios = studioNodes.map((n) => readString(n.name)).filter(Boolean);

  const coverImage = readRecord(media.coverImage);
  const posterUrl = readString(coverImage.extraLarge) || readString(coverImage.large) || undefined;
  const backdropUrl = readString(media.bannerImage) || undefined;

  const artwork: ArtworkCandidate = {
    source: "anilist",
    poster: posterUrl,
    backdrop: backdropUrl,
  };

  const rawStatus = readString(media.status).toLowerCase();
  const status = mapAniListStatus(rawStatus);

  const episodeCount = typeof media.episodes === "number" ? media.episodes : undefined;
  const runtimeMinutes = typeof media.duration === "number" ? media.duration : undefined;

  // Voice cast
  const charsNode = readRecord(media.characters);
  const charNodes = Array.isArray(charsNode.nodes) ? charsNode.nodes.map(readRecord) : [];
  const cast: CastMember[] = charNodes.slice(0, CREDITS_CAST_LIMIT).map((node): CastMember => {
    const nameNode = readRecord(node.name);
    const imageNode = readRecord(node.image);
    return {
      name: readString(nameNode.full) || "Unknown",
      kind: "voice",
      photoUrl: readString(imageNode.medium) || undefined,
    };
  });

  const malId = typeof media.idMal === "number" ? String(media.idMal) : undefined;
  const anilistIdStr = String(media.id);

  return {
    title,
    year,
    synopsis,
    genres: genres.length ? genres : undefined,
    studios: studios.length ? studios : undefined,
    runtimeMinutes,
    releaseDate,
    status,
    episodeCount,
    cast: cast.length ? cast : undefined,
    artwork,
    externalIds: {
      anilistId: anilistIdStr,
      ...(malId ? { malId } : {}),
    },
  };
}

function mapAniListStatus(raw: string): TitleStatus | undefined {
  if (raw === "finished") return "released";
  if (raw === "releasing") return "airing";
  if (raw === "not_yet_released") return "upcoming";
  if (raw === "cancelled") return "released";
  return undefined;
}

// ---------------------------------------------------------------------------
// TMDB proxy + direct fallback
// ---------------------------------------------------------------------------

async function fetchJsonWithFallback(path: string, signal?: AbortSignal): Promise<unknown> {
  return fetchTmdbJsonCached(path, signal, FETCH_TIMEOUT_MS);
}

function appendEpisodeThumbnails(
  episodeThumbnailMap: Record<string, string>,
  seasonNum: number,
  seasonPayload: Record<string, unknown>,
): void {
  const episodes = Array.isArray(seasonPayload.episodes)
    ? seasonPayload.episodes.map(readRecord)
    : [];
  for (const ep of episodes) {
    const stillPath = readString(ep.still_path);
    const epNum = Number(ep.episode_number);
    const airDate = readString(ep.air_date);
    if (stillPath && epNum > 0 && isPlayableEpisode(airDate)) {
      episodeThumbnailMap[episodeThumbKey(seasonNum, epNum)] = tmdbImage(stillPath, "w300");
    }
  }
}

// ---------------------------------------------------------------------------
// ID extraction helpers
// ---------------------------------------------------------------------------

function extractTmdbId(id: string): string | null {
  const prefixed = /^tmdb:(\d+)$/.exec(id);
  if (prefixed?.[1]) return prefixed[1];
  // Bare numeric string treated as tmdb id
  if (/^\d+$/.test(id)) return id;
  return null;
}

function extractAnilistId(id: string): string | null {
  const match = /^anilist:(\d+)$/.exec(id);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
