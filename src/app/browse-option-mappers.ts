import type { SearchResult } from "@/domain/types";
import type { BrowseShellOption } from "@/app-shell/types";

export function toBrowseResultOption(result: SearchResult): BrowseShellOption<SearchResult> {
  const meta = [
    result.type === "series" ? "Series" : "Movie",
    result.year || undefined,
    result.episodeCount ? `${result.episodeCount} episodes` : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    value: result,
    label: result.year ? `${result.title} (${result.year})` : result.title,
    detail: `${result.type === "series" ? "Series" : "Movie"}${
      result.overview ? ` · ${result.overview}` : ""
    }`,
    previewTitle: result.title,
    previewMeta: meta,
    previewBody: result.overview || "No overview available yet.",
    previewNote:
      result.type === "series"
        ? "Press Enter once for details, then Enter again to start episode selection."
        : "Press Enter once for details, then Enter again to open playback.",
  };
}
