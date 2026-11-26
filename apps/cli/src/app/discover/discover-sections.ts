// Discover Sections Builder
//
// Single source of truth for the 3-section discover list composition.
// Used by both main.ts and PlaybackPhase.ts.

import { loadDiscoverySection } from "@/app/discover/discovery-lists";
import type { Container } from "@/container";
import { formatRelativeAge } from "@/domain/relative-age";
import { loadAnimeRecommendationsForMedia } from "@/services/catalog/CatalogDiscoveryService";
import {
  historyContentType,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

export type DiscoverSectionsOptions = {
  /** Skip history-heavy personalized section (faster surfaces like /random). */
  readonly light?: boolean;
  /** Network seams, defaulting to the live catalog loaders. */
  readonly loaders?: {
    readonly trending?: typeof loadDiscoverySection;
    readonly animeSimilar?: typeof loadAnimeRecommendationsForMedia;
  };
};

/**
 * Builds the full discover section list from history and TMDB/AniList.
 * Fetches in parallel; null sections (no history, no genres) are filtered out.
 */
export async function buildDiscoverSections(
  container: Pick<
    Container,
    "historyRepository" | "recommendationService" | "stateManager" | "providerRegistry"
  >,
  options: DiscoverSectionsOptions = {},
): Promise<readonly RecommendationSection[]> {
  const history = readLatestHistoryByTitle(container.historyRepository);
  const mode = container.stateManager.getState().mode;
  const animeProviders = new Set(
    container.providerRegistry
      .getAll()
      .filter((provider) => provider.metadata.isAnimeProvider)
      .map((provider) => provider.metadata.id),
  );

  const finishedNewestFirst = Object.entries(history)
    .filter(([, entry]) => entry.completed)
    .sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));
  const isAnimeEntry = (entry: HistoryByTitle[string]) =>
    animeProviders.has(entry?.providerId ?? "unknown");
  // Each lane anchors on its own newest finished title. A bare number is only a
  // TMDB id when the entry came from a series/movie provider; anime history
  // ids are AniList ids, which TMDB would read as an unrelated title. Finishing
  // an anime used to drop the series rail, and vice versa.
  const seriesRecent = finishedNewestFirst.find(
    ([titleId, entry]) => !isAnimeEntry(entry) && /^\d+$/.test(titleId),
  );
  const animeSeeds = finishedNewestFirst.filter(([, entry]) => isAnimeEntry(entry));
  const completedHistorySeeds = Object.entries(history)
    .filter(([, entry]) => entry.completed)
    .filter(([, entry]) =>
      mode === "anime"
        ? animeProviders.has(entry.providerId ?? "unknown")
        : !animeProviders.has(entry.providerId ?? "unknown"),
    )
    .map(([titleId, entry]) => ({
      titleId,
      title: entry.title,
      type: historyContentType(entry),
      watchedAt: entry.updatedAt,
    }));

  const similar = options.loaders?.animeSimilar ?? loadAnimeRecommendationsForMedia;
  const results = await Promise.all([
    options.light
      ? null
      : mode === "anime"
        ? animeSeeds[0]
          ? animeSimilarSection(
              similar,
              animeSeeds.slice(0, 1),
              history,
              `Because you watched ${animeSeeds[0][1].title}`,
            )
          : null
        : seriesRecent
          ? container.recommendationService
              .getForTitle(seriesRecent[0], historyContentType(seriesRecent[1]))
              .then((s) => ({ ...s, label: `Because you watched ${seriesRecent[1].title}` }))
          : null,
    (options.loaders?.trending ?? loadDiscoverySection)(mode)
      .catch(() => ({ results: [], staleSince: undefined }))
      .then((section): RecommendationSection => {
        const trending: RecommendationSection = {
          label: mode === "anime" ? "Anime trending this week" : "Trending this week",
          reason: "trending",
          items: section.results,
        };
        return section.staleSince === undefined
          ? trending
          : { ...trending, staleSince: section.staleSince };
      }),
    options.light || completedHistorySeeds.length === 0
      ? null
      : mode === "anime"
        ? // AniList ids are not TMDB ids, so anime's pattern rail comes from
          // AniList's similar-title edges for your last few finished titles.
          animeSimilarSection(similar, animeSeeds.slice(1, 4), history, "From your watch pattern")
        : container.recommendationService
            .getPersonalizedByHistory(completedHistorySeeds)
            .then((s) => ({ ...s, label: "From your watch pattern" })),
  ]);

  return results
    .filter((s): s is RecommendationSection => s !== null)
    .map((section) => withFreshnessLabel(section));
}

/**
 * A rail served from the last good answer says so: "Trending this week ·
 * updated 3h ago". Without it a stale list during an outage passes for live.
 */
export function withFreshnessLabel(
  section: RecommendationSection,
  now: number = Date.now(),
): RecommendationSection {
  if (section.staleSince === undefined) return section;
  const age = formatRelativeAge(section.staleSince, now);
  return age ? { ...section, label: `${section.label} · updated ${age}` } : section;
}

type HistoryByTitle = ReturnType<typeof readLatestHistoryByTitle>;

/**
 * AniList's community "similar titles" for each seed, merged and stripped of
 * anything already in your history. Anime Discover had only a generic
 * trending rail: both personal rails were TMDB-only (Neon features review #11).
 * A miss resolves to null, so the rail is simply absent.
 */
async function animeSimilarSection(
  load: typeof loadAnimeRecommendationsForMedia,
  seeds: readonly (readonly [string, HistoryByTitle[string]])[],
  history: HistoryByTitle,
  label: string,
): Promise<RecommendationSection | null> {
  const lists = await Promise.all(
    seeds.map(([titleId, entry]) => load(entry?.externalIds?.anilistId ?? titleId).catch(() => [])),
  );
  const seen = new Set(Object.keys(history));
  const items = lists.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return items.length > 0 ? { label, reason: "similar", items } : null;
}
