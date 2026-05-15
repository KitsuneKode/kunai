import type {
  ReleaseFilter,
  SearchIntentFilters,
  SearchIntentMode,
  SearchIntentTypeFilter,
  SearchSort,
  WatchFilter,
} from "./SearchIntent";

export type SearchIntentParseError = {
  readonly key: string;
  readonly value: string;
  readonly reason: "unsupported-filter" | "unsupported-value";
};

export type ParsedSearchIntentText = {
  readonly query: string;
  readonly filters: SearchIntentFilters;
  readonly sort?: SearchSort;
  readonly mode?: SearchIntentMode;
  readonly errors: readonly SearchIntentParseError[];
};

const SEARCH_MODES = new Set<SearchIntentMode>(["anime", "series", "movie", "all"]);
const TYPE_FILTERS = new Set<SearchIntentTypeFilter>(["movie", "series", "all"]);
const WATCH_FILTERS = new Set<WatchFilter>(["any", "unwatched", "watching", "completed"]);
const RELEASE_FILTERS = new Set<ReleaseFilter>(["today", "this-week", "upcoming"]);
const SEARCH_SORTS = new Set<SearchSort>(["relevance", "progress", "recent", "popular", "rating"]);

export function parseSearchIntentText(text: string): ParsedSearchIntentText {
  const terms: string[] = [];
  const errors: SearchIntentParseError[] = [];
  const filters: {
    type?: SearchIntentTypeFilter;
    genres?: string[];
    minRating?: number;
    provider?: string;
    downloaded?: boolean;
    watched?: WatchFilter;
    year?: SearchIntentFilters["year"];
    release?: ReleaseFilter;
  } = {};
  let mode: SearchIntentMode | undefined;
  let sort: SearchSort | undefined;

  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const parsed = parseToken(token);
    if (!parsed) {
      terms.push(token);
      continue;
    }

    const { key, value } = parsed;
    if (key === "mode") {
      if (isSearchMode(value)) mode = value;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "type") {
      if (isTypeFilter(value)) filters.type = value;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "genre" || key === "genres") {
      const genres = parseGenreFilter(value);
      if (genres.length > 0) filters.genres = [...(filters.genres ?? []), ...genres];
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "rating" || key === "min") {
      const rating = parseRatingFilter(value);
      if (typeof rating === "number") filters.minRating = rating;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "provider") {
      filters.provider = value;
      continue;
    }
    if (key === "downloaded") {
      if (value === "true" || value === "false") filters.downloaded = value === "true";
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "watched") {
      if (isWatchFilter(value)) filters.watched = value;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "year") {
      const year = parseYearFilter(value);
      if (year) filters.year = year;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "release") {
      if (isReleaseFilter(value)) filters.release = value;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }
    if (key === "sort") {
      if (isSearchSort(value)) sort = value;
      else errors.push({ key, value, reason: "unsupported-value" });
      continue;
    }

    errors.push({ key, value, reason: "unsupported-filter" });
  }

  return {
    query: terms.join(" "),
    filters,
    sort,
    mode,
    errors,
  };
}

export function describeSearchIntentFilters(input: {
  readonly filters: SearchIntentFilters;
  readonly mode?: SearchIntentMode;
  readonly sort?: SearchSort;
  readonly errors?: readonly SearchIntentParseError[];
}): readonly string[] {
  const { filters } = input;
  const badges = [
    input.mode ? `mode ${input.mode}` : null,
    filters.type && filters.type !== "all" ? `type ${filters.type}` : null,
    filters.genres?.length ? `genre ${filters.genres.join(",")}` : null,
    typeof filters.minRating === "number" ? `rating >= ${filters.minRating}` : null,
    filters.provider ? `provider ${filters.provider}` : null,
    typeof filters.downloaded === "boolean" ? `downloaded ${filters.downloaded}` : null,
    filters.watched ? `watched ${filters.watched}` : null,
    filters.year ? `year ${formatYear(filters.year)}` : null,
    filters.release ? `release ${filters.release}` : null,
    input.sort && input.sort !== "relevance" ? `sort ${input.sort}` : null,
    input.errors?.length ? `${input.errors.length} ignored` : null,
  ];

  return badges.filter((badge): badge is string => Boolean(badge));
}

function parseToken(token: string): { readonly key: string; readonly value: string } | null {
  const separator = token.indexOf(":");
  if (separator <= 0) return null;
  const key = token.slice(0, separator).trim().toLowerCase();
  const value = token
    .slice(separator + 1)
    .trim()
    .toLowerCase();
  return key && value ? { key, value } : null;
}

function parseYearFilter(
  value: string,
): number | { readonly from?: number; readonly to?: number } | null {
  if (/^\d{4}$/.test(value)) return Number.parseInt(value, 10);

  const range = /^(\d{4})\.\.(\d{4})$/.exec(value);
  if (!range) return null;
  const from = Number.parseInt(range[1] ?? "", 10);
  const to = Number.parseInt(range[2] ?? "", 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

function parseGenreFilter(value: string): readonly string[] {
  return value
    .split(",")
    .map((genre) => genre.trim().toLowerCase())
    .filter(Boolean);
}

function parseRatingFilter(value: string): number | null {
  const rating = Number.parseFloat(value);
  if (!Number.isFinite(rating) || rating < 0) return null;
  return Math.min(10, Math.max(0, rating));
}

function formatYear(year: SearchIntentFilters["year"]): string {
  if (typeof year === "number") return String(year);
  if (!year) return "";
  if (typeof year.from === "number" && typeof year.to === "number") {
    return `${year.from}..${year.to}`;
  }
  return String(year.from ?? year.to ?? "");
}

function isSearchMode(value: string): value is SearchIntentMode {
  return SEARCH_MODES.has(value as SearchIntentMode);
}

function isTypeFilter(value: string): value is SearchIntentTypeFilter {
  return TYPE_FILTERS.has(value as SearchIntentTypeFilter);
}

function isWatchFilter(value: string): value is WatchFilter {
  return WATCH_FILTERS.has(value as WatchFilter);
}

function isReleaseFilter(value: string): value is ReleaseFilter {
  return RELEASE_FILTERS.has(value as ReleaseFilter);
}

function isSearchSort(value: string): value is SearchSort {
  return SEARCH_SORTS.has(value as SearchSort);
}
