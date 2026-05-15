const VIDEASY_TMDB_URL = "https://db.videasy.net/3";
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
    return releaseAt <= formatDateKey(new Date(nowMs)) ? "released" : "upcoming";
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
};

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
  const data = await fetchJson(
    `${VIDEASY_TMDB_URL}/tv/${input.titleId}/season/${input.season}`,
    signal,
  );
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

async function loadTmdbAiringToday(
  _window: CatalogScheduleWindow,
  signal?: AbortSignal,
): Promise<readonly CatalogScheduleItem[]> {
  const data = await fetchJson(`${VIDEASY_TMDB_URL}/tv/airing_today?language=en-US&page=1`, signal);
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

async function postAniListGraphql<T>(
  body: { readonly query: string; readonly variables?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<T | null> {
  const response = await fetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(3500),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as T;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(3500) }).catch(
    () => null,
  );
  if (!response?.ok) return null;
  return response.json();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
