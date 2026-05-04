import type { PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";

const ANISKIP_API = "https://api.aniskip.com/v1/skip-times";
const ARM_IDS_API = "https://arm.haglund.dev/api/v2/ids";
const ARM_TMDB_API = "https://arm.haglund.dev/api/v2/themoviedb";
/** Same catalog endpoint ani-skip / ani-cli use for `show { malId }` (opaque `_id` → MAL). */
const ALLANIME_MAL_LOOKUP_API = "https://api.allanime.day/api";
const ALLANIME_MAL_LOOKUP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

type AniSkipIntervalJson = {
  start_time?: number;
  end_time?: number;
  startTime?: number;
  endTime?: number;
};

type AniSkipResultJson = {
  interval?: AniSkipIntervalJson;
  skip_type?: string;
  skipType?: string;
  skip_id?: string;
  skipId?: string;
  episode_length?: number;
  episodeLength?: number;
};

type AniSkipResponse = {
  found: boolean;
  results: AniSkipResultJson[];
};

type ArmResponse = {
  myanimelist?: number | null;
  anilist?: number | null;
  [key: string]: unknown;
};

const malIdCache = new Map<string, number | null>();
const anilistIdByNameCache = new Map<string, string | null>();
const malIdFromAllAnimeShowCache = new Map<string, number | null>();

/**
 * Resolve MAL numeric id from an AllAnime / AllManga catalog `show._id`, matching
 * synacktraa/ani-skip `resolve_id_allanime`. Add other opaque-id catalogs here or
 * branch on `providerId` in `resolveMalIdForAniSkip` as new anime providers land.
 */
async function fetchMalIdFromAllAnimeShow(
  showId: string,
  signal?: AbortSignal,
): Promise<number | null> {
  if (malIdFromAllAnimeShowCache.has(showId)) return malIdFromAllAnimeShowCache.get(showId) ?? null;

  try {
    const query = "query ($id: String!) { show(_id: $id) { malId } }";
    const res = await fetch(ALLANIME_MAL_LOOKUP_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "User-Agent": ALLANIME_MAL_LOOKUP_UA,
      },
      body: JSON.stringify({ query, variables: { id: showId } }),
      signal: signal ?? AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      malIdFromAllAnimeShowCache.set(showId, null);
      return null;
    }
    const data = (await res.json()) as { data?: { show?: { malId?: string | number | null } } };
    const raw = data?.data?.show?.malId;
    const parsed =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.trunc(raw)
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : null;
    malIdFromAllAnimeShowCache.set(showId, parsed);
    return parsed;
  } catch {
    malIdFromAllAnimeShowCache.set(showId, null);
    return null;
  }
}

async function resolveMalIdForAniSkip(opts: {
  catalogTitleId: string;
  titleName?: string;
  titleYear?: string;
  /** `allanime` enables GraphQL `malId` lookup for opaque show ids (ani-skip `-s allanime`). */
  providerId?: string;
  signal?: AbortSignal;
}): Promise<number | null> {
  const { catalogTitleId, titleName, titleYear, providerId, signal } = opts;

  const seasonYear = (() => {
    const y = titleYear ? Number.parseInt(titleYear, 10) : Number.NaN;
    return Number.isFinite(y) ? y : undefined;
  })();

  if (providerId === "allanime" && catalogTitleId && !isNumericAniListId(catalogTitleId)) {
    const fromAllAnime = await fetchMalIdFromAllAnimeShow(catalogTitleId, signal);
    if (fromAllAnime != null) return fromAllAnime;
  }

  if (isNumericAniListId(catalogTitleId)) {
    return await resolveMALForSkipTiming({ catalogId: catalogTitleId, signal });
  }

  if (titleName) {
    const resolved = await resolveAniListIdByName(titleName, signal, seasonYear);
    if (!resolved) return null;
    return await resolveMALFromAniListId(resolved, signal);
  }

  return null;
}

// AniList IDs are purely numeric. AllAnime and other providers return non-numeric
// internal IDs (e.g. AllAnime uses base62 MongoDB ObjectIDs). Only a numeric string
// can be passed directly to arm.haglund.dev as an AniList source ID.
function isNumericAniListId(id: string): boolean {
  return /^\d+$/.test(id);
}

async function resolveAniListIdByName(
  name: string,
  signal: AbortSignal | undefined,
  seasonYear?: number,
): Promise<string | null> {
  const key = `${name.toLowerCase()}|y:${seasonYear ?? ""}`;
  if (anilistIdByNameCache.has(key)) return anilistIdByNameCache.get(key) ?? null;

  try {
    const query = seasonYear
      ? `query ($s: String, $y: Int) { Media(search: $s, type: ANIME, seasonYear: $y) { id } }`
      : `query ($s: String) { Media(search: $s, type: ANIME) { id } }`;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(
        seasonYear
          ? { query, variables: { s: name, y: seasonYear } }
          : { query, variables: { s: name } },
      ),
      signal: signal ?? AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      anilistIdByNameCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { data?: { Media?: { id?: number } } };
    const id = data?.data?.Media?.id;
    const result = typeof id === "number" ? String(id) : null;
    anilistIdByNameCache.set(key, result);
    return result;
  } catch {
    anilistIdByNameCache.set(key, null);
    return null;
  }
}

async function resolveMALFromAniListId(
  anilistId: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const cacheKey = `anilist:${anilistId}`;
  if (malIdCache.has(cacheKey)) return malIdCache.get(cacheKey) ?? null;

  try {
    const res = await fetch(`${ARM_IDS_API}?source=anilist&id=${encodeURIComponent(anilistId)}`, {
      signal: signal ?? AbortSignal.timeout(4_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      malIdCache.set(cacheKey, null);
      return null;
    }
    const data = (await res.json()) as ArmResponse;
    const malId = typeof data.myanimelist === "number" ? data.myanimelist : null;
    malIdCache.set(cacheKey, malId);
    return malId;
  } catch {
    malIdCache.set(cacheKey, null);
    return null;
  }
}

/** TMDB TV id → MAL (first mapping; split cours may list multiple MAL entries). */
async function resolveMALFromTheMovieDbId(
  tmdbId: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const cacheKey = `tmdb:${tmdbId}`;
  if (malIdCache.has(cacheKey)) return malIdCache.get(cacheKey) ?? null;

  try {
    const res = await fetch(
      `${ARM_TMDB_API}?id=${encodeURIComponent(tmdbId)}&include=myanimelist`,
      {
        signal: signal ?? AbortSignal.timeout(4_000),
        headers: { accept: "application/json" },
      },
    );
    if (!res.ok) {
      malIdCache.set(cacheKey, null);
      return null;
    }
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) {
      malIdCache.set(cacheKey, null);
      return null;
    }
    const first = rows[0] as { myanimelist?: number | null };
    const malId = typeof first.myanimelist === "number" ? first.myanimelist : null;
    malIdCache.set(cacheKey, malId);
    return malId;
  } catch {
    malIdCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Map a catalog id string to MAL for AniSkip. Numeric ids may be AniList or TMDB TV;
 * try AniList first, then TMDB (anime TMDB pages often map to several MAL cours).
 */
async function resolveMALForSkipTiming(opts: {
  catalogId: string;
  signal?: AbortSignal;
}): Promise<number | null> {
  const { catalogId, signal } = opts;
  if (!isNumericAniListId(catalogId)) return null;

  const fromAnilist = await resolveMALFromAniListId(catalogId, signal);
  if (fromAnilist) return fromAnilist;

  return await resolveMALFromTheMovieDbId(catalogId, signal);
}

function skipTypeToField(skipType: string): "intro" | "recap" | "credits" | "preview" | null {
  switch (skipType) {
    case "op":
    case "mixed-op":
      return "intro";
    case "ed":
    case "mixed-ed":
      return "credits";
    case "recap":
      return "recap";
    default:
      return null;
  }
}

function intervalToSegment(interval: AniSkipIntervalJson): PlaybackTimingSegment | null {
  const start =
    typeof interval.start_time === "number"
      ? interval.start_time
      : typeof interval.startTime === "number"
        ? interval.startTime
        : Number.NaN;
  const end =
    typeof interval.end_time === "number"
      ? interval.end_time
      : typeof interval.endTime === "number"
        ? interval.endTime
        : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    startMs: Math.round(start * 1000),
    endMs: Math.round(end * 1000),
  };
}

export async function fetchAniSkipTimingMetadata(opts: {
  anilistId: string;
  titleName?: string;
  /** Helps AniList `Media(search, seasonYear: …)` when the catalog id is not numeric. */
  titleYear?: string;
  episode: number;
  episodeLength?: number;
  signal?: AbortSignal;
  /** From `PlaybackTimingFetchContext` — drives AllAnime-native MAL resolution. */
  providerId?: string;
}): Promise<PlaybackTimingMetadata | null> {
  const { anilistId, titleName, titleYear, episode, episodeLength, signal, providerId } = opts;

  const malId = await resolveMalIdForAniSkip({
    catalogTitleId: anilistId,
    titleName,
    titleYear,
    providerId,
    signal,
  });
  if (!malId) return null;

  // api.aniskip.com only accepts `op` and `ed` (including `recap` returns HTTP 400 for the whole request).
  const types = ["op", "ed"] as const;
  const params = new URLSearchParams(types.map((t) => ["types", t] as [string, string]));
  if (episodeLength !== undefined) params.set("episode_length", String(episodeLength));

  try {
    const res = await fetch(`${ANISKIP_API}/${malId}/${episode}?${params.toString()}`, {
      signal: signal ?? AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as AniSkipResponse;
    if (!data.found || !data.results?.length) return null;

    const intro: PlaybackTimingSegment[] = [];
    const recap: PlaybackTimingSegment[] = [];
    const credits: PlaybackTimingSegment[] = [];
    const preview: PlaybackTimingSegment[] = [];

    for (const result of data.results) {
      const skipKind = result.skipType ?? result.skip_type ?? "";
      const field = skipTypeToField(skipKind);
      if (!field) continue;
      if (!result.interval) continue;
      const seg = intervalToSegment(result.interval);
      if (!seg) continue;
      if (field === "intro") intro.push(seg);
      else if (field === "recap") recap.push(seg);
      else if (field === "credits") credits.push(seg);
      else if (field === "preview") preview.push(seg);
    }

    if (!intro.length && !recap.length && !credits.length && !preview.length) return null;

    return {
      tmdbId: anilistId,
      type: "series",
      intro,
      recap,
      credits,
      preview,
    };
  } catch {
    return null;
  }
}
