import { resolveContentKind } from "@/domain/media/content-kind";
import type { SearchResult } from "@/domain/types";

import type { DetailsSheetSeed } from "./details-sheet.model";
import type { BrowseShellOption } from "./types";

/** Minimum loaded results before local narrow mode is worth its space. */
export const MIN_RESULTS_FOR_LOCAL_FILTER = 12;

/** Default rendered height of the companion poster on compact viewports; reserved so the slot never reflows. */
export const PREVIEW_POSTER_ROWS = 9;

export type PreviewPosterGeometry = {
  readonly rows: number;
  readonly cols: number;
};

/**
 * Compute the ideal preview poster dimensions (rows and cols) for the available viewport.
 * Standard portrait artwork has a 2:3 aspect ratio. In terminal character cells
 * (where each cell has 2 vertical pixels in half-block and a ~1:2 cell aspect ratio),
 * an image of R rows has a natural width of Math.round((R * 2) * (2 / 3)) columns.
 *
 * Sizing adapts to vertical space so high-resolution/fullscreen terminals
 * display a crisp, full-sized poster instead of a tiny 9-row mosaic, while
 * compact terminals stay at 9 rows to avoid pushing metadata off-screen.
 */
export function resolvePreviewPosterGeometry(
  viewportRows: number,
  previewWidth: number,
): PreviewPosterGeometry {
  let rows = PREVIEW_POSTER_ROWS;
  if (viewportRows >= 42) {
    rows = 16;
  } else if (viewportRows >= 34) {
    rows = 13;
  } else if (viewportRows >= 28) {
    rows = 11;
  }

  // 2:3 aspect ratio in half-block cells (or terminal cells):
  // Height in pixels is rows * 2. Width in pixels is (rows * 2) * (2/3).
  // Leave padding so it fits comfortably inside the preview rail.
  const naturalCols = Math.round(rows * 2 * (2 / 3));
  const maxAvailableCols = Math.max(14, previewWidth - 4);
  const cols = Math.max(14, Math.min(naturalCols, maxAvailableCols));

  return { rows, cols };
}

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
    contentKind: resolveContentKind(
      {
        type: value?.type === "movie" ? "movie" : "series",
        externalIds: value?.externalIds,
        isAnime: value?.isAnime,
      },
      "series",
    ),
    year: value?.year || undefined,
    score: typeof value?.rating === "number" && value.rating > 0 ? value.rating : undefined,
    posterUrl: option.previewImageUrl,
    synopsis: value?.overview || undefined,
    episodeCount: value?.episodeCount,
  };
}
