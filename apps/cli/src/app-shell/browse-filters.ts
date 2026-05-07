import type { BrowseShellOption } from "./types";

export type BrowseResultTypeFilter = "all" | "movie" | "series";

export type BrowseResultFilters = {
  readonly type: BrowseResultTypeFilter;
  readonly year?: string;
  readonly minRating?: number;
};

export type ParsedBrowseFilterQuery = {
  readonly searchQuery: string;
  readonly filters: BrowseResultFilters;
};

export function parseBrowseFilterQuery(query: string): ParsedBrowseFilterQuery {
  let type: BrowseResultTypeFilter = "all";
  let year: string | undefined;
  let minRating: number | undefined;
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

    terms.push(token);
  }

  return {
    searchQuery: terms.join(" "),
    filters: {
      type,
      ...(year ? { year } : {}),
      ...(typeof minRating === "number" ? { minRating } : {}),
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
  return [
    filters.type !== "all" ? `type ${filters.type}` : null,
    filters.year ? `year ${filters.year}` : null,
    typeof filters.minRating === "number" ? `rating >= ${filters.minRating}` : null,
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
