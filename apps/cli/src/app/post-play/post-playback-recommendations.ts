import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import { buildDiscoverSections } from "@/app/discover/discover-sections";
import { loadDiscoveryList } from "@/app/discover/discovery-lists";
import type { Container } from "@/container";
import type { SearchResult, ShellMode, TitleInfo } from "@/domain/types";

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

export function postPlaybackRecommendationItemsToRailItems(
  items: readonly PostPlaybackRecommendationItem[],
): readonly PlaybackRecommendationRailItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    ...(item.sourceId ? { sourceId: item.sourceId } : {}),
    ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
    ...(item.year ? { year: item.year } : {}),
    ...(item.overview ? { overview: item.overview } : {}),
    ...(item.posterPath !== undefined ? { posterPath: item.posterPath } : {}),
    ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
  }));
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

type RecommendationRailContainer = Pick<
  Container,
  | "recommendationService"
  | "historyRepository"
  | "stateManager"
  | "providerRegistry"
  | "config"
  | "diagnosticsService"
>;

/**
 * Orchestrates the post-play recommendation rail across post-play menu
 * iterations. Owns the cross-iteration cache (`loaded`) and the single
 * background-load guard (`inFlight`) that previously lived as loose `let`
 * bindings inside PlaybackPhase.execute, so the menu loop can just ask for the
 * rail items each pass without re-implementing the seed/block/background policy.
 *
 * `now`, `sleep`, and `load` are injectable so the block-vs-background timing
 * policy can be unit-tested without real timers or a live recommendation fetch.
 */
export class PostPlaybackRecommendationRail {
  private loaded: readonly PostPlaybackRecommendationItem[] | null = null;
  private inFlight = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: {
      readonly container: RecommendationRailContainer;
      readonly title: TitleInfo;
      readonly budgetMs: number;
      readonly now?: () => number;
      readonly sleep?: (ms: number) => Promise<void>;
      readonly load?: (mode: ShellMode) => Promise<readonly PostPlaybackRecommendationItem[]>;
    },
  ) {}

  /** True once a live load has been attempted this post-play session. */
  get attempted(): boolean {
    return this.loaded !== null;
  }

  /** Cached background/block load result, if any. */
  get loadedItems(): readonly PostPlaybackRecommendationItem[] | null {
    return this.loaded;
  }

  /** Notified when a background load finishes and cached items are ready. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyLoaded(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Returns the rail items to render this iteration: the synchronous seed,
   * upgraded to a blocking load only when an auto-continue decision needs it,
   * otherwise filled in the background and picked up on a later iteration.
   */
  async resolveRailItems(input: {
    readonly mode: ShellMode;
    readonly prefetchedItems: readonly SearchResult[] | null;
    readonly autoContinueIntoRecommendationPossible: boolean;
  }): Promise<readonly PostPlaybackRecommendationItem[]> {
    const { container, title, budgetMs } = this.deps;
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? ((ms: number) => Bun.sleep(ms));
    const load =
      this.deps.load ??
      ((mode: ShellMode) => loadPostPlaybackRecommendationItems(container, title, mode, null));

    const seedStartedAtMs = now();
    let railItems = seedPostPlaybackRecommendationItems({
      enabled: container.config.recommendationRailEnabled,
      currentTitle: title.name,
      prefetchedItems: input.prefetchedItems,
    });
    container.diagnosticsService.record({
      category: "playback",
      operation: "post-playback.recommendations.seed",
      message: "Post-playback recommendations seeded for first paint",
      context: {
        titleId: title.id,
        mode: input.mode,
        itemCount: railItems.length,
        elapsedMs: now() - seedStartedAtMs,
        prefetched: Boolean(input.prefetchedItems?.length),
      },
    });

    const loadMode = resolvePostPlaybackRecommendationLoadMode({
      seedCount: railItems.length,
      railEnabled: container.config.recommendationRailEnabled,
      alreadyAttempted: this.loaded !== null,
      autoContinueIntoRecommendationPossible: input.autoContinueIntoRecommendationPossible,
    });

    if (loadMode === "block") {
      const loadStartedAtMs = now();
      let timedOut = false;
      this.loaded = await Promise.race([
        load(input.mode),
        sleep(budgetMs).then(() => {
          timedOut = true;
          return [] as readonly PostPlaybackRecommendationItem[];
        }),
      ]).catch(() => [] as readonly PostPlaybackRecommendationItem[]);
      container.diagnosticsService.record({
        category: "playback",
        operation: "post-playback.recommendations.load",
        message: "Post-playback recommendations loaded before auto-continue decision",
        context: {
          titleId: title.id,
          mode: input.mode,
          itemCount: this.loaded.length,
          elapsedMs: now() - loadStartedAtMs,
          timedOut,
        },
      });
    } else if (loadMode === "background" && !this.inFlight) {
      this.inFlight = true;
      const loadStartedAtMs = now();
      void load(input.mode)
        .catch(() => [] as readonly PostPlaybackRecommendationItem[])
        .then((items) => {
          this.loaded = items;
          this.notifyLoaded();
          container.diagnosticsService.record({
            category: "playback",
            operation: "post-playback.recommendations.background",
            message: "Post-playback recommendations loaded in the background",
            context: {
              titleId: title.id,
              mode: input.mode,
              itemCount: items.length,
              elapsedMs: now() - loadStartedAtMs,
            },
          });
          return items;
        });
    }

    if (this.loaded && this.loaded.length > 0) {
      railItems = this.loaded;
    }
    return railItems;
  }
}

export async function loadPostPlaybackRecommendationNames(
  container: Pick<
    Container,
    "recommendationService" | "historyRepository" | "stateManager" | "providerRegistry"
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
    "recommendationService" | "historyRepository" | "stateManager" | "providerRegistry"
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
