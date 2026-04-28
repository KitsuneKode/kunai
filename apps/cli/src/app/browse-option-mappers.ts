import type { SearchResult } from "@/domain/types";
import type { BrowseShellOption } from "@/app-shell/types";

const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";

function toPosterUrl(posterPath: string | null): string | undefined {
  if (!posterPath) return undefined;
  if (/^https?:\/\//i.test(posterPath)) return posterPath;
  return `${TMDB_POSTER_BASE_URL}${posterPath}`;
}

function formatRating(rating: number | null | undefined): string | undefined {
  if (typeof rating !== "number" || rating <= 0) return undefined;
  return `${rating.toFixed(1)}/10 TMDB`;
}

export function toBrowseResultOption(result: SearchResult): BrowseShellOption<SearchResult> {
  const meta = [
    result.type === "series" ? "Series" : "Movie",
    result.year || undefined,
    result.episodeCount ? `${result.episodeCount} episodes` : undefined,
    formatRating(result.rating),
  ].filter((value): value is string => Boolean(value));
  const posterUrl = toPosterUrl(result.posterPath);

  return {
    value: result,
    label: result.year ? `${result.title} (${result.year})` : result.title,
    detail: `${result.type === "series" ? "Series" : "Movie"}${
      result.overview ? ` · ${result.overview}` : ""
    }`,
    previewTitle: result.title,
    previewMeta: meta,
    previewFacts: [
      {
        label: "Provider detail page",
        detail: result.overview ? "Overview available" : "Provider did not return overview text",
        tone: result.overview ? "success" : "warning",
      },
      {
        label: "Image source",
        detail: posterUrl ? "Poster URL available" : "No poster URL returned",
        tone: posterUrl ? "success" : "warning",
      },
      ...(typeof result.popularity === "number" && result.popularity > 0
        ? [
            {
              label: "Popularity",
              detail: result.popularity.toFixed(0),
              tone: "neutral" as const,
            },
          ]
        : []),
    ],
    previewImageUrl: posterUrl,
    previewRating: formatRating(result.rating),
    previewBody: result.overview || "No overview available yet.",
    previewNote:
      result.type === "series"
        ? "Press Enter to open this title and continue to episode selection. Use / details for the overview."
        : "Press Enter to open this title and continue to playback. Use / details for the overview.",
  };
}
