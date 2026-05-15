import type {
  ReleaseFilter,
  SearchIntentMode,
  SearchSort,
  WatchFilter,
} from "@/domain/search/SearchIntent";
import {
  describeSearchIntentFilters,
  parseSearchIntentText,
} from "@/domain/search/SearchIntentParser";

import type { BrowseShellOption } from "./types";

export type BrowseResultTypeFilter = "all" | "movie" | "series";

export type BrowseResultFilters = {
  readonly type: BrowseResultTypeFilter;
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
  let type: BrowseResultTypeFilter = "all";
  let year: string | undefined;
  let minRating: number | undefined;
  const intentTokens: string[] = [];
  const terms: string[] = [];

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const [rawKey, rawValue] = token.split(":", 2);
    const key = rawKey?.toLowerCase();
    const value = rawValue?.toLowerCase();

    if (key === "type" && (value === "movie" || value === "series")) {
      type = value;
      continue;
    }
    if (key === "year" && value && /^\d{4}$/.test(value)) {
      year = value;
      continue;
    }
    if ((key === "rating" || key === "min") && value) {
      const rating = Number.parseFloat(value);
      if (Number.isFinite(rating) && rating > 0) {
        minRating = Math.min(10, Math.max(0, rating));
        continue;
      }
    }

    intentTokens.push(token);
  }

  const parsedIntent = parseSearchIntentText(intentTokens.join(" "));
  for (const token of parsedIntent.query.trim().split(/\s+/).filter(Boolean)) {
    terms.push(token);
  }

  if (typeof parsedIntent.filters.year === "number") {
    year = String(parsedIntent.filters.year);
  }

  return {
    searchQuery: terms.join(" "),
    filters: {
      type,
      ...(year ? { year } : {}),
      ...(typeof minRating === "number" ? { minRating } : {}),
      ...(parsedIntent.mode ? { mode: parsedIntent.mode } : {}),
      ...(parsedIntent.filters.provider ? { provider: parsedIntent.filters.provider } : {}),
      ...(typeof parsedIntent.filters.downloaded === "boolean"
        ? { downloaded: parsedIntent.filters.downloaded }
        : {}),
      ...(parsedIntent.filters.watched ? { watched: parsedIntent.filters.watched } : {}),
      ...(parsedIntent.filters.release ? { release: parsedIntent.filters.release } : {}),
      ...(parsedIntent.sort ? { sort: parsedIntent.sort } : {}),
      ...(parsedIntent.errors.length ? { ignoredFilterCount: parsedIntent.errors.length } : {}),
    },
  };
}

export function applyBrowseResultFilters<T>(
  options: readonly BrowseShellOption<T>[],
  filters: BrowseResultFilters,
): readonly BrowseShellOption<T>[] {
  return options.filter((option) => {
    if (filters.type !== "all" && getOptionType(option) !== filters.type) return false;
    if (filters.year && !option.previewMeta?.includes(filters.year)) return false;
    if (typeof filters.minRating === "number") {
      const rating = parseOptionRating(option);
      if (rating === null || rating < filters.minRating) return false;
    }
    return true;
  });
}

export function describeBrowseResultFilters(filters: BrowseResultFilters): readonly string[] {
  const intentBadges = describeSearchIntentFilters({
    mode: filters.mode,
    sort: filters.sort,
    filters: {
      provider: filters.provider,
      downloaded: filters.downloaded,
      watched: filters.watched,
      release: filters.release,
    },
  });

  return [
    filters.type !== "all" ? `type ${filters.type}` : null,
    filters.year ? `year ${filters.year}` : null,
    typeof filters.minRating === "number" ? `rating >= ${filters.minRating}` : null,
    ...intentBadges,
    filters.ignoredFilterCount ? `${filters.ignoredFilterCount} ignored` : null,
  ].filter((value): value is string => Boolean(value));
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
