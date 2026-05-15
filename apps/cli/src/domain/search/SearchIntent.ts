export type SearchIntentMode = "series" | "anime" | "movie" | "all";
export type WatchFilter = "any" | "unwatched" | "watching" | "completed";
export type ReleaseFilter = "today" | "this-week" | "upcoming";
export type SearchSort = "relevance" | "progress" | "recent";

export type SearchIntentFilters = {
  readonly provider?: string;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter;
  readonly year?: number | { readonly from?: number; readonly to?: number };
  readonly release?: ReleaseFilter;
};

export type SearchIntent = {
  readonly query: string;
  readonly mode: SearchIntentMode;
  readonly filters: SearchIntentFilters;
  readonly sort: SearchSort;
};

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

function normalizeFilters(filters: SearchIntentFilters): SearchIntentFilters {
  const year = filters.year;
  const normalizedYear = typeof year === "object" && year ? normalizeYearRange(year) : year;

  return {
    ...filters,
    ...(normalizedYear === undefined ? {} : { year: normalizedYear }),
  };
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
