import type { Container } from "@/container";
import type { SearchResult, TitleInfo } from "@/domain/types";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import {
  loadYoutubeRecommendations,
  loadYoutubeTrending,
} from "@/services/youtube/YoutubeRecommendationService";

import { buildDiscoverSections } from "./discover-sections";
import { clearDiscoveryListCache } from "./discovery-lists";

export type DiscoverResultBundle = {
  readonly results: readonly SearchResult[];
  readonly subtitle: string;
  readonly emptyMessage: string;
};

export async function loadDiscoverResults(
  container: Pick<
    Container,
    | "recommendationService"
    | "stateManager"
    | "historyRepository"
    | "providerRegistry"
    | "config"
    | "resultEnrichmentService"
  >,
  options?: { refresh?: boolean; light?: boolean },
): Promise<DiscoverResultBundle> {
  if (options?.refresh) {
    await container.recommendationService.clearCache();
    clearDiscoveryListCache();
  }
  const mode = container.stateManager.getState().mode;
  if (mode === "youtube") {
    return loadYoutubeDiscoverResults(container, options);
  }

  const sections = await buildDiscoverSections(container, { light: options?.light });
  const discoverMode = container.config.discoverMode;
  const itemLimit = Math.max(6, Math.min(80, container.config.discoverItemLimit || 24));
  const flatten: SearchResult[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    for (const item of section.items) {
      if (!shouldIncludeItem(discoverMode, mode, item)) {
        continue;
      }
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flatten.push({
        ...item,
        metadataSource: [item.metadataSource, section.label || section.reason]
          .filter(Boolean)
          .join(" · "),
      });
      if (flatten.length >= itemLimit) break;
    }
    if (flatten.length >= itemLimit) break;
  }

  return finalizeDiscoverResults(container, flatten, discoverMode, mode);
}

async function loadYoutubeDiscoverResults(
  container: Pick<
    Container,
    "historyRepository" | "config" | "resultEnrichmentService" | "stateManager"
  >,
  options?: { light?: boolean },
): Promise<DiscoverResultBundle> {
  const itemLimit = Math.max(6, Math.min(80, container.config.discoverItemLimit || 24));
  const historySeeds = container.historyRepository.listLatestByTitle(40).slice(0, 20);
  const seedRow = historySeeds.find(
    (row) =>
      row.mediaKind === "video" ||
      row.providerId === "youtube" ||
      Boolean(row.externalIds?.youtubeId || row.externalIds?.youtubeChannelId),
  );

  let items: readonly SearchResult[] = [];
  if (seedRow && !options?.light) {
    const title = {
      id: seedRow.titleId,
      name: seedRow.title,
      type: "movie",
      externalIds: seedRow.externalIds,
    } as TitleInfo;
    items = await loadYoutubeRecommendations({ title, historySeeds }).catch(() => []);
  }
  if (items.length === 0) {
    items = await loadYoutubeTrending().catch(() => []);
  }

  const flatten = items.slice(0, itemLimit).map((item) => ({
    ...item,
    metadataSource: [item.metadataSource, "YouTube recommendations"].filter(Boolean).join(" · "),
  }));
  return finalizeDiscoverResults(container, flatten, container.config.discoverMode, "youtube");
}

async function finalizeDiscoverResults(
  container: Pick<Container, "resultEnrichmentService">,
  flatten: readonly SearchResult[],
  discoverMode: "auto" | "unified" | "anime-only" | "series-only",
  mode: import("@/domain/types").ShellMode,
): Promise<DiscoverResultBundle> {
  const enrichments = await container.resultEnrichmentService
    .enrichResults(flatten)
    .catch(() => new Map<string, ResultEnrichment>());
  const enriched = flatten.map((result) => applyResultEnrichment(result, enrichments));
  const discoverModeLabel = labelDiscoverMode(discoverMode, mode);
  return {
    results: enriched,
    subtitle:
      flatten.length > 0
        ? `${flatten.length} recommendation picks · ${discoverModeLabel}`
        : "No recommendation picks yet",
    emptyMessage:
      mode === "youtube"
        ? "No YouTube recommendations right now. Watch something, then retry /recommendation."
        : discoverMode === "anime-only" || (discoverMode === "auto" && mode === "anime")
          ? "No anime recommendations right now. Finish a few episodes, then retry /recommendation."
          : "No recommendations right now. Finish something from history, then retry /recommendation.",
  };
}

function applyResultEnrichment(
  result: SearchResult,
  enrichments: ReadonlyMap<string, ResultEnrichment>,
): SearchResult {
  const enrichment = enrichments.get(resultEnrichmentKey(result));
  if (!enrichment || enrichment.badges.length === 0) return result;
  return {
    ...result,
    metadataSource: [
      result.metadataSource,
      enrichment.badges.map((badge) => badge.label).join(" · "),
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function shouldIncludeItem(
  discoverMode: "auto" | "unified" | "anime-only" | "series-only",
  shellMode: import("@/domain/types").ShellMode,
  item: SearchResult,
): boolean {
  // YouTube discover uses a dedicated loader; this filter is for TMDB/AniList sections.
  if (shellMode === "youtube") return false;
  if (discoverMode === "unified") return true;
  if (discoverMode === "anime-only") return item.type === "series";
  if (discoverMode === "series-only") return item.type === "movie" || item.type === "series";
  // auto mode
  return shellMode === "anime" ? item.type === "series" : true;
}

function labelDiscoverMode(
  discoverMode: "auto" | "unified" | "anime-only" | "series-only",
  shellMode: import("@/domain/types").ShellMode,
): string {
  if (shellMode === "youtube") return "YouTube mode";
  if (discoverMode === "unified") return "unified";
  if (discoverMode === "anime-only") return "anime only";
  if (discoverMode === "series-only") return "series and movies only";
  return shellMode === "anime" ? "anime mode" : "series and movies";
}
