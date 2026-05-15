import type { Container } from "@/container";
import type { SearchResult, ShellMode, TitleInfo } from "@/domain/types";

import { buildDiscoverSections } from "./discover-sections";

export async function loadPostPlaybackRecommendationNames(
  container: Pick<
    Container,
    "recommendationService" | "historyStore" | "stateManager" | "providerRegistry"
  >,
  title: TitleInfo,
  mode: ShellMode,
  prefetchedNames: readonly string[] | null,
): Promise<readonly string[]> {
  if (prefetchedNames && prefetchedNames.length > 0) {
    return dedupeRecommendationNames(prefetchedNames, title.name);
  }

  if (mode !== "anime" && isTmdbLikeId(title.id)) {
    const direct = await container.recommendationService
      .getForTitle(title.id, title.type)
      .then((section) => namesFromItems(section.items, title.name))
      .catch(() => []);
    if (direct.length > 0) return direct;
  }

  return buildDiscoverSections(container)
    .then((sections) =>
      dedupeRecommendationNames(
        sections.flatMap((section) => section.items.map((item) => item.title)),
        title.name,
      ),
    )
    .catch(() => []);
}

function namesFromItems(items: readonly SearchResult[], currentTitle: string): readonly string[] {
  return dedupeRecommendationNames(
    items.map((item) => item.title),
    currentTitle,
  );
}

function dedupeRecommendationNames(
  names: readonly string[],
  currentTitle: string,
): readonly string[] {
  const current = normalizeRecommendationName(currentTitle);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const normalized = normalizeRecommendationName(trimmed);
    if (!trimmed || normalized === current || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeRecommendationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function isTmdbLikeId(id: string): boolean {
  return /^\d+$/.test(id);
}
