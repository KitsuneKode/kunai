import { stripHtml } from "@/domain/catalog/strip-html";
import { anilistCatalogStructure } from "@/domain/media/anilist-format";
import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import {
  createCacheGenerationGate,
  type CacheGenerationToken,
} from "@/infra/concurrency/cache-generation";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { AniListRequestError, postAniListGraphql } from "@/services/catalog/anilist-client";
import { evictOverflowedEntries } from "@/services/catalog/bounded-cache";
import {
  recordFallbackCatalogAnswer,
  recordPrimaryCatalogAnswer,
  type CatalogAnswerSource,
} from "@/services/catalog/catalog-source-ledger";
import { loadJikanAnimeTrending } from "@/services/catalog/jikan-trending";
import { loadKitsuAnimeTrending } from "@/services/catalog/kitsu-trending";
import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import {
  loadYoutubeTrending,
  providerResultToSearchResult,
} from "@/services/youtube/YoutubeRecommendationService";
import {
  getYoutubeProviderConfig,
  invidiousSearch,
  mapInvidiousSearchItem,
} from "@kunai/providers/youtube";
import {
  isJsonObject,
  isJsonString,
  type JsonObject,
  type ProviderSearchResult,
} from "@kunai/types";
const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000;
const SURPRISE_CACHE_TTL_MS = 10 * 60 * 1000;
// Surprise keys embed a rolling 10-minute bucket, so a session that outlives
// its TTLs still accretes one dead key per bucket per mode forever. Cap it.
const MAX_DISCOVERY_CACHE_ENTRIES = 64;

type DiscoveryCacheEntry = {
  readonly expiresAt: number;
  readonly results: readonly SearchResult[];
};

/**
 * Raised when a discovery source could not be read — offline, upstream error,
 * malformed payload, or an aborted request.
 *
 * A loader must reject rather than fold a failure into `[]`: the service caches
 * a resolved list for the whole TTL, so `[]`-on-failure poisons trending for
 * half an hour and the only way out is `clearTrendingCache()`. Rejecting keeps
 * "the upstream is down" distinct from "the provider genuinely has nothing",
 * and only the second is worth caching.
 */
export class DiscoveryUnavailableError extends Error {
  constructor(source: string, reason: string, options?: { readonly cause?: unknown }) {
    super(`${source} discovery is unavailable: ${reason}`, options);
    this.name = "DiscoveryUnavailableError";
  }
}

export type CatalogDiscoveryLoader = (signal?: AbortSignal) => Promise<readonly SearchResult[]>;
export type CatalogSurpriseLoader = (
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
) => Promise<readonly SearchResult[]>;

export type CatalogSurpriseLoadOptions = {
  readonly random: () => number;
};

export type CatalogDiscoveryLoaders = {
  readonly anime: CatalogDiscoveryLoader;
  readonly tmdb: CatalogDiscoveryLoader;
  readonly youtube?: CatalogDiscoveryLoader;
  readonly animeSurprise?: CatalogSurpriseLoader;
  readonly tmdbSurprise?: CatalogSurpriseLoader;
  readonly youtubeSurprise?: CatalogSurpriseLoader;
};

/**
 * One catalog source for a lane's trending list. Sources are tried in order;
 * the first that answers with a non-empty list wins.
 */
export type CatalogTrendingSource = {
  readonly id: string;
  readonly load: CatalogDiscoveryLoader;
};

/**
 * Durable last-known-good store for trending lists, so an outage or a cold
 * start shows the last answer (with its age) instead of an empty rail.
 */
export type CatalogDurableCache = {
  read(key: string): CatalogDurableEntry | null;
  write(key: string, cachedAt: number, results: readonly SearchResult[], sourceId?: string): void;
};

/** A saved trending list, with the source that produced it when known. */
export type CatalogDurableEntry = {
  readonly cachedAt: number;
  readonly results: readonly SearchResult[];
  readonly sourceId?: string;
};

/** A trending list plus where it came from and, when stale, how old it is. */
export type CatalogTrendingSection = {
  readonly results: readonly SearchResult[];
  readonly sourceId: string;
  /** Epoch ms the list was fetched; set only when every live source failed. */
  readonly staleSince?: number;
};

/**
 * With a last-known-good list on hand, a live chain slower than this hands the
 * caller that list instead (the walk continues and fills the cache). A cold
 * start during an outage otherwise waits out every source's timeout.
 */
const TRENDING_HEDGE_AFTER_MS = 1_200;

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export type CatalogDiscoveryOptions = {
  /** Hedge delay before serving last-known-good; tests pass 0 or -1 (never). */
  readonly hedgeAfterMs?: number;
  /** Extra sources tried after the lane's primary loader, per mode. */
  readonly fallbacks?: Partial<Record<ShellMode, readonly CatalogTrendingSource[]>>;
  /** Resolved on each call so the container can install it after construction. */
  readonly durableCache?: () => CatalogDurableCache | null;
};

/** How long a served stale list is reused before the live chain is retried. */
const STALE_RETRY_AFTER_MS = 60 * 1000;
/** A saved primary list younger than this is preferred over a live fallback. */
const PREFER_SAVED_PRIMARY_MS = 24 * 60 * 60 * 1000;
/** How long a failed fallback source is skipped. */
const FALLBACK_BREAKER_MS = 10 * 60 * 1000;

let defaultDurableCache: CatalogDurableCache | null = null;

/** Installed by the container once the cache database is open. */
export function setDefaultCatalogDurableCache(cache: CatalogDurableCache | null): void {
  defaultDurableCache = cache;
}

/** What the user is shown for a trending source id. */
function trendingSourceName(sourceId: string): string {
  switch (sourceId) {
    case "anilist":
      return "AniList";
    case "tmdb":
      return "TMDB";
    case "kitsu":
      return "Kitsu";
    case "jikan":
      return "MyAnimeList (Jikan)";
    case "last-known-good":
      return "saved list";
    default:
      return sourceId;
  }
}

/** Tell /diagnostics which trending source answered and whether it was a stand-in. */
function recordTrendingAnswer(mode: ShellMode, section: CatalogTrendingSection): void {
  if (mode === "youtube" || section.results.length === 0) return;
  const primaryId = mode === "anime" ? "anilist" : "tmdb";
  const source = {
    capability: "trending",
    lane: mode === "anime" ? "anime" : "movie-series",
    sourceId: section.sourceId,
    sourceName: trendingSourceName(section.sourceId),
  } satisfies CatalogAnswerSource;
  if (section.sourceId === primaryId) {
    recordPrimaryCatalogAnswer(source);
    return;
  }
  recordFallbackCatalogAnswer(source, `${trendingSourceName(primaryId)} unavailable`);
}

export const DEFAULT_TRENDING_FALLBACKS = {
  // Kitsu first: one request with AniList ids included. Jikan needs an ARM
  // lookup per entry and is IPv6-only from some networks.
  anime: [
    { id: "kitsu", load: (signal) => loadKitsuAnimeTrending(signal) },
    { id: "jikan", load: (signal) => loadJikanAnimeTrending(signal) },
  ],
} satisfies Partial<Record<ShellMode, readonly CatalogTrendingSource[]>>;

export class CatalogDiscoveryService {
  private readonly cache = new Map<string, DiscoveryCacheEntry>();
  private readonly sections = new Map<string, CatalogTrendingSection>();
  /**
   * Concurrent callers share one walk of a lane's whole chain. The walk owns
   * its own signal: one caller cancelling must not cancel another caller's
   * fallback, and the walk stops only when its last waiter has gone.
   */
  private readonly sectionWalks = createKeyedJoiner<CatalogTrendingSection>();
  /** Fallback source id → epoch ms until which it is skipped after failing. */
  private readonly fallbackBrokenUntil = new Map<string, number>();
  /** Bumped by `clearTrendingCache`; a walk started earlier may not commit. */
  private readonly generation = createCacheGenerationGate();
  /** One surprise load per lane and time bucket, aborted once nobody waits. */
  private readonly surpriseLoads = createKeyedJoiner<readonly SearchResult[]>();

  constructor(
    private readonly loaders: CatalogDiscoveryLoaders = {
      anime: loadAnimeDiscoveryList,
      tmdb: loadTmdbDiscoveryList,
      animeSurprise: loadAnimeSurpriseList,
      tmdbSurprise: loadTmdbSurpriseList,
    },
    private readonly now: () => number = () => Date.now(),
    private readonly options: CatalogDiscoveryOptions = {},
  ) {}

  clearTrendingCache(): void {
    this.cache.clear();
    this.surpriseLoads.clear();
    this.sections.clear();
    // A cleared walk could never commit (the generation moves on), so stop
    // its requests instead of letting them run to completion for nothing.
    this.sectionWalks.clear();
    this.generation.invalidate();
  }

  async loadTrending(mode: ShellMode, signal?: AbortSignal): Promise<SearchResult[]> {
    const section = await this.loadTrendingSection(mode, signal);
    return [...section.results];
  }

  /**
   * Trending for a lane: fresh memory cache → the lane's sources in order →
   * the durable last-known-good list (marked stale) → reject.
   *
   * A source that rejects or answers empty hands over to the next one. A
   * caller abort stops the walk at once: navigating away is not an outage and
   * must not burn the fallbacks or serve a stale list to nobody.
   */
  async loadTrendingSection(
    mode: ShellMode,
    signal?: AbortSignal,
  ): Promise<CatalogTrendingSection> {
    const key = mode;
    const cached = this.cache.get(key);
    const cachedSection = this.sections.get(key);
    if (cached && cached.expiresAt > this.now() && cachedSection) {
      // A cached answer is still the current answer: a walk that finished in
      // the background after a hedged stale reply must replace that record.
      recordTrendingAnswer(mode, cachedSection);
      return cachedSection;
    }
    if (signal?.aborted) throw abortReason(signal);

    const durable = this.durable();
    const stale = durable?.read(this.durableKey(mode)) ?? null;
    const section = await this.awaitWalk(mode, signal, stale);
    recordTrendingAnswer(mode, section);
    return section;
  }

  /**
   * One caller's wait on the lane's shared walk. With a last-known-good list
   * on hand, a slow live chain hands the caller that list after `hedgeAfterMs`
   * (marked stale) while the walk keeps going and fills the cache for the next
   * render.
   */
  private awaitWalk(
    mode: ShellMode,
    signal: AbortSignal | undefined,
    stale: { readonly cachedAt: number; readonly results: readonly SearchResult[] } | null,
  ): Promise<CatalogTrendingSection> {
    const generation = this.generation.capture();
    // This caller's place in the walk. It follows the caller's signal until a
    // hedge answers the caller; from then on it holds the walk open, so the
    // walk keeps running for the cache even with no caller waiting.
    const seat = new AbortController();
    const follow = () => seat.abort(signal?.reason);
    signal?.addEventListener("abort", follow, { once: true });
    const unfollow = () => signal?.removeEventListener("abort", follow);
    const joined = this.sectionWalks.join(
      mode,
      (upstream) => this.walkTrendingChain(mode, upstream, generation),
      { signal: seat.signal },
    );
    const hedgeAfterMs = this.options.hedgeAfterMs ?? TRENDING_HEDGE_AFTER_MS;
    if (!stale || stale.results.length === 0 || hedgeAfterMs < 0) {
      return joined.finally(unfollow);
    }
    return new Promise<CatalogTrendingSection>((resolve, reject) => {
      const hedge = setTimeout(() => {
        unfollow();
        resolve({
          results: stale.results,
          sourceId: "last-known-good",
          staleSince: stale.cachedAt,
        });
      }, hedgeAfterMs);
      joined.then(
        (section) => {
          clearTimeout(hedge);
          unfollow();
          resolve(section);
          return undefined;
        },
        (error) => {
          clearTimeout(hedge);
          unfollow();
          reject(error);
          return undefined;
        },
      );
    });
  }

  private durable(): CatalogDurableCache | null {
    return this.options.durableCache ? this.options.durableCache() : defaultDurableCache;
  }

  private durableKey(mode: ShellMode): string {
    return `catalog:trending:${mode}`;
  }

  /** Commit a section only if no refresh happened since the walk started. */
  private commitSection(
    key: string,
    generation: CacheGenerationToken,
    section: CatalogTrendingSection,
    ttlMs: number,
  ): boolean {
    return this.generation.commitIfFresh(generation, {}, () => {
      this.cache.set(key, { expiresAt: this.now() + ttlMs, results: section.results });
      this.sections.set(key, section);
      evictOverflowedEntries(this.cache, MAX_DISCOVERY_CACHE_ENTRIES, this.now());
    });
  }

  private async walkTrendingChain(
    mode: ShellMode,
    signal: AbortSignal,
    generation: CacheGenerationToken,
  ): Promise<CatalogTrendingSection> {
    const key = mode;
    const primary: CatalogTrendingSource = {
      id: mode === "anime" ? "anilist" : mode === "youtube" ? "youtube" : "tmdb",
      load:
        mode === "anime"
          ? this.loaders.anime
          : mode === "youtube"
            ? (this.loaders.youtube ?? loadYoutubeDiscoveryList)
            : this.loaders.tmdb,
    };
    const chain = [primary, ...(this.options.fallbacks?.[mode] ?? [])];
    const durable = this.durable();
    const durableKey = this.durableKey(mode);

    let lastError: Error | null = null;
    for (const source of chain) {
      const isPrimary = source === primary;
      if (!isPrimary) {
        // A recent saved list from the primary beats a live fallback: the
        // fallbacks are stand-ins (Kitsu's "popular this season" overlapped
        // AniList trending on 4 of 12 titles), not equivalents.
        const saved = durable?.read(durableKey);
        if (
          saved &&
          saved.sourceId === primary.id &&
          saved.results.length > 0 &&
          this.now() - saved.cachedAt < PREFER_SAVED_PRIMARY_MS
        ) {
          const section: CatalogTrendingSection = {
            results: saved.results,
            sourceId: "last-known-good",
            staleSince: saved.cachedAt,
          };
          this.commitSection(key, generation, section, STALE_RETRY_AFTER_MS);
          return section;
        }
        // A fallback that just failed (Jikan blackholed on some networks)
        // is skipped for a while instead of costing its timeout every outage.
        if ((this.fallbackBrokenUntil.get(source.id) ?? 0) > this.now()) continue;
      }
      let results: readonly SearchResult[];
      try {
        results = await source.load(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (!isPrimary) this.fallbackBrokenUntil.set(source.id, this.now() + FALLBACK_BREAKER_MS);
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      // An abandoned walk (its last waiter left; no refresh, so the generation
      // did not move) may still settle — a source that ignores the signal, or
      // Jikan handing back a partial list after one id lookup was cancelled.
      // A returning caller has already started a fresh walk; this one must not
      // write over its answer, nor move on to a fallback for nobody.
      if (signal.aborted) throw abortReason(signal);
      if (results.length === 0) continue;
      const section: CatalogTrendingSection = { results, sourceId: source.id };
      // A fallback answer is reused only briefly so the primary is retried
      // soon; one primary timeout must not pin a stand-in for the full
      // trending TTL. The durable row is the same commit generation as memory:
      // a refresh while the source was in flight must not leak either write.
      const committed = this.commitSection(
        key,
        generation,
        section,
        isPrimary ? DISCOVERY_CACHE_TTL_MS : STALE_RETRY_AFTER_MS,
      );
      if (committed) durable?.write(durableKey, this.now(), results, source.id);
      if (!isPrimary) this.fallbackBrokenUntil.delete(source.id);
      return section;
    }

    const stale = durable?.read(durableKey);
    if (stale && stale.results.length > 0) {
      const section: CatalogTrendingSection = {
        results: stale.results,
        sourceId: "last-known-good",
        staleSince: stale.cachedAt,
      };
      // Short reuse window: retry the live chain soon, but do not hammer a
      // down upstream on every render.
      this.commitSection(key, generation, section, STALE_RETRY_AFTER_MS);
      return section;
    }
    if (lastError) throw lastError;
    return { results: [], sourceId: primary.id };
  }

  async loadSurprise(
    mode: ShellMode,
    signal?: AbortSignal,
    options: CatalogSurpriseLoadOptions = { random: Math.random },
  ): Promise<SearchResult[]> {
    const bucket = Math.floor(this.now() / SURPRISE_CACHE_TTL_MS);
    const key = `surprise:${mode}:${bucket}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now())
      return shuffleResults(cached.results, options.random);

    const loader =
      mode === "anime"
        ? (this.loaders.animeSurprise ?? loadAnimeSurpriseList)
        : mode === "youtube"
          ? (this.loaders.youtubeSurprise ?? loadYoutubeSurpriseList)
          : (this.loaders.tmdbSurprise ?? loadTmdbSurpriseList);
    // Caches only a load that actually succeeded. A rejection — an offline
    // blip, an upstream error, or the `AbortError` from navigating away
    // mid-fetch — leaves the cache untouched and propagates, so the next call
    // retries instead of serving an empty tray for the rest of the TTL. An
    // empty list is not cached either: the loaders below reject on failure,
    // but an injected loader that still folds one into `[]` must not be able
    // to poison the cache. Concurrent callers share one load; each leaves on
    // its own signal, and the load is aborted once nobody waits.
    const results = await this.surpriseLoads.join(
      key,
      async (upstream) => {
        const loaded = await loader(options, upstream);
        if (!upstream.aborted && loaded.length > 0) {
          this.cache.set(key, { expiresAt: this.now() + SURPRISE_CACHE_TTL_MS, results: loaded });
          evictOverflowedEntries(this.cache, MAX_DISCOVERY_CACHE_ENTRIES, this.now());
        }
        return loaded;
      },
      { signal },
    );
    return shuffleResults(results, options.random);
  }
}

export function createCatalogDiscoveryService(
  loaders?: CatalogDiscoveryLoaders,
  options?: CatalogDiscoveryOptions,
): CatalogDiscoveryService {
  // Injected loaders (tests) get no implicit network fallbacks.
  return new CatalogDiscoveryService(
    loaders,
    undefined,
    options ?? (loaders ? {} : { fallbacks: DEFAULT_TRENDING_FALLBACKS }),
  );
}

async function loadYoutubeDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const results = await loadYoutubeTrending(signal);
  return [...results].slice(0, 12);
}

/**
 * Broad-interest queries the surprise spinner draws from. Trending alone made
 * `/surprise` echo `/trending` — a random query through Invidious search gives
 * the tray a genuinely different pool on each cache bucket.
 */
const YOUTUBE_SURPRISE_QUERIES = [
  "documentary",
  "science explained",
  "history deep dive",
  "cooking",
  "nature",
  "space",
  "engineering",
  "travel",
  "music production",
  "interview",
] as const;

async function loadYoutubeSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const query = pickRandom(YOUTUBE_SURPRISE_QUERIES, options.random) ?? "documentary";
  const preferredInstanceUrl = getYoutubeProviderConfig().invidiousInstanceUrl;
  try {
    const items = await invidiousSearch(query, { preferredInstanceUrl, signal });
    const videos = items
      .map((item) => mapInvidiousSearchItem(item))
      .filter((item): item is ProviderSearchResult => item !== null)
      .slice(0, 20)
      .map(providerResultToSearchResult);
    if (videos.length > 0) return videos;
  } catch (error) {
    // A caller abort is not a search miss — don't spend a trending fetch
    // on a signal that is already dead.
    if (signal?.aborted) throw error;
    // A search miss is not a tray-killer — trending still spins.
  }
  return loadYoutubeDiscoveryList(signal);
}

// SAFETY: fetchTmdbJsonCached resolves to JsonValue; the results array is shape-checked immediately below.
async function loadTmdbDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const data = (await fetchTmdbJsonCached(
    "/trending/all/week?language=en-US&page=1",
    signal,
    3500,
  ).catch((error: unknown) => {
    throw new DiscoveryUnavailableError("TMDB trending", "request failed", { cause: error });
  })) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.results)) {
    throw new DiscoveryUnavailableError("TMDB trending", "malformed payload");
  }
  const rawResults = data.results;

  return rawResults
    .map(readRecord)
    .filter((record) => record.media_type === "movie" || record.media_type === "tv")
    .slice(0, 12)
    .map((record): SearchResult => {
      const type = record.media_type === "tv" ? "series" : "movie";
      return {
        id: String(record.id),
        type,
        title: readString(record.title) || readString(record.name) || "Unknown",
        year:
          (readString(record.release_date) || readString(record.first_air_date)).split("-")[0] ||
          "?",
        overview: readString(record.overview).slice(0, 240),
        posterPath: readString(record.poster_path) || null,
        posterSource: readString(record.poster_path) ? "TMDB" : undefined,
        metadataSource: "TMDB trending",
        rating: typeof record.vote_average === "number" ? record.vote_average : null,
        popularity: typeof record.popularity === "number" ? record.popularity : null,
      };
    });
}

async function loadTmdbSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const mediaType = options.random() < 0.45 ? "movie" : "tv";
  const sortOptions =
    mediaType === "movie"
      ? ["popularity.desc", "vote_average.desc", "revenue.desc", "primary_release_date.desc"]
      : ["popularity.desc", "vote_average.desc", "first_air_date.desc"];
  const sortBy = pickRandom(sortOptions, options.random) ?? "popularity.desc";
  const page = 1 + Math.floor(options.random() * 20);
  // SAFETY: fetchTmdbJsonCached resolves to JsonValue; the results array is shape-checked immediately below.
  const voteFloor = sortBy === "vote_average.desc" ? 150 : 50;
  const data = (await fetchTmdbJsonCached(
    `/discover/${mediaType}?language=en-US&page=${page}&sort_by=${sortBy}&vote_count.gte=${voteFloor}`,
    signal,
    3500,
  ).catch((error: unknown) => {
    throw new DiscoveryUnavailableError("TMDB surprise", "request failed", { cause: error });
  })) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.results)) {
    throw new DiscoveryUnavailableError("TMDB surprise", "malformed payload");
  }
  const rawResults = data.results;
  return rawResults
    .map(readRecord)
    .filter((record) => record.id !== null && record.id !== undefined)
    .slice(0, 20)
    .map((record): SearchResult => {
      const type = mediaType === "tv" ? "series" : "movie";
      const posterPath = readString(record.poster_path) || null;
      return {
        id: String(record.id),
        type,
        title: readString(record.title) || readString(record.name) || "Unknown",
        year:
          (readString(record.release_date) || readString(record.first_air_date)).split("-")[0] ||
          "?",
        overview: readString(record.overview).slice(0, 240),
        posterPath,
        posterSource: posterPath ? "TMDB" : undefined,
        metadataSource: `TMDB surprise · ${sortBy.replace(".desc", "")}`,
        rating: typeof record.vote_average === "number" ? record.vote_average : null,
        popularity: typeof record.popularity === "number" ? record.popularity : null,
      };
    });
}

const ANILIST_MEDIA_FIELDS = `
        id
        title{romaji english native}
        coverImage{extraLarge large}
        description(asHtml:false)
        episodes
        format
        duration
        averageScore
        popularity
        startDate{year}
        synonyms`;

async function loadAnimeDiscoveryList(signal?: AbortSignal): Promise<SearchResult[]> {
  const gqlQuery = `query{
    Page(page:1, perPage:12){
      media(type:ANIME, sort:TRENDING_DESC, status_not:NOT_YET_RELEASED){
${ANILIST_MEDIA_FIELDS}
      }
    }
  }`;

  const media = await fetchAniListMedia("AniList trending", { query: gqlQuery }, signal);
  return media.map(anilistMediaToSearchResult);
}

/**
 * Per-title anime recommendations — AniList's `Media.recommendations` edge
 * returns titles the community rated as similar, so post-play "more like
 * this" is anchored to what just finished instead of generic trending. A
 * failure or a title with no recommendations resolves to `[]` so callers can
 * fall back to the trending pool.
 */
export async function loadAnimeRecommendationsForMedia(
  anilistId: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!/^\d+$/.test(anilistId)) return [];
  const gqlQuery = `query($id:Int){
    Media(id:$id, type:ANIME){
      recommendations(sort:RATING_DESC, page:1, perPage:12){
        nodes{ mediaRecommendation{
${ANILIST_MEDIA_FIELDS}
        } }
      }
    }
  }`;

  const payload = await postAniList(
    "AniList recommendations",
    {
      query: gqlQuery,
      variables: { id: Number(anilistId) },
    },
    signal,
  );
  const nodes =
    (
      payload.data as
        | {
            Media?: {
              recommendations?: {
                nodes?: readonly {
                  mediaRecommendation?: AniListDiscoveryMedia | null;
                }[];
              };
            };
          }
        | undefined
    )?.Media?.recommendations?.nodes ?? [];

  return nodes
    .map((node) => node.mediaRecommendation)
    .filter((media): media is AniListDiscoveryMedia => Boolean(media?.id))
    .map((media) => ({
      ...anilistMediaToSearchResult(media),
      metadataSource: "AniList similar titles",
    }));
}

async function loadAnimeSurpriseList(
  options: CatalogSurpriseLoadOptions,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const sortOptions = ["TRENDING_DESC", "POPULARITY_DESC", "SCORE_DESC", "FAVOURITES_DESC"];
  const genreOptions = [
    "Action",
    "Adventure",
    "Comedy",
    "Drama",
    "Fantasy",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Supernatural",
    "Thriller",
  ];
  const sort = pickRandom(sortOptions, options.random) ?? "POPULARITY_DESC";
  const genre = pickRandom(genreOptions, options.random);
  const page = 1 + Math.floor(options.random() * 12);
  const gqlQuery = `query($page:Int,$sort:[MediaSort],$genre:String){
    Page(page:$page, perPage:20){
      media(type:ANIME, sort:$sort, genre:$genre, status_not:NOT_YET_RELEASED, isAdult:false){
        id
        title{romaji english native}
        coverImage{extraLarge large}
        description(asHtml:false)
        episodes
        format
        duration
        averageScore
        popularity
        startDate{year}
        synonyms
      }
    }
  }`;

  const media = await fetchAniListMedia(
    "AniList surprise",
    { query: gqlQuery, variables: { page, sort: [sort], ...(genre && { genre }) } },
    signal,
  );

  return media.map((entry) => ({
    ...anilistMediaToSearchResult(entry),
    metadataSource: `AniList surprise · ${genre ?? "mixed"} · ${sort.toLowerCase().replace("_desc", "")}`,
  }));
}

/**
 * Posts a GraphQL document to AniList and returns the parsed payload.
 *
 * Rejects with {@link DiscoveryUnavailableError} on every failure shape —
 * transport error, non-2xx, unparseable body, or a GraphQL error (AniList
 * answers those with HTTP 200 and no `data`). Callers own the shape of `data`.
 */
async function postAniList(
  source: string,
  body: JsonObject,
  signal?: AbortSignal,
): Promise<{ readonly data?: unknown }> {
  if (!isJsonString(body.query)) {
    throw new DiscoveryUnavailableError(source, "request carried no GraphQL query");
  }
  const variables = isJsonObject(body.variables) ? body.variables : undefined;
  try {
    // Shared client: rate-limit cooldown, in-flight dedupe and a bounded timeout.
    return await postAniListGraphql({ query: body.query, variables }, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    const reason =
      error instanceof AniListRequestError
        ? `${error.kind}${error.status === undefined ? "" : ` ${error.status}`}`
        : "request failed";
    throw new DiscoveryUnavailableError(source, reason, { cause: error });
  }
}

async function fetchAniListMedia(
  source: string,
  body: JsonObject,
  signal?: AbortSignal,
): Promise<readonly AniListDiscoveryMedia[]> {
  const payload = await postAniList(source, body, signal);
  // SAFETY: the data payload is a parsed JSON object narrowed to the AniList page shape.
  const media = (
    payload.data as
      | {
          readonly Page?: { readonly media?: readonly AniListDiscoveryMedia[] };
        }
      | undefined
  )?.Page?.media;
  if (!media) throw new DiscoveryUnavailableError(source, "response carried no media page");
  return media;
}

type AniListDiscoveryMedia = {
  readonly id: number;
  readonly title?: {
    readonly romaji?: string | null;
    readonly english?: string | null;
    readonly native?: string | null;
  } | null;
  readonly coverImage?: {
    readonly extraLarge?: string | null;
    readonly large?: string | null;
  } | null;
  readonly description?: string | null;
  readonly episodes?: number | null;
  readonly format?: string | null;
  readonly duration?: number | null;
  readonly averageScore?: number | null;
  readonly popularity?: number | null;
  readonly startDate?: { readonly year?: number | null } | null;
  readonly synonyms?: readonly string[] | null;
};

function anilistMediaToSearchResult(media: AniListDiscoveryMedia): SearchResult {
  const title = media.title?.english || media.title?.romaji || media.title?.native || "Unknown";
  const aliases = buildAniListAliases(title, media);
  const posterPath = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
  const structure = anilistCatalogStructure({
    format: media.format,
    episodes: media.episodes,
    durationMinutes: media.duration,
  });

  return {
    id: String(media.id),
    type: structure.type,
    title,
    titleAliases: aliases,
    year: media.startDate?.year ? String(media.startDate.year) : "",
    overview: stripHtml(media.description ?? "").slice(0, 240),
    posterPath,
    posterSource: posterPath ? "AniList" : undefined,
    metadataSource: "AniList trending",
    rating: typeof media.averageScore === "number" ? media.averageScore / 10 : null,
    popularity: media.popularity ?? null,
    episodeCount: structure.episodeCount,
    durationSeconds: structure.durationSeconds,
    isAnime: true,
    externalIds: { anilistId: String(media.id) },
  };
}

function buildAniListAliases(providerTitle: string, media: AniListDiscoveryMedia): TitleAlias[] {
  return [
    { kind: "provider", value: providerTitle },
    media.title?.english ? { kind: "english", value: media.title.english } : null,
    media.title?.romaji ? { kind: "romaji", value: media.title.romaji } : null,
    media.title?.native ? { kind: "native", value: media.title.native } : null,
    ...(media.synonyms ?? []).slice(0, 3).map((value): TitleAlias => ({ kind: "synonym", value })),
  ].filter((value): value is TitleAlias => Boolean(value?.value));
}

function readRecord(value: unknown): Record<string, unknown> {
  // SAFETY: the typeof + !Array.isArray guard narrows value to a plain object.
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickRandom<T>(values: readonly T[], random: () => number): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(random() * values.length)];
}

function shuffleResults(results: readonly SearchResult[], random: () => number): SearchResult[] {
  const shuffled = [...results];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (!current || !replacement) continue;
    shuffled[index] = replacement;
    shuffled[target] = current;
  }
  return shuffled;
}
