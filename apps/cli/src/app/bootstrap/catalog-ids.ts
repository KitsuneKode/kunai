import type { CatalogNs, ProviderExternalIds } from "@kunai/types";

/**
 * Namespace → `externalIds` mapping for catalog-anchored ids (`anilist:21`,
 * `tmdb:1396`, …). Shared by share-link resolution and `-i/--id` so both entry
 * points agree on which field a namespaced id feeds — one vocabulary, not two.
 */
export function catalogExternalIds(ns: CatalogNs, id: string): ProviderExternalIds {
  switch (ns) {
    case "youtube":
      return /^PL[\w-]+$/.test(id) ? { youtubePlaylistId: id } : { youtubeId: id };
    case "tmdb":
      return { tmdbId: id };
    case "anilist":
      return { anilistId: id };
    case "mal":
      return { malId: id };
    case "imdb":
      return { imdbId: id.startsWith("tt") ? id : `tt${id}` };
  }
}
