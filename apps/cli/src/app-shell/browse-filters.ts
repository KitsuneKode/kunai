import {
  matchesLibraryDownloadedFilter,
  matchesLibraryReleaseFilter,
  matchesLibraryWatchedFilter,
} from "@/app/search/browse-local-filter-facts";
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
  // A local filter can only narrow honestly when the loaded rows actually carry
  // the fact it needs. When none do, we skip that dimension and keep the rows
  // (the badge stays "unsupported") instead of silently emptying the list.
  const canApplyType = filters.type !== "all" && canApplyTypeFilterAtBrowse(options, filters.type);
  const canApplyDownloaded =
    typeof filters.downloaded === "boolean" &&
    options.some((option) => option.localFilterFacts?.downloaded !== undefined);
  const canApplyWatched =
    Boolean(filters.watched) &&
    options.some((option) => option.localFilterFacts?.watched !== undefined);
  const canApplyRelease =
    Boolean(filters.release) &&
    options.some((option) => option.localFilterFacts?.release !== undefined);

  return options.filter((option) => {
    if (canApplyType && !getOptionTypeFilterMatch(option, filters.type)) return false;
    if (filters.state.year !== undefined && !matchesOptionYear(option, filters.state.year)) {
      return false;
    }
    if (filters.provider && !matchesProviderFilter(option, filters.provider)) return false;
    if (
      canApplyDownloaded &&
      !matchesLibraryDownloadedFilter(option.localFilterFacts, filters.downloaded as boolean)
    ) {
      return false;
    }
    if (
      canApplyWatched &&
      !matchesLibraryWatchedFilter(option.localFilterFacts, filters.watched as WatchFilter)
    ) {
      return false;
    }
    if (
      canApplyRelease &&
      !matchesLibraryReleaseFilter(option.localFilterFacts, filters.release as ReleaseFilter)
    ) {
      return false;
    }
    if (typeof filters.minRating === "number") {
      const rating = parseOptionRating(option);
      if (rating === null || rating < filters.minRating) return false;
    }
    return true;
  });
}

function canApplyTypeFilterAtBrowse<T>(
  options: readonly BrowseShellOption<T>[],
  wanted: BrowseResultTypeFilter,
): boolean {
  if (wanted === "all") return true;
  if (wanted === "video" || wanted === "playlist" || wanted === "channel") {
    return options.some((option) => option.localFilterFacts?.contentShape !== undefined);
  }
  return options.some(
    (option) => option.localFilterFacts?.mediaType !== undefined || getLegacyPreviewType(option),
  );
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

const LIBRARY_FILTER_BADGE_KEYS = ["downloaded", "watched", "release"] as const;

type LibraryFilterBadgeKey = (typeof LIBRARY_FILTER_BADGE_KEYS)[number];

export type BrowseSearchFilterBadges = {
  readonly upstreamFilterBadges: readonly string[];
  readonly localFilterBadges: readonly string[];
  readonly unsupportedFilterBadges: readonly string[];
};

export type BrowseSearchPostProcessInput<T> = {
  readonly options: readonly BrowseShellOption<T>[];
  readonly upstreamFilterBadges?: readonly string[];
  readonly localFilterBadges?: readonly string[];
  readonly unsupportedFilterBadges?: readonly string[];
};

export function processBrowseSearchResults<T>(
  response: BrowseSearchPostProcessInput<T>,
  parsedQuery: ParsedBrowseFilterQuery,
): {
  readonly options: readonly BrowseShellOption<T>[];
} & BrowseSearchFilterBadges {
  const fallbackBadges = describeBrowseResultFilters(parsedQuery.filters);
  const filteredOptions = applyBrowseResultFilters(response.options, parsedQuery.filters);
  const reconciled = reconcileBrowseSearchFilterBadges(parsedQuery.filters, filteredOptions, {
    upstreamFilterBadges: response.upstreamFilterBadges ?? fallbackBadges,
    localFilterBadges: response.localFilterBadges ?? [],
    unsupportedFilterBadges: response.unsupportedFilterBadges ?? [],
  });
  return {
    options: filteredOptions,
    ...reconciled,
  };
}

export function reconcileBrowseSearchFilterBadges<T>(
  filters: BrowseResultFilters,
  options: readonly BrowseShellOption<T>[],
  badges: BrowseSearchFilterBadges,
): BrowseSearchFilterBadges {
  let local = [...badges.localFilterBadges];
  let unsupported = [...badges.unsupportedFilterBadges];
  const localKeys = new Set(local.map(filterBadgeKey));

  for (const key of LIBRARY_FILTER_BADGE_KEYS) {
    if (!canApplyLibraryFilterAtBrowse(key, filters, options)) continue;
    const promoted = unsupported.filter((badge) => filterBadgeKey(badge) === key);
    if (promoted.length === 0) continue;
    unsupported = unsupported.filter((badge) => filterBadgeKey(badge) !== key);
    for (const badge of promoted) {
      if (!localKeys.has(key)) {
        local.push(badge);
        localKeys.add(key);
      }
    }
  }

  return {
    upstreamFilterBadges: badges.upstreamFilterBadges,
    localFilterBadges: local,
    unsupportedFilterBadges: unsupported,
  };
}

function filterBadgeKey(badge: string): string {
  return badge.split(" ")[0] ?? badge;
}

function canApplyLibraryFilterAtBrowse<T>(
  key: LibraryFilterBadgeKey,
  filters: BrowseResultFilters,
  options: readonly BrowseShellOption<T>[],
): boolean {
  if (key === "downloaded") {
    if (typeof filters.downloaded !== "boolean") return false;
    return options.some((option) => option.localFilterFacts?.downloaded !== undefined);
  }
  if (key === "watched") {
    if (!filters.watched) return false;
    return options.some((option) => option.localFilterFacts?.watched !== undefined);
  }
  if (!filters.release) return false;
  return options.some((option) => option.localFilterFacts?.release !== undefined);
}

function getOptionTypeFilterMatch<T>(
  option: BrowseShellOption<T>,
  wanted: SearchIntentTypeFilter,
): boolean {
  if (wanted === "all") return true;
  const facts = option.localFilterFacts;
  if (wanted === "video" || wanted === "playlist" || wanted === "channel") {
    return facts?.contentShape === wanted;
  }
  if (wanted === "movie" || wanted === "series") {
    return (facts?.mediaType ?? getLegacyPreviewType(option)) === wanted;
  }
  return true;
}

function matchesOptionYear<T>(
  option: BrowseShellOption<T>,
  filter: NonNullable<FilterState["year"]>,
): boolean {
  const optionYear = getOptionYear(option);
  if (optionYear === null) return false;
  if (typeof filter === "number") return optionYear === filter;
  if (typeof filter.from === "number" && optionYear < filter.from) return false;
  if (typeof filter.to === "number" && optionYear > filter.to) return false;
  return true;
}

function getOptionYear<T>(option: BrowseShellOption<T>): number | null {
  const factYear = option.localFilterFacts?.year;
  if (typeof factYear === "number" && Number.isFinite(factYear)) return factYear;
  for (const meta of option.previewMeta ?? []) {
    if (/^\d{4}$/.test(meta)) return Number.parseInt(meta, 10);
  }
  return null;
}

function getLegacyPreviewType<T>(option: BrowseShellOption<T>): "movie" | "series" | undefined {
  const type = option.previewMeta?.find((value) => value === "Movie" || value === "Series");
  return type === "Movie" ? "movie" : type === "Series" ? "series" : undefined;
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
