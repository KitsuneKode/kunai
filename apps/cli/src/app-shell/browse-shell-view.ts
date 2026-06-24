import type { SearchResult } from "@/domain/types";

import type { DetailsSheetSeed } from "./details-sheet.model";
import type { BrowseShellOption } from "./types";

/** Minimum loaded results before local narrow mode is worth its space. */
export const MIN_RESULTS_FOR_LOCAL_FILTER = 12;

/** Rendered height of the companion poster; reserved so the slot never reflows. */
export const PREVIEW_POSTER_ROWS = 9;

/**
 * Render an unknown error in a user-visible string. An `Error` with a message
 * gets its message; everything else gets `String(error)` so we never show
 * `[object Object]` to the user (the old `String(error)` call did that when
 * the caught value was a plain object).
 */
export function formatBrowseShellError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Seed for the rich details sheet, built from data the browse list ALREADY loaded
 * (the SearchResult): header + synopsis render with no network; the detail fetch
 * only gap-fills cast/seasons/trailer/links.
 */
export function buildBrowseDetailsSheetSeed<T>(option: BrowseShellOption<T>): DetailsSheetSeed {
  const value = option.value as unknown as Partial<SearchResult> | undefined;
  return {
    title: option.previewTitle ?? option.label,
    type: value?.type === "movie" ? "movie" : "series",
    year: value?.year || undefined,
    score: typeof value?.rating === "number" && value.rating > 0 ? value.rating : undefined,
    posterUrl: option.previewImageUrl,
    synopsis: value?.overview || undefined,
    episodeCount: value?.episodeCount,
  };
}
