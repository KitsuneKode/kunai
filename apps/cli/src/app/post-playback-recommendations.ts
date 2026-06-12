import type { Container } from "@/container";
import type { SearchResult, ShellMode, TitleInfo } from "@/domain/types";

import { buildDiscoverSections } from "./discover-sections";
import { loadDiscoveryList } from "./discovery-lists";

export interface PostPlaybackRecommendationItem {
  readonly id: string;
  readonly type: SearchResult["type"];
  readonly sourceId?: string;
  readonly title: string;
  readonly titleAliases?: SearchResult["titleAliases"];
  readonly year?: string;
  readonly overview?: string;
  readonly posterPath?: string | null;
  readonly episodeCount?: number;
}

export function seedPostPlaybackRecommendationItems({
  enabled,
  currentTitle,
  prefetchedItems,
}: {
  readonly enabled: boolean;
  readonly currentTitle: string;
  readonly prefetchedItems: readonly SearchResult[] | null;
}): readonly PostPlaybackRecommendationItem[] {
  if (!enabled || !prefetchedItems?.length) return [];
  return dedupeRecommendationItems(prefetchedItems, currentTitle);
}

/**
 * How the post-play loop should load recommendations when the synchronous seed
 * is empty (e.g. starting from history, where nothing was prefetched):
 *
 * - `skip`     — seed already has items, the rail is disabled, or we already
 *                attempted a load this session. Nothing to do.
 * - `block`    — we might immediately auto-continue into the top recommendation
 *                (end of series, autoplay-recommendations on), so we briefly
 *                await a load to make that decision.
 * - `background` — the menu just needs the cosmetic rail; never block first
 *                paint. Load asynchronously and pick the items up on a later
 *                loop iteration. This is what makes from-history episode
 *                completion paint instantly instead of waiting on a fresh fetch.
 */
export type PostPlaybackRecommendationLoadMode = "skip" | "block" | "background";

export function resolvePostPlaybackRecommendationLoadMode(input: {
  readonly seedCount: number;
  readonly railEnabled: boolean;
  readonly alreadyAttempted: boolean;
  readonly autoContinueIntoRecommendationPossible: boolean;
}): PostPlaybackRecommendationLoadMode {
  if (input.seedCount > 0 || !input.railEnabled || input.alreadyAttempted) return "skip";
  return input.autoContinueIntoRecommendationPossible ? "block" : "background";
}

export async function loadPostPlaybackRecommendationNames(
  container: Pick<
    Container,
    "recommendationService" | "historyStore" | "stateManager" | "providerRegistry"
  >,
  title: TitleInfo,
  mode: ShellMode,
  prefetchedItems: readonly SearchResult[] | null,
): Promise<readonly string[]> {
  const items = await loadPostPlaybackRecommendationItems(container, title, mode, prefetchedItems);
  return items.map((item) => item.title);
}

export async function loadPostPlaybackRecommendationItems(
  container: Pick<
    Container,
    "recommendationService" | "historyStore" | "stateManager" | "providerRegistry"
  >,
  title: TitleInfo,
  mode: ShellMode,
  prefetchedItems: readonly SearchResult[] | null,
): Promise<readonly PostPlaybackRecommendationItem[]> {
  if (prefetchedItems && prefetchedItems.length > 0) {
    return dedupeRecommendationItems(prefetchedItems, title.name);
  }

  if (mode !== "anime" && isTmdbLikeId(title.id)) {
    const direct = await container.recommendationService
      .getForTitle(title.id, title.type)
      .then((section) => dedupeRecommendationItems(section.items, title.name))
      .catch(() => []);
    if (direct.length > 0) return direct;
  }

  if (mode === "anime") {
    return loadDiscoveryList("anime")
      .then((items) => dedupeRecommendationItems(items, title.name))
      .catch(() => []);
  }

  return buildDiscoverSections(container, { light: true })
    .then((sections) =>
      dedupeRecommendationItems(
        sections.flatMap((section) => section.items),
        title.name,
      ),
    )
    .catch(() => []);
}

function dedupeRecommendationItems(
  items: readonly SearchResult[],
  currentTitle: string,
): readonly PostPlaybackRecommendationItem[] {
  const current = normalizeRecommendationName(currentTitle);
  const seen = new Set<string>();
  const out: PostPlaybackRecommendationItem[] = [];
  for (const item of items) {
    const trimmed = item.title.trim();
    const normalized = normalizeRecommendationName(trimmed);
    if (!item.id.trim() || !trimmed || normalized === current || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      id: item.id,
      type: item.type,
      ...(item.metadataSource ? { sourceId: item.metadataSource } : {}),
      title: trimmed,
      ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
      year: item.year,
      overview: item.overview,
      posterPath: item.posterPath,
      ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
    });
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
