import type { ShellMode } from "@/domain/types";
import { isYoutubeCollectionCatalogId } from "@kunai/providers/youtube";

/**
 * Titles whose episodes come from provider.listEpisodes (anime hosts, YouTube
 * channels/playlists) — not TMDB season/episode metadata.
 */
export function usesProviderNativeEpisodeCatalog(mode: ShellMode, titleId: string): boolean {
  if (mode === "anime") return true;
  if (mode === "youtube" && isYoutubeCollectionCatalogId(titleId)) return true;
  return false;
}
