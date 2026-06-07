import type {
  FilterState,
  FilterStateKey,
  ReleaseFilter,
  SearchIntentMode,
  SearchSort,
  SearchIntentTypeFilter,
  WatchFilter,
} from "@/domain/search/SearchIntent";
import { clearFilterStateKey, describeFilterStateChips } from "@/domain/search/SearchIntent";
import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";

import type { BrowseShellOption } from "./types";

export type BrowseResultTypeFilter = SearchIntentTypeFilter;

export type BrowseResultFilters = {
  readonly state: FilterState;
  readonly type: BrowseResultTypeFilter;
  readonly genres?: readonly string[];
  readonly year?: string;
  readonly minRating?: number;
  readonly mode?: SearchIntentMode;
  readonly provider?: string;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter;
  readonly release?: ReleaseFilter;
  readonly sort?: SearchSort;
  readonly ignoredFilterCount?: number;
};

export type ParsedBrowseFilterQuery = {
  readonly searchQuery: string;
  readonly filters: BrowseResultFilters;
};

export function parseBrowseFilterQuery(query: string): ParsedBrowseFilterQuery {
  const parsedIntent = parseSearchIntentText(query);

  return {
    searchQuery: parsedIntent.query,
    filters: browseFiltersFromState(parsedIntent.filterState, parsedIntent.errors.length),
  };
}

function browseFiltersFromState(state: FilterState, ignoredFilterCount = 0): BrowseResultFilters {
  const type = state.type ?? "all";
  let year: string | undefined;
  if (typeof state.year === "number") {
    year = String(state.year);
  }
  return {
    state,
    type,
    ...(state.genres.length ? { genres: state.genres } : {}),
    ...(year ? { year } : {}),
    ...(typeof state.minRating === "number" ? { minRating: state.minRating } : {}),
    ...(state.mode ? { mode: state.mode } : {}),
    ...(state.provider ? { provider: state.provider } : {}),
    ...(typeof state.downloaded === "boolean" ? { downloaded: state.downloaded } : {}),
    ...(state.watched ? { watched: state.watched } : {}),
    ...(state.release ? { release: state.release } : {}),
    ...(state.sort ? { sort: state.sort } : {}),
    ...(ignoredFilterCount ? { ignoredFilterCount } : {}),
  };
}

export function applyBrowseResultFilters<T>(
  options: readonly BrowseShellOption<T>[],
  filters: BrowseResultFilters,
): readonly BrowseShellOption<T>[] {
  return options.filter((option) => {
    if (filters.type !== "all" && getOptionType(option) !== filters.type) return false;
    if (filters.year && !option.previewMeta?.includes(filters.year)) return false;
    if (filters.provider && !matchesProviderFilter(option, filters.provider)) return false;
    if (
      typeof filters.downloaded === "boolean" &&
      matchesDownloadedFilter(option) !== filters.downloaded
    ) {
      return false;
    }
    if (filters.watched && !matchesWatchedFilter(option, filters.watched)) return false;
    if (filters.release && !matchesReleaseFilter(option, filters.release)) return false;
    if (typeof filters.minRating === "number") {
      const rating = parseOptionRating(option);
      if (rating === null || rating < filters.minRating) return false;
    }
    return true;
  });
}

export function describeBrowseResultFilters(filters: BrowseResultFilters): readonly string[] {
  return [
    ...describeFilterStateChips(filters.state),
    filters.ignoredFilterCount ? `${filters.ignoredFilterCount} ignored` : null,
  ].filter((value): value is string => Boolean(value));
}

export function clearBrowseResultFilter(
  filters: BrowseResultFilters,
  key: FilterStateKey,
): BrowseResultFilters {
  return browseFiltersFromState(
    clearFilterStateKey(filters.state, key),
    filters.ignoredFilterCount,
  );
}

export function hasBrowseResultFilters(filters: BrowseResultFilters): boolean {
  return describeBrowseResultFilters(filters).length > 0;
}

function getOptionType<T>(option: BrowseShellOption<T>): BrowseResultTypeFilter {
  const type = option.previewMeta?.find((value) => value === "Movie" || value === "Series");
  return type === "Movie" ? "movie" : type === "Series" ? "series" : "all";
}

function parseOptionRating<T>(option: BrowseShellOption<T>): number | null {
  const rating = option.previewRating ?? option.previewMeta?.find((value) => value.includes("/10"));
  if (!rating) return null;
  const parsed = Number.parseFloat(rating);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesProviderFilter<T>(option: BrowseShellOption<T>, provider: string): boolean {
  return getOptionSearchText(option).includes(provider.trim().toLowerCase());
}

function matchesDownloadedFilter<T>(option: BrowseShellOption<T>): boolean {
  const text = getOptionSearchText(option);
  return (
    hasAny(text, ["downloaded", "offline ready", "offline downloaded", "local file"]) &&
    !hasAny(text, ["not downloaded", "no download"])
  );
}

function matchesWatchedFilter<T>(option: BrowseShellOption<T>, watched: WatchFilter): boolean {
  const text = getOptionSearchText(option);
  const completed = hasAny(text, ["watched", "completed", "finished"]);
  const watching = hasAny(text, ["continue", "resume", "started", "in progress"]);

  if (watched === "completed") return completed;
  if (watched === "watching") return watching;
  if (watched === "unwatched") return !completed && !watching;
  return completed || watching;
}

function matchesReleaseFilter<T>(option: BrowseShellOption<T>, release: ReleaseFilter): boolean {
  const text = getOptionSearchText(option);
  if (release === "today") {
    return hasAny(text, ["release today", "releasing today", "airing today"]);
  }
  if (release === "upcoming") {
    return hasAny(text, ["release upcoming", "upcoming", "coming soon"]);
  }
  if (release === "this-week") {
    return hasAny(text, ["release this week", "this week", "this-week"]);
  }
  return false;
}

function getOptionSearchText<T>(option: BrowseShellOption<T>): string {
  const facts: string[] = [];
  for (const fact of option.previewFacts ?? []) {
    if (fact.label) facts.push(fact.label);
    if (fact.detail) facts.push(fact.detail);
  }
  return [
    option.label,
    option.detail,
    option.previewTitle,
    option.previewBody,
    option.previewNote,
    option.previewRating,
    ...(option.previewMeta ?? []),
    ...facts,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function hasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}
