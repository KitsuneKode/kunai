import { searchAllManga } from "@kunai/providers";
import type { SearchResult, ShellMode } from "../domain/types";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import { enrichAnimeSearchResultsWithAniList } from "./anime-metadata";

export type SearchRoutingContext = {
  mode: ShellMode;
  providerId: string;
  animeLanguageProfile: import("../services/persistence/ConfigService").MediaLanguageProfile;
  signal?: AbortSignal;
  searchRegistry: Pick<SearchRegistry, "getDefault" | "getForProvider">;
  providerRegistry: ProviderRegistry;
  enrichAnimeMetadata?: boolean;
};

export type SearchRoutingResult = {
  results: SearchResult[];
  sourceId: string;
  sourceName: string;
  strategy: "provider-native" | "registry";
};

const ALLMANGA_API_URL = "https://api.allanime.day/api";
const ALLMANGA_REFERER = "https://allmanga.to";
const ALLMANGA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export async function searchTitles(
  query: string,
  context: SearchRoutingContext,
): Promise<SearchRoutingResult> {
  const provider = context.providerRegistry.get(context.providerId);

  if (provider && context.mode === "anime" && context.providerId === "allanime") {
    const animeLang =
      context.animeLanguageProfile.audio === "ja" ||
      context.animeLanguageProfile.audio === "original"
        ? "sub"
        : "dub";

    const providerResults = await searchAllManga(
      ALLMANGA_API_URL,
      ALLMANGA_REFERER,
      ALLMANGA_UA,
      query,
      animeLang as "sub" | "dub",
    );

    const results = providerResults.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      year: r.year ?? "",
      overview: "",
      posterPath: r.posterUrl ?? null,
      rating: null,
      popularity: null,
      episodeCount: r.epCount,
      availableAudioModes: r.availableAudioModes,
      subtitleAvailability: r.availableAudioModes?.includes("sub")
        ? ("hardsub" as const)
        : ("unknown" as const),
    }));

    const enriched =
      context.enrichAnimeMetadata === false
        ? results
        : await enrichAnimeSearchResultsWithAniList(query, results, context.signal);

    return {
      results: enriched,
      sourceId: provider.metadata.id,
      sourceName: provider.metadata.name,
      strategy: "provider-native",
    };
  }

  const searchService =
    context.searchRegistry.getForProvider(context.providerId) ??
    context.searchRegistry.getDefault();

  return {
    results: await searchService.search(query, context.signal),
    sourceId: searchService.metadata.id,
    sourceName: searchService.metadata.name,
    strategy: "registry",
  };
}

function normalizeProviderSearchResult(result: SearchResult): SearchResult {
  const candidate = result as SearchResult & {
    epCount?: number;
    year?: string;
    overview?: string;
    posterPath?: string | null;
  };

  return {
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    titleAliases: candidate.titleAliases,
    year: candidate.year ?? "",
    overview: candidate.overview ?? "",
    posterPath: candidate.posterPath ?? null,
    posterSource: candidate.posterSource,
    metadataSource: candidate.metadataSource,
    rating: candidate.rating ?? null,
    popularity: candidate.popularity ?? null,
    episodeCount: candidate.episodeCount ?? candidate.epCount,
  };
}
