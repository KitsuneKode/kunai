import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";

import { buildDiscoverSections } from "./discover-sections";

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
    | "historyStore"
    | "providerRegistry"
    | "config"
    | "resultEnrichmentService"
  >,
  options?: { refresh?: boolean },
): Promise<DiscoverResultBundle> {
  if (options?.refresh) {
    await container.recommendationService.clearCache();
  }
  const sections = await buildDiscoverSections(container);
  const mode = container.stateManager.getState().mode;
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
      discoverMode === "anime-only" || (discoverMode === "auto" && mode === "anime")
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
  shellMode: "series" | "anime",
  item: SearchResult,
): boolean {
  if (discoverMode === "unified") return true;
  if (discoverMode === "anime-only") return item.type === "series";
  if (discoverMode === "series-only") return item.type === "movie" || item.type === "series";
  // auto mode
  return shellMode === "anime" ? item.type === "series" : true;
}

function labelDiscoverMode(
  discoverMode: "auto" | "unified" | "anime-only" | "series-only",
  shellMode: "series" | "anime",
): string {
  if (discoverMode === "unified") return "unified";
  if (discoverMode === "anime-only") return "anime only";
  if (discoverMode === "series-only") return "series and movies only";
  return shellMode === "anime" ? "anime mode" : "series and movies";
}
