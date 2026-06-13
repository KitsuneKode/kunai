import { fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";
import {
  summarizeTmdbSeasonEpisodes as summarizeTmdbSeasonEpisodesImpl,
  type TmdbSeasonAiring,
} from "@/services/catalog/tmdb-release";
import type { ReleaseNewSeason } from "@kunai/types";

export type { TmdbSeasonAiring };
export const summarizeTmdbSeasonEpisodes = summarizeTmdbSeasonEpisodesImpl;
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const NEXT_RELEASE_TTL_MS = 2 * 60 * 60 * 1000;
const RELEASING_TODAY_TTL_MS = 30 * 60 * 1000;
const HISTORICAL_RELEASE_TTL_MS = 24 * 60 * 60 * 1000;
const RELEASE_SAFETY_WINDOW_MS = 15 * 60 * 1000;

export type CatalogScheduleSource = "tmdb" | "anilist";
export type CatalogScheduleType = "anime" | "series" | "movie";
export type CatalogReleasePrecision = "date" | "timestamp" | "unknown";
export type CatalogReleaseStatus = "released" | "upcoming" | "unknown";
export type CatalogScheduleMode = "anime" | "series";
export type CatalogScheduleFailureClass = "network" | "rate-limited" | "timeout" | "unavailable";

export class CatalogScheduleRequestError extends Error {
  constructor(
    readonly failureClass: CatalogScheduleFailureClass,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CatalogScheduleRequestError";
  }
}

export type CatalogScheduleItem = {
  readonly source: CatalogScheduleSource;
  readonly titleId: string;
  readonly titleName: string;
  readonly type: CatalogScheduleType;
  readonly posterPath?: string | null;
  readonly popularity?: number;
  readonly averageScore?: number;
  readonly season?: number;
  readonly episode?: number;
  readonly episodeTitle?: string;
  readonly releaseAt: string | null;
  readonly releasePrecision: CatalogReleasePrecision;
  readonly status: CatalogReleaseStatus;
};

export type CatalogScheduleInput = {
  readonly source: CatalogScheduleSource;
  readonly titleId: string;
  readonly titleName: string;
  readonly type: CatalogScheduleType;
  readonly season?: number;
  readonly episode?: number;
};

export type CatalogScheduleWindow = {
  readonly start: Date;
  readonly end: Date;
  readonly dateKey: string;
};

export type CatalogScheduleLoaders = {
  readonly nextRelease: (
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ) => Promise<CatalogScheduleItem | null>;
  readonly releasingToday: (
    mode: CatalogScheduleMode,
    window: CatalogScheduleWindow,
    signal?: AbortSignal,
  ) => Promise<readonly CatalogScheduleItem[]>;
  readonly movieWindow?: (
    window: CatalogScheduleWindow,
    signal?: AbortSignal,
  ) => Promise<readonly CatalogScheduleItem[]>;
  readonly seriesProgress?: (
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ) => Promise<CatalogSeriesReleaseProgress | null>;
  readonly animeProgress?: (
    titleIds: readonly string[],
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, CatalogSeriesReleaseProgress | null>>;
};

/**
 * A sequel cour/season detected via AniList SEQUEL relations. AniList models each
 * cour as a separate media id, so a finished season's history anchor can't see the
 * next cour by episode delta alone — this is surfaced as a DISTINCT signal (never
 * folded into a +N episode count, which would corrupt the cross-media numbering).
 */
export type CatalogSeriesReleaseProgress = {
  readonly latestAiredSeason?: number;
  readonly latestAiredEpisode?: number;
  readonly nextAiringSeason?: number;
  readonly nextAiringEpisode?: number;
  readonly nextAiringAt?: string;
  readonly latestKnownReleaseAt?: string;
  /** A newer cour/season exists (AniList SEQUEL or TMDB later season). Distinct from the episode delta. */
  readonly newSeason?: ReleaseNewSeason;
  readonly sourceFingerprint: string;
};

export type CatalogScheduleCacheStore = {
  readonly get: (
    key: string,
    now?: Date,
  ) => { readonly payloadJson: string; readonly expiresAt?: string } | undefined;
  readonly set: (
    key: string,
    payloadJson: string,
    options: {
      readonly expiresAt: string;
      readonly now?: string;
      readonly source?: string;
      readonly mode?: string;
    },
  ) => void;
};

type ScheduleCacheEntry<T> = {
  readonly expiresAt: number;
  readonly value: T;
};

export class CatalogScheduleService {
  private readonly cache = new Map<string, ScheduleCacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly loaders: CatalogScheduleLoaders = defaultCatalogScheduleLoaders,
    private readonly now: () => number = () => Date.now(),
    private readonly persistentCache?: CatalogScheduleCacheStore,
  ) {}

  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /**
   * Read the cached next-release for a title without triggering a network fetch.
   * Returns null if not cached. titleId may be prefixed ("anilist:12345") or raw ("12345").
   * `episode` on the returned item is the NEXT future episode; lastAiredEpisode = episode - 1.
   */
  peekNextRelease(source: "anilist", titleId: string): CatalogScheduleItem | null {
    const rawId = titleId.startsWith(`${source}:`) ? titleId.slice(source.length + 1) : titleId;
    const key = `next:${source}:anime:${rawId}:-:-`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as CatalogScheduleItem | null;
    const persisted = this.loadPersisted<CatalogScheduleItem | null>(key);
    if (persisted.found) return persisted.value;
    return null;
  }

  peekAnimeReleaseProgress(titleId: string): CatalogSeriesReleaseProgress | null {
    const rawId = titleId.startsWith("anilist:") ? titleId.slice("anilist:".length) : titleId;
    const key = `progress:anilist:anime:${rawId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now())
      return cached.value as CatalogSeriesReleaseProgress | null;
    const persisted = this.loadPersisted<CatalogSeriesReleaseProgress | null>(key);
    return persisted.found ? persisted.value : null;
  }

  async prefetchAnimeReleaseProgressForTitles(
    titleIds: readonly string[],
    signal: AbortSignal,
    refreshThresholdMs = NEXT_RELEASE_TTL_MS / 2,
  ): Promise<void> {
    const nowMs = this.now();
    const staleIds: string[] = [];
    for (const titleId of titleIds) {
      const rawId = titleId.startsWith("anilist:") ? titleId.slice("anilist:".length) : titleId;
      if (!Number.isFinite(Number(rawId))) continue;
      const key = `progress:anilist:anime:${rawId}`;
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > nowMs + refreshThresholdMs) continue;
      if (!cached) {
        const persisted = this.loadPersisted<CatalogSeriesReleaseProgress | null>(key);
        const hydrated = this.cache.get(key);
        if (persisted.found && hydrated && hydrated.expiresAt > nowMs + refreshThresholdMs) {
          continue;
        }
      }
      staleIds.push(rawId);
    }
    if (staleIds.length === 0 || signal.aborted) return;

    const uniqueIds = [...new Set(staleIds)].sort();
    const inflightKey = `progress-batch:anilist:${uniqueIds.join(",")}`;
    const active = this.inflight.get(inflightKey);
    if (active) {
      await active;
      return;
    }

    const task = (this.loaders.animeProgress ?? loadAniListReleaseProgressBatch)(
      uniqueIds,
      signal,
    ).then((progressById) => {
      for (const titleId of uniqueIds) {
        const key = `progress:anilist:anime:${titleId}`;
        const progress = progressById.get(titleId) ?? null;
        const expiresAt = nowMs + NEXT_RELEASE_TTL_MS;
        this.cache.set(key, { expiresAt, value: progress });
        this.persistentCache?.set(key, JSON.stringify(progress), {
          expiresAt: new Date(expiresAt).toISOString(),
          now: new Date(nowMs).toISOString(),
          source: "anilist",
        });
      }
      return undefined;
    });
    this.inflight.set(inflightKey, task);
    try {
      await task;
    } finally {
      this.inflight.delete(inflightKey);
    }
  }

  /**
   * Batch-prefetch next-release data for a set of titles in a single AniList request.
   * Only fetches titles whose cache entry is missing or older than refreshThresholdMs.
   * Silently ignores network failures — callers should not await this for correctness.
   */
  async prefetchNextReleaseForTitles(
    source: "anilist",
    titleIds: readonly string[],
    signal: AbortSignal,
    refreshThresholdMs = NEXT_RELEASE_TTL_MS / 2,
  ): Promise<void> {
    const nowMs = this.now();
    const staleIds: number[] = [];

    for (const titleId of titleIds) {
      const rawId = titleId.startsWith(`${source}:`) ? titleId.slice(source.length + 1) : titleId;
      const id = Number(rawId);
      if (!Number.isFinite(id)) continue;
      const key = `next:${source}:anime:${rawId}:-:-`;
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > nowMs + refreshThresholdMs) continue; // fresh enough
      if (!cached) {
        // try persistent before scheduling a fetch
        const persisted = this.loadPersisted<CatalogScheduleItem | null>(key);
        if (persisted.found) {
          const entry = this.cache.get(key);
          if (entry && entry.expiresAt > nowMs + refreshThresholdMs) continue;
        }
      }
      staleIds.push(id);
    }

    if (staleIds.length === 0 || signal.aborted) return;

    // One batch GraphQL call for all stale IDs
    type BatchResponse = {
      data?: {
        Page?: {
          media?: ReadonlyArray<{
            id?: number;
            title?: { romaji?: string | null; english?: string | null } | null;
            nextAiringEpisode?: { airingAt?: number | null; episode?: number | null } | null;
          } | null> | null;
        } | null;
      } | null;
    };

    const query = `
      query($ids: [Int]) {
        Page(perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            id title { romaji english }
            nextAiringEpisode { airingAt episode }
          }
        }
      }
    `;

    const data = await postAniListGraphql<BatchResponse>(
      { query, variables: { ids: staleIds } },
      signal,
    );
    const mediaList = data?.data?.Page?.media ?? [];

    for (const media of mediaList) {
      if (!media?.id) continue;
      const airing = media.nextAiringEpisode;
      const titleId = String(media.id);
      const key = `next:${source}:anime:${titleId}:-:-`;
      const item: CatalogScheduleItem | null = airing?.airingAt
        ? normalizeScheduleItem(
            {
              source,
              titleId,
              titleName: media.title?.english ?? media.title?.romaji ?? titleId,
              type: "anime",
              episode: airing.episode ?? undefined,
              releaseAt: new Date(airing.airingAt * 1000).toISOString(),
              releasePrecision: "timestamp",
              status: "unknown",
            },
            nowMs,
          )
        : null;
      const ttl = item
        ? ttlForScheduleValue(item, NEXT_RELEASE_TTL_MS, nowMs)
        : NEXT_RELEASE_TTL_MS;
      const expiresAt = nowMs + ttl;
      this.cache.set(key, { expiresAt, value: item });
      this.persistentCache?.set(key, JSON.stringify(item), {
        expiresAt: new Date(expiresAt).toISOString(),
        now: new Date(nowMs).toISOString(),
        source,
      });
    }
  }

  async getNextRelease(
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ): Promise<CatalogScheduleItem | null> {
    const key = `next:${input.source}:${input.type}:${input.titleId}:${input.season ?? "-"}:${input.episode ?? "-"}`;
    return this.loadCached(key, NEXT_RELEASE_TTL_MS, signal, { source: input.source }, async () => {
      const item = await this.loaders.nextRelease(input, signal);
      return item ? normalizeScheduleItem(item, this.now()) : null;
    });
  }

  async getSeriesReleaseProgress(
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ): Promise<CatalogSeriesReleaseProgress | null> {
    if (input.source !== "tmdb" || input.type !== "series" || !input.season) return null;
    const key = `progress:${input.source}:${input.type}:${input.titleId}:${input.season}`;
    return this.loadCached(key, NEXT_RELEASE_TTL_MS, signal, { source: input.source }, async () =>
      (this.loaders.seriesProgress ?? loadTmdbSeriesReleaseProgress)(input, signal),
    );
  }

  async loadReleasingToday(
    mode: CatalogScheduleMode,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    const window = buildLocalDayWindow(this.now());
    const key = `today:${mode}:${window.dateKey}`;
    return this.loadCached(key, RELEASING_TODAY_TTL_MS, signal, { mode }, async () => {
      const items = await this.loaders.releasingToday(mode, window, signal);
      return items.map((item) => normalizeScheduleItem(item, this.now()));
    });
  }

  async loadReleaseWindow(
    mode: CatalogScheduleMode,
    days: number,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    const window = buildLocalWindow(this.now(), days);
    const key = `window:${mode}:${window.dateKey}:${Math.max(1, Math.trunc(days))}`;
    return this.loadCached(key, RELEASING_TODAY_TTL_MS, signal, { mode }, async () => {
      const items = await this.loaders.releasingToday(mode, window, signal);
      return items.map((item) => normalizeScheduleItem(item, this.now()));
    });
  }

  async loadMovieReleaseWindow(
    days: number,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    const window = buildLocalWindow(this.now(), days);
    const key = `movie-window:${window.dateKey}:${Math.max(1, Math.trunc(days))}`;
    return this.loadCached(key, RELEASING_TODAY_TTL_MS, signal, { source: "tmdb" }, async () => {
      const load = this.loaders.movieWindow ?? loadTmdbMovieUpcoming;
      const items = await load(window, signal);
      return items.map((item) => normalizeScheduleItem(item, this.now()));
    });
  }

  private async loadCached<T>(
    key: string,
    ttlMs: number,
    _signal: AbortSignal | undefined,
    metadata: { readonly source?: string; readonly mode?: string },
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;

    const persisted = this.loadPersisted<T>(key);
    if (persisted.found) return persisted.value;

    const inflight = this.inflight.get(key);
    if (inflight) return (await inflight) as T;

    const task = load().then((value) => {
      const ttl = ttlForScheduleValue(value, ttlMs, this.now());
      const expiresAt = this.now() + ttl;
      this.cache.set(key, {
        expiresAt,
        value,
      });
      this.persistentCache?.set(key, JSON.stringify(value), {
        expiresAt: new Date(expiresAt).toISOString(),
        now: new Date(this.now()).toISOString(),
        ...metadata,
      });
      return value;
    });
    this.inflight.set(key, task);

    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }

  private loadPersisted<T>(key: string): { found: true; value: T } | { found: false } {
    const persisted = this.persistentCache?.get(key, new Date(this.now()));
    if (!persisted) return { found: false };
    try {
      const value = JSON.parse(persisted.payloadJson) as T;
      const expiresAt = persisted.expiresAt
        ? Date.parse(persisted.expiresAt)
        : this.now() + NEXT_RELEASE_TTL_MS;
      this.cache.set(key, {
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + NEXT_RELEASE_TTL_MS,
        value,
      });
      return { found: true, value };
    } catch {
      return { found: false };
    }
  }
}

export function createCatalogScheduleService(
  persistentCache?: CatalogScheduleCacheStore,
): CatalogScheduleService {
  return new CatalogScheduleService(
    defaultCatalogScheduleLoaders,
    () => Date.now(),
    persistentCache,
  );
}

export function normalizeScheduleItem(
  item: CatalogScheduleItem,
  nowMs: number,
): CatalogScheduleItem {
  return {
    ...item,
    status: classifyReleaseStatus(item.releaseAt, item.releasePrecision, nowMs),
  };
}

export function classifyReleaseStatus(
  releaseAt: string | null,
  precision: CatalogReleasePrecision,
  nowMs: number,
): CatalogReleaseStatus {
  if (!releaseAt || precision === "unknown") return "unknown";

  if (precision === "date") {
    // Date-only precision: we don't know the intraday air time, so an episode
    // dated *today* stays "upcoming" until the day ends (avoids a premature
    // "new episode" before it has actually aired). Only strictly-past dates are released.
    return releaseAt < formatDateKey(new Date(nowMs)) ? "released" : "upcoming";
  }

  const releaseMs = Date.parse(releaseAt);
  if (!Number.isFinite(releaseMs)) return "unknown";
  return releaseMs <= nowMs ? "released" : "upcoming";
}

export function buildLocalDayWindow(nowMs: number): CatalogScheduleWindow {
  return buildLocalWindow(nowMs, 1);
}

export function buildLocalWindow(nowMs: number, days: number): CatalogScheduleWindow {
  const now = new Date(nowMs);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + Math.max(1, Math.min(14, Math.trunc(days))));
  return {
    start,
    end,
    dateKey: formatDateKey(start),
  };
}

function ttlForScheduleValue<T>(value: T, fallbackTtlMs: number, nowMs: number): number {
  if (isScheduleItem(value) && value.status === "released") return HISTORICAL_RELEASE_TTL_MS;
  if (isScheduleItem(value) && value.status === "upcoming" && value.releaseAt) {
    const releaseMs = Date.parse(value.releaseAt);
    if (Number.isFinite(releaseMs) && releaseMs > nowMs) {
      return Math.max(60_000, releaseMs - nowMs + RELEASE_SAFETY_WINDOW_MS);
    }
  }
  return fallbackTtlMs;
}

function isScheduleItem(value: unknown): value is CatalogScheduleItem {
  return Boolean(value && typeof value === "object" && "status" in value && "releaseAt" in value);
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const defaultCatalogScheduleLoaders: CatalogScheduleLoaders = {
  nextRelease: async (input, signal) => {
    if (input.source === "anilist") return loadAniListNextRelease(input, signal);
    if (input.source === "tmdb" && input.type === "series") {
      return loadTmdbNextRelease(input, signal);
    }
    return null;
  },
  releasingToday: async (mode, window, signal) =>
    mode === "anime"
      ? loadAniListReleasingToday(window, signal)
      : loadTmdbAiringToday(window, signal),
  movieWindow: loadTmdbMovieUpcoming,
  seriesProgress: loadTmdbSeriesReleaseProgress,
  animeProgress: loadAniListReleaseProgressBatch,
};

async function loadAniListReleaseProgressBatch(
  titleIds: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, CatalogSeriesReleaseProgress | null>> {
  const ids = titleIds.map(Number).filter(Number.isFinite);
  if (ids.length === 0) return new Map();
  const query = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id episodes status nextAiringEpisode{airingAt episode} airingSchedule(notYetAired:false,perPage:1){nodes{airingAt episode}} relations{edges{relationType node{id type status episodes nextAiringEpisode{episode airingAt}}}}}}}`;
  const data = await postAniListGraphql<{
    readonly data?: {
      readonly Page?: {
        readonly media?: readonly {
          readonly id?: number;
          readonly episodes?: number | null;
          readonly status?: string | null;
          readonly nextAiringEpisode?: {
            readonly airingAt?: number | null;
            readonly episode?: number | null;
          } | null;
          readonly airingSchedule?: AniListAiringSchedule | null;
          readonly relations?: { readonly edges?: readonly AniListRelationEdge[] | null } | null;
        }[];
      } | null;
    };
  }>({ query, variables: { ids } }, signal);
  const progress = new Map<string, CatalogSeriesReleaseProgress | null>();
  for (const media of data?.data?.Page?.media ?? []) {
    if (!media?.id) continue;
    const titleId = String(media.id);
    const airing = media.nextAiringEpisode;
    const newSeason = extractAniListSequelSignal(media.relations?.edges);
    const sequelFingerprint = newSeason
      ? `:seq${newSeason.mediaId}:${newSeason.latestAiredEpisode ?? newSeason.nextAiringEpisode ?? "-"}`
      : "";
    if (typeof airing?.episode === "number" && airing.episode > 0) {
      const latestAiredEpisode = Math.max(0, airing.episode - 1);
      const latestKnownReleaseAt = latestKnownReleaseAtFromAniListSchedule(
        media.airingSchedule,
        latestAiredEpisode,
      );
      progress.set(titleId, {
        latestAiredEpisode,
        nextAiringEpisode: airing.episode,
        nextAiringAt: airing.airingAt ? new Date(airing.airingAt * 1000).toISOString() : undefined,
        latestKnownReleaseAt,
        newSeason,
        sourceFingerprint: `anilist:${titleId}:ongoing:${airing.episode}:${airing.airingAt ?? "-"}:${latestKnownReleaseAt ?? "-"}${sequelFingerprint}`,
      });
      continue;
    }
    if (media.status === "FINISHED" && typeof media.episodes === "number" && media.episodes > 0) {
      const latestKnownReleaseAt = latestKnownReleaseAtFromAniListSchedule(
        media.airingSchedule,
        media.episodes,
      );
      progress.set(titleId, {
        latestAiredEpisode: media.episodes,
        latestKnownReleaseAt,
        newSeason,
        sourceFingerprint: `anilist:${titleId}:finished:${media.episodes}:${latestKnownReleaseAt ?? "-"}${sequelFingerprint}`,
      });
    } else {
      progress.set(titleId, null);
    }
  }
  return progress;
}

type AniListAiringSchedule = {
  readonly nodes?:
    | readonly {
        readonly airingAt?: number | null;
        readonly episode?: number | null;
      }[]
    | null;
};

function latestKnownReleaseAtFromAniListSchedule(
  schedule: AniListAiringSchedule | null | undefined,
  latestAiredEpisode: number | undefined,
): string | undefined {
  if (typeof latestAiredEpisode !== "number" || latestAiredEpisode <= 0) return undefined;
  const node = schedule?.nodes?.find(
    (entry) =>
      entry?.episode === latestAiredEpisode &&
      typeof entry.airingAt === "number" &&
      entry.airingAt > 0,
  );
  return node?.airingAt ? new Date(node.airingAt * 1000).toISOString() : undefined;
}

type AniListRelationEdge = {
  readonly relationType?: string | null;
  readonly node?: {
    readonly id?: number | null;
    readonly type?: string | null;
    readonly status?: string | null;
    readonly episodes?: number | null;
    readonly nextAiringEpisode?: {
      readonly episode?: number | null;
      readonly airingAt?: number | null;
    } | null;
  } | null;
};

/**
 * Pick the immediate sequel cour from AniList relation edges: the first SEQUEL edge
 * to an ANIME node that is releasing, has aired episodes, or has a known next airing.
 * Pure — unit-tested without the network.
 */
export function extractAniListSequelSignal(
  edges: readonly AniListRelationEdge[] | null | undefined,
): ReleaseNewSeason | undefined {
  for (const edge of edges ?? []) {
    if (edge?.relationType !== "SEQUEL") continue;
    const node = edge.node;
    if (!node || typeof node.id !== "number" || node.type !== "ANIME") continue;
    const airing = node.nextAiringEpisode;
    const nextEpisode =
      typeof airing?.episode === "number" && airing.episode > 0 ? airing.episode : undefined;
    const latestAiredEpisode =
      nextEpisode !== undefined
        ? Math.max(0, nextEpisode - 1)
        : node.status === "FINISHED" && typeof node.episodes === "number" && node.episodes > 0
          ? node.episodes
          : undefined;
    const isReleasing = node.status === "RELEASING";
    if (!isReleasing && nextEpisode === undefined && (latestAiredEpisode ?? 0) <= 0) continue;
    return {
      mediaId: node.id,
      latestAiredEpisode,
      nextAiringEpisode: nextEpisode,
      nextAiringAt: airing?.airingAt ? new Date(airing.airingAt * 1000).toISOString() : undefined,
    };
  }
  return undefined;
}

async function loadAniListNextRelease(
  input: CatalogScheduleInput,
  signal?: AbortSignal,
): Promise<CatalogScheduleItem | null> {
  const id = Number(input.titleId);
  if (!Number.isFinite(id)) return null;

  const query = `query($id:Int){Media(id:$id,type:ANIME){id title{romaji english} nextAiringEpisode{airingAt episode}}}`;
  const data = await postAniListGraphql<{
    readonly data?: {
      readonly Media?: {
        readonly id?: number;
        readonly title?: {
          readonly romaji?: string | null;
          readonly english?: string | null;
        } | null;
        readonly nextAiringEpisode?: {
          readonly airingAt?: number | null;
          readonly episode?: number | null;
        } | null;
      } | null;
    };
  }>({ query, variables: { id } }, signal);
  const media = data?.data?.Media;
  const airing = media?.nextAiringEpisode;
  if (!airing?.airingAt) return null;

  return {
    source: "anilist",
    titleId: String(media?.id ?? input.titleId),
    titleName: media?.title?.english ?? media?.title?.romaji ?? input.titleName,
    type: "anime",
    episode: airing.episode ?? undefined,
    releaseAt: new Date(airing.airingAt * 1000).toISOString(),
    releasePrecision: "timestamp",
    status: "unknown",
  };
}

async function loadAniListReleasingToday(
  window: CatalogScheduleWindow,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const pages = await Promise.all(
    [1, 2, 3].map((page) => loadAniListAiringSchedulePage(window, page, signal)),
  );
  return dedupeScheduleItems(pages.flat()).slice(0, 100);
}

async function loadAniListAiringSchedulePage(
  window: CatalogScheduleWindow,
  page: number,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const query = `query($start:Int,$end:Int,$page:Int){Page(page:$page,perPage:50){airingSchedules(airingAt_greater:$start,airingAt_lesser:$end,sort:TIME){airingAt episode media{id title{romaji english} coverImage{extraLarge large} popularity averageScore}}}}`;
  const data = await postAniListGraphql<{
    readonly data?: {
      readonly Page?: {
        readonly airingSchedules?: readonly {
          readonly airingAt?: number | null;
          readonly episode?: number | null;
          readonly media?: {
            readonly id?: number;
            readonly title?: {
              readonly romaji?: string | null;
              readonly english?: string | null;
            } | null;
            readonly coverImage?: {
              readonly extraLarge?: string | null;
              readonly large?: string | null;
            } | null;
            readonly popularity?: number | null;
            readonly averageScore?: number | null;
          } | null;
        }[];
      } | null;
    };
  }>(
    {
      query,
      variables: {
        start: Math.floor(window.start.getTime() / 1000),
        end: Math.floor(window.end.getTime() / 1000),
        page,
      },
    },
    signal,
  );

  return (data?.data?.Page?.airingSchedules ?? []).flatMap((schedule) => {
    if (!schedule.airingAt || !schedule.media?.id) return [];
    return [
      {
        source: "anilist",
        titleId: String(schedule.media.id),
        titleName: schedule.media.title?.english ?? schedule.media.title?.romaji ?? "Unknown",
        type: "anime",
        posterPath:
          schedule.media.coverImage?.extraLarge ?? schedule.media.coverImage?.large ?? null,
        popularity: schedule.media.popularity ?? undefined,
        averageScore: schedule.media.averageScore ?? undefined,
        episode: schedule.episode ?? undefined,
        releaseAt: new Date(schedule.airingAt * 1000).toISOString(),
        releasePrecision: "timestamp",
        status: "unknown",
      } satisfies CatalogScheduleItem,
    ];
  });
}

function dedupeScheduleItems(
  items: readonly CatalogScheduleItem[],
): readonly CatalogScheduleItem[] {
  const seen = new Set<string>();
  const deduped: CatalogScheduleItem[] = [];
  for (const item of items) {
    const key = `${item.source}:${item.titleId}:${item.season ?? "-"}:${item.episode ?? "-"}:${item.releaseAt ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function loadTmdbNextRelease(
  input: CatalogScheduleInput,
  signal?: AbortSignal,
): Promise<CatalogScheduleItem | null> {
  if (!input.season || !input.episode) return null;
  const data = await fetchJson(`/tv/${input.titleId}/season/${input.season}`, signal);
  const episodePayload = readRecord(data).episodes;
  const episodes = Array.isArray(episodePayload) ? episodePayload.map(readRecord) : [];
  const episode = episodes.find((candidate) => Number(candidate.episode_number) === input.episode);
  if (!episode) return null;

  return {
    source: "tmdb",
    titleId: input.titleId,
    titleName: input.titleName,
    type: "series",
    season: input.season,
    episode: input.episode,
    episodeTitle: readString(episode.name) || undefined,
    releaseAt: readString(episode.air_date) || null,
    releasePrecision: readString(episode.air_date) ? "date" : "unknown",
    status: "unknown",
  };
}

async function loadTmdbSeriesReleaseProgress(
  input: CatalogScheduleInput,
  signal?: AbortSignal,
): Promise<CatalogSeriesReleaseProgress | null> {
  if (!input.season) return null;
  const data = await fetchJson(`/tv/${input.titleId}/season/${input.season}`, signal);
  const episodePayload = readRecord(data).episodes;
  const episodes = Array.isArray(episodePayload) ? episodePayload.map(readRecord) : [];
  const today = formatDateKey(new Date());
  const { aired, next } = summarizeTmdbSeasonEpisodes(episodes, today);
  if (!aired && !next) return null;

  // Cross-season detection: when this season looks complete (has aired, nothing
  // upcoming within it), probe the next season number so a caught-up viewer can be
  // told "new season" instead of a permanent "caught-up". Conditional => no overfetch.
  const newSeason =
    aired && !next
      ? await probeTmdbNextSeason(input.titleId, input.season + 1, today, signal)
      : undefined;

  return {
    latestAiredSeason: aired ? input.season : undefined,
    latestAiredEpisode: aired?.number,
    nextAiringSeason: next ? input.season : undefined,
    nextAiringEpisode: next?.number,
    nextAiringAt: next?.releaseAt,
    latestKnownReleaseAt: aired?.releaseAt,
    newSeason,
    sourceFingerprint: `tmdb:${input.titleId}:${input.season}:${aired?.number ?? "-"}:${next?.number ?? "-"}${
      newSeason
        ? `:s${newSeason.season}:${newSeason.latestAiredEpisode ?? newSeason.nextAiringEpisode ?? "-"}`
        : ""
    }`,
  };
}

/**
 * Probe a later TMDB season for any aired/upcoming episodes. Returns a season-based
 * ReleaseNewSeason, or undefined when the season doesn't exist (404) or has nothing.
 */
async function probeTmdbNextSeason(
  titleId: string,
  season: number,
  today: string,
  signal?: AbortSignal,
): Promise<ReleaseNewSeason | undefined> {
  try {
    const data = await fetchJson(`/tv/${titleId}/season/${season}`, signal);
    const episodePayload = readRecord(data).episodes;
    const episodes = Array.isArray(episodePayload) ? episodePayload.map(readRecord) : [];
    const { aired, next } = summarizeTmdbSeasonEpisodes(episodes, today);
    if (!aired && !next) return undefined;
    return {
      season,
      latestAiredEpisode: aired?.number,
      nextAiringEpisode: next?.number,
      nextAiringAt: next?.releaseAt,
    };
  } catch {
    return undefined;
  }
}

async function loadTmdbAiringToday(
  _window: CatalogScheduleWindow,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const data = await fetchJson(`/tv/airing_today?language=en-US&page=1`, signal);
  const resultPayload = readRecord(data).results;
  const results = Array.isArray(resultPayload) ? resultPayload.map(readRecord) : [];
  return results.slice(0, 25).flatMap((item) => {
    const id = item.id;
    if (id === null || id === undefined) return [];
    const titleName = readString(item.name) || readString(item.original_name) || "Unknown";
    return [
      {
        source: "tmdb",
        titleId: String(id),
        titleName,
        type: "series",
        posterPath: readString(item.poster_path) || readString(item.backdrop_path) || null,
        releaseAt: readString(item.first_air_date) || null,
        releasePrecision: readString(item.first_air_date) ? "date" : "unknown",
        status: "unknown",
      } satisfies CatalogScheduleItem,
    ];
  });
}

async function loadTmdbMovieUpcoming(
  window: CatalogScheduleWindow,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const data = await fetchJson(`/movie/upcoming?language=en-US&page=1`, signal);
  const resultPayload = readRecord(data).results;
  const results = Array.isArray(resultPayload) ? resultPayload.map(readRecord) : [];
  const startKey = formatWindowDateKey(window.start);
  const endKey = formatWindowDateKey(window.end);
  return results.flatMap((item) => {
    const id = item.id;
    if (id === null || id === undefined) return [];
    const releaseAt = readString(item.release_date) || null;
    // Keep only releases that fall inside the requested window (date-key compare).
    if (releaseAt && (releaseAt < startKey || releaseAt >= endKey)) return [];
    const titleName = readString(item.title) || readString(item.original_title) || "Unknown";
    return [
      {
        source: "tmdb",
        titleId: String(id),
        titleName,
        type: "movie",
        posterPath: readString(item.poster_path) || readString(item.backdrop_path) || null,
        popularity: typeof item.popularity === "number" ? item.popularity : undefined,
        releaseAt,
        releasePrecision: releaseAt ? "date" : "unknown",
        status: "unknown",
      } satisfies CatalogScheduleItem,
    ];
  });
}

function formatWindowDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function postAniListGraphql<T>(
  body: { readonly query: string; readonly variables?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(3500),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw catalogResponseError(response.status);
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeCatalogError(error);
  }
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await fetchTmdbJsonCached(path, signal, 3500);
  } catch (error) {
    throw normalizeCatalogError(error);
  }
}

function catalogResponseError(status: number): CatalogScheduleRequestError {
  if (status === 429)
    return new CatalogScheduleRequestError("rate-limited", "catalog rate limited", status);
  if (status === 408 || status === 504)
    return new CatalogScheduleRequestError("timeout", "catalog request timed out", status);
  return new CatalogScheduleRequestError("unavailable", "catalog unavailable", status);
}

function normalizeCatalogError(error: unknown): Error {
  if (error instanceof CatalogScheduleRequestError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
    return new CatalogScheduleRequestError("timeout", "catalog request timed out");
  }
  return new CatalogScheduleRequestError("network", "catalog network request failed");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
