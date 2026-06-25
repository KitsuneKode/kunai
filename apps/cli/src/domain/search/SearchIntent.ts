export type SearchIntentMode = "series" | "anime" | "movie" | "youtube" | "all";
export type SearchIntentTypeFilter = "movie" | "series" | "all";
export type WatchFilter = "any" | "unwatched" | "watching" | "completed";
export type ReleaseFilter = "today" | "this-week" | "upcoming";
export type SearchSort = "relevance" | "progress" | "recent" | "popular" | "rating";

export type SearchIntentFilters = {
  readonly type?: SearchIntentTypeFilter;
  readonly genres?: readonly string[];
  readonly minRating?: number;
  readonly provider?: string;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter;
  readonly year?: number | { readonly from?: number; readonly to?: number };
  readonly release?: ReleaseFilter;
  readonly audio?: string;
  readonly subtitles?: string;
};

export type SearchIntent = {
  readonly query: string;
  readonly mode: SearchIntentMode;
  readonly filters: SearchIntentFilters;
  readonly sort: SearchSort;
};

export type FilterState = {
  readonly query: string;
  readonly mode?: SearchIntentMode;
  readonly type?: SearchIntentTypeFilter;
  readonly genres: readonly string[];
  readonly year?: SearchIntentFilters["year"];
  readonly minRating?: number;
  readonly watched?: WatchFilter;
  readonly downloaded?: boolean;
  readonly release?: ReleaseFilter;
  readonly audio?: string;
  readonly subtitles?: string;
  readonly provider?: string;
  readonly sort?: SearchSort;
};

export type FilterStateKey =
  | "mode"
  | "type"
  | "genres"
  | "year"
  | "minRating"
  | "watched"
  | "downloaded"
  | "release"
  | "audio"
  | "subtitles"
  | "provider"
  | "sort";

export function normalizeSearchIntent(input: {
  readonly query: string;
  readonly mode: SearchIntentMode;
  readonly filters?: SearchIntentFilters;
  readonly sort?: SearchSort;
}): SearchIntent {
  return {
    query: input.query.trim(),
    mode: input.mode,
    filters: normalizeFilters(input.filters ?? {}),
    sort: input.sort ?? "relevance",
  };
}

export function createEmptyFilterState(query = ""): FilterState {
  return {
    query: query.trim(),
    genres: [],
  };
}

export function normalizeFilterState(input: Partial<FilterState>): FilterState {
  const normalizedGenres = input.genres?.map((genre) => genre.trim()).filter(Boolean) ?? [];
  const normalizedFilters = normalizeFilters({
    type: input.type,
    genres: normalizedGenres,
    minRating: input.minRating,
    provider: input.provider,
    downloaded: input.downloaded,
    watched: input.watched,
    year: input.year,
    release: input.release,
    audio: input.audio,
    subtitles: input.subtitles,
  });

  return {
    query: input.query?.trim() ?? "",
    ...(input.mode ? { mode: input.mode } : {}),
    ...(normalizedFilters.type ? { type: normalizedFilters.type } : {}),
    genres: normalizedFilters.genres ?? [],
    ...(normalizedFilters.year ? { year: normalizedFilters.year } : {}),
    ...(typeof normalizedFilters.minRating === "number"
      ? { minRating: normalizedFilters.minRating }
      : {}),
    ...(normalizedFilters.watched ? { watched: normalizedFilters.watched } : {}),
    ...(typeof normalizedFilters.downloaded === "boolean"
      ? { downloaded: normalizedFilters.downloaded }
      : {}),
    ...(normalizedFilters.release ? { release: normalizedFilters.release } : {}),
    ...(normalizedFilters.audio ? { audio: normalizedFilters.audio } : {}),
    ...(normalizedFilters.subtitles ? { subtitles: normalizedFilters.subtitles } : {}),
    ...(normalizedFilters.provider ? { provider: normalizedFilters.provider } : {}),
    ...(input.sort ? { sort: input.sort } : {}),
  };
}

export function filterStateToSearchIntent(
  state: FilterState,
  fallbackMode: SearchIntentMode,
): SearchIntent {
  return normalizeSearchIntent({
    query: state.query,
    mode: state.mode ?? fallbackMode,
    filters: {
      type: state.type,
      genres: state.genres,
      minRating: state.minRating,
      provider: state.provider,
      downloaded: state.downloaded,
      watched: state.watched,
      year: state.year,
      release: state.release,
      audio: state.audio,
      subtitles: state.subtitles,
    },
    sort: state.sort,
  });
}

export function clearFilterStateKey(state: FilterState, key: FilterStateKey): FilterState {
  if (key === "genres") {
    return normalizeFilterState({ ...state, genres: [] });
  }
  const next = { ...state } as Partial<Record<FilterStateKey, unknown>> & Partial<FilterState>;
  delete next[key];
  return normalizeFilterState(next);
}

export function describeFilterStateChips(state: FilterState): readonly string[] {
  return [
    state.mode ? `mode ${state.mode}` : null,
    state.type && state.type !== "all" ? `type ${state.type}` : null,
    state.genres.length ? `genre ${state.genres.join(",")}` : null,
    state.year ? `year ${formatYear(state.year)}` : null,
    typeof state.minRating === "number" ? `rating >= ${state.minRating}` : null,
    typeof state.downloaded === "boolean" ? `downloaded ${state.downloaded}` : null,
    state.watched ? `watched ${state.watched}` : null,
    state.release ? `release ${state.release}` : null,
    state.audio ? `audio ${state.audio}` : null,
    state.subtitles ? `subtitles ${state.subtitles}` : null,
    state.provider ? `provider ${state.provider}` : null,
    state.sort && state.sort !== "relevance" ? `sort ${state.sort}` : null,
  ].filter((chip): chip is string => Boolean(chip));
}

function normalizeFilters(filters: SearchIntentFilters): SearchIntentFilters {
  const year = filters.year;
  const normalizedYear = typeof year === "object" && year ? normalizeYearRange(year) : year;
  const normalizedGenres = filters.genres?.map((genre) => genre.trim()).filter(Boolean);
  const normalizedMinRating =
    typeof filters.minRating === "number" && Number.isFinite(filters.minRating)
      ? Math.min(10, Math.max(0, filters.minRating))
      : undefined;
  const normalizedAudio = filters.audio?.trim().toLowerCase() || undefined;
  const normalizedSubtitles = filters.subtitles?.trim().toLowerCase() || undefined;

  return {
    ...filters,
    ...(normalizedGenres && normalizedGenres.length > 0 ? { genres: normalizedGenres } : {}),
    ...(normalizedMinRating === undefined ? {} : { minRating: normalizedMinRating }),
    ...(normalizedYear === undefined ? {} : { year: normalizedYear }),
    ...(normalizedAudio ? { audio: normalizedAudio } : {}),
    ...(normalizedSubtitles ? { subtitles: normalizedSubtitles } : {}),
  };
}

function formatYear(year: SearchIntentFilters["year"]): string {
  if (typeof year === "number") return String(year);
  if (!year) return "";
  if (typeof year.from === "number" && typeof year.to === "number") {
    return `${year.from}..${year.to}`;
  }
  return String(year.from ?? year.to ?? "");
}

function normalizeYearRange(range: { readonly from?: number; readonly to?: number }): {
  readonly from?: number;
  readonly to?: number;
} {
  if (typeof range.from === "number" && typeof range.to === "number") {
    return {
      from: Math.min(range.from, range.to),
      to: Math.max(range.from, range.to),
    };
  }
  return range;
}
