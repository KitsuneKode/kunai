import type { BrowseShellOption } from "@/app-shell/types";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { SearchResult } from "@/domain/types";

export function browseOptionFromMediaItem(
  item: MediaItemIdentity,
): BrowseShellOption<SearchResult> {
  const type = item.mediaKind === "movie" ? "movie" : "series";
  const episodeCode =
    item.season !== undefined && (item.episode !== undefined || item.absoluteEpisode !== undefined)
      ? `S${String(item.season).padStart(2, "0")}E${String(item.episode ?? item.absoluteEpisode).padStart(2, "0")}`
      : undefined;
  return {
    value: {
      id: item.titleId,
      type,
      title: item.title,
    } as SearchResult,
    label: item.title,
    detail: episodeCode,
  };
}
