// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import { routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommands } from "@/app-shell/commands";
import { openBrowseShell } from "@/app-shell/ink-shell";
import { chooseFromListShell } from "@/app-shell/pickers";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { chooseSearchResultTitle, toBrowseResultOption } from "@/app/browse-option-mappers";
import { loadCalendarResults } from "@/app/calendar-results";
import { loadDiscoverResults } from "@/app/discover-results";
import { loadDiscoveryList } from "@/app/discovery-lists";
import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  titleFromHistorySelection,
  type HistoryLaunchSelection,
} from "@/app/launch-entry";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { loadRandomResults } from "@/app/random-results";
import { searchTitles } from "@/app/search-routing";
import { titleInfoFromSearchResult } from "@/app/title-info";
import { effectiveFooterHints } from "@/container";
import { mediaItemFromSearchResult } from "@/domain/media/media-item-adapters";
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
import type { SearchResult, TitleInfo } from "@/domain/types";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import { historyContentType } from "@/services/continuation/history-progress";
import { MediaActionRouter } from "@/services/media-actions/MediaActionRouter";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import type { HistoryProgress } from "@kunai/storage";

export type SearchPhaseInput = {
  initialQuery?: string;
  initialRoute?: "trending" | "recommendation" | "calendar" | "random" | "surprise" | "history";
  preserveExistingSearch?: boolean;
  /** 1-based index into search results; skips the browse shell when in range (use with bootstrap search). */
  autoPickSearchResultIndex?: number;
  /** Return catalog identity without anime provider mapping; callers can map after an explicit action gate. */
  deferAnimeProviderMapping?: boolean;
};

import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";

export { SEARCH_BROWSE_COMMAND_IDS };

export class SearchPhase implements Phase<SearchPhaseInput | void, TitleInfo> {
  name = "search";
  private hasQueuedStartupReleaseReconciliation = false;

  async execute(
    input: SearchPhaseInput | void,
    context: PhaseContext,
  ): Promise<PhaseResult<TitleInfo>> {
    const { container } = context;
    const { searchRegistry, providerRegistry, stateManager, logger, diagnosticsService } =
      container;

    try {
      const preserveExistingSearch =
        !!input && "preserveExistingSearch" in input && input.preserveExistingSearch === true;
      let pendingInitialRoute =
        input && "initialRoute" in input && input.initialRoute ? input.initialRoute : undefined;

      if (!preserveExistingSearch) {
        stateManager.dispatch({ type: "RESET_SEARCH" });
      }
      if (input && "initialQuery" in input && input.initialQuery?.trim()) {
        stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: input.initialQuery.trim() });
      }
      if (!preserveExistingSearch || stateManager.getState().searchResults.length === 0) {
        stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
      }

      while (true) {
        const currentState = stateManager.getState();
        if (
          pendingInitialRoute &&
          currentState.searchQuery.trim().length === 0 &&
          currentState.searchResults.length === 0
        ) {
          if (pendingInitialRoute === "history") {
            const routedAction = await routeSearchShellAction({
              action: "history",
              container,
            });
            pendingInitialRoute = undefined;
            if (routedAction === "quit") {
              return { status: "quit" };
            }
            if (typeof routedAction === "object" && routedAction.type === "history-entry") {
              stateManager.dispatch({ type: "SELECT_TITLE", title: routedAction.title });
              if (routedAction.episode) {
                stateManager.dispatch({ type: "SELECT_EPISODE", episode: routedAction.episode });
              }
              return { status: "success", value: routedAction.title };
            }
            continue;
          }
          await loadSearchRoute(pendingInitialRoute, context);
          pendingInitialRoute = undefined;
          continue;
        }

        if (currentState.searchQuery.trim().length > 0 && currentState.searchResults.length === 0) {
          stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

          const searchIntent = createSearchIntentEngine().fromText(currentState.searchQuery, {
            currentMode: currentState.mode,
          });
          const searchMode =
            searchIntent.intent.mode === "anime" || searchIntent.intent.mode === "series"
              ? searchIntent.intent.mode
              : currentState.mode;
          const search = await searchTitles(searchIntent.intent.query, {
            mode: searchMode,
            providerId: currentState.provider,
            animeLanguageProfile: container.config.animeLanguageProfile,
            signal: context.signal,
            searchRegistry,
            providerRegistry,
            enrichAnimeMetadata: true,
          });
          const results = search.results;

          logger.info("Bootstrap search complete", {
            query: searchIntent.intent.query,
            count: results.length,
            strategy: search.strategy,
            source: search.sourceId,
            filters: searchIntent.chips,
          });
          diagnosticsService.record({
            category: "search",
            message: "Bootstrap search complete",
            context: {
              query: searchIntent.intent.query,
              count: results.length,
              strategy: search.strategy,
              source: search.sourceId,
              filters: searchIntent.chips,
              warnings: searchIntent.warnings,
            },
          });

          stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
          stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "ready" });
        }

        stateManager.dispatch({
          type: "SET_VIEW",
          view: currentState.searchResults.length > 0 ? "results" : "search",
        });

        const jumpIndex =
          input && typeof input === "object" && "autoPickSearchResultIndex" in input
            ? input.autoPickSearchResultIndex
            : undefined;
        if (
          typeof jumpIndex === "number" &&
          Number.isFinite(jumpIndex) &&
          jumpIndex >= 1 &&
          stateManager.getState().searchResults.length > 0
        ) {
          const idx = Math.trunc(jumpIndex) - 1;
          const results = stateManager.getState().searchResults;
          if (idx >= 0 && idx < results.length) {
            const selected = results[idx];
            if (selected) {
              stateManager.dispatch({ type: "SELECT_RESULT", index: idx });
              const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
                mode: stateManager.getState().mode,
                providerId: stateManager.getState().provider,
                animeLanguageProfile: container.config.animeLanguageProfile,
                providerRegistry,
                signal: context.signal,
              });
              const title = titleInfoFromSearchResult(
                mapped,
                chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
              );
              stateManager.dispatch({ type: "SELECT_TITLE", title });
              return { status: "success", value: title };
            }
          }
        }

        const shellRuntime = buildShellRuntimeBindings(container);
        const browseContext = await loadBrowseDisplayContext(container, currentState.searchResults);

        const playlistNextItem = container.queueService.peekNext();
        const releaseSummary = container.releaseProgressCache.summarizeActive();
        const todayReleaseCount = releaseSummary.episodeCount;

        // Find the most-recent in-progress history entry to show a "continue" hint
        let continueWatching: import("@/app-shell/types").BrowseIdleContext["continueWatching"];
        let continueWatchingSelection: HistoryLaunchSelection | null = null;
        try {
          const allHistory = await container.historyStore.getAll();
          enqueueReleaseReconciliation(
            container,
            Object.values(allHistory),
            this.hasQueuedStartupReleaseReconciliation ? "browse-idle" : "startup",
            context.signal,
          );
          this.hasQueuedStartupReleaseReconciliation = true;
          const inProgress = Object.entries(allHistory)
            .filter(([, e]) => !e.completed && e.positionSeconds > 30)
            .sort(
              ([, a], [, b]) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            );
          const topEntry = inProgress[0];
          if (topEntry) {
            const [titleId, top] = topEntry;
            continueWatchingSelection = { titleId, entry: top };
            const ep =
              historyContentType(top) === "series" &&
              typeof top.season === "number" &&
              typeof top.episode === "number"
                ? `S${String(top.season).padStart(2, "0")}E${String(top.episode).padStart(2, "0")}`
                : undefined;
            const topDuration = top.durationSeconds ?? 0;
            const remainingSecs = topDuration > 0 ? topDuration - top.positionSeconds : 0;
            const remainingLabel =
              remainingSecs > 60 ? `${Math.ceil(remainingSecs / 60)}m left` : undefined;
            continueWatching = {
              title: top.title,
              ep,
              remainingLabel,
              titleId,
              mediaKind: historyContentType(top) === "movie" ? "movie" : "series",
            };
          }
        } catch {
          // best-effort
        }

        const idleContext =
          playlistNextItem || continueWatching || todayReleaseCount > 0
            ? {
                playlistNext: playlistNextItem
                  ? {
                      title: playlistNextItem.title,
                      ep:
                        playlistNextItem.season !== null && playlistNextItem.episode !== null
                          ? `S${String(playlistNextItem.season).padStart(2, "0")}E${String(playlistNextItem.episode).padStart(2, "0")}`
                          : undefined,
                    }
                  : undefined,
                continueWatching,
                todayReleaseCount,
                todayReleaseTitleCount: releaseSummary.titleCount,
              }
            : undefined;

        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          ...shellRuntime,
          initialQuery: currentState.searchQuery,
          initialResults: currentState.searchResults.map((r) =>
            toBrowseResultOption(
              r,
              browseContext.historyMap[r.id] ?? null,
              container.config.animeTitlePreference,
              browseContext.enrichments.get(resultEnrichmentKey(r)) ?? null,
              container.listService,
            ),
          ),
          initialResultSubtitle:
            currentState.searchResults.length > 0
              ? currentState.searchQuery.trim().length === 0
                ? `${currentState.searchResults.length} recommendation picks · loaded`
                : `${currentState.searchResults.length} results · previous search`
              : undefined,
          initialSelectedIndex: currentState.selectedResultIndex,
          placeholder: currentState.mode === "anime" ? "Demon Slayer" : "Breaking Bad",
          footerMode: effectiveFooterHints(container),
          commands: resolveCommands(currentState, SEARCH_BROWSE_COMMAND_IDS),
          idleContext,
          onQueueSelected: async (result) => {
            const router = new MediaActionRouter({
              queue: {
                enqueueMediaItem: (item, options) => {
                  container.queueService.enqueueMediaItem(item, options);
                },
              },
            });
            await router.run({
              actionId: "queue-end",
              item: mediaItemFromSearchResult(result),
              source: "search",
            });
            stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Queued ${chooseSearchResultTitle(result, container.config.animeTitlePreference)}.`,
            });
          },
          onSearch: async (query) => {
            const searchIntent = createSearchIntentEngine().fromText(query, {
              currentMode: stateManager.getState().mode,
            });
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

            const search = await searchTitles(searchIntent.intent, {
              mode: stateManager.getState().mode,
              providerId: stateManager.getState().provider,
              animeLanguageProfile: container.config.animeLanguageProfile,
              signal: context.signal,
              searchRegistry,
              providerRegistry,
              enrichAnimeMetadata: true,
            });
            const results = search.results;

            logger.info("Search complete", {
              query,
              count: results.length,
              strategy: search.strategy,
              source: search.sourceId,
              filters: search.evidence,
            });
            diagnosticsService.record({
              category: "search",
              message: "Search complete",
              context: {
                query,
                count: results.length,
                strategy: search.strategy,
                source: search.sourceId,
                filters: search.evidence,
              },
            });

            stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });

            const freshBrowseContext = await loadBrowseDisplayContext(container, results);
            return {
              options: results.map((r) =>
                toBrowseResultOption(
                  r,
                  freshBrowseContext.historyMap[r.id] ?? null,
                  container.config.animeTitlePreference,
                  freshBrowseContext.enrichments.get(resultEnrichmentKey(r)) ?? null,
                  container.listService,
                ),
              ),
              subtitle: `${results.length} results · ${search.sourceName}`,
              upstreamFilterBadges: search.evidence.upstream,
              localFilterBadges: search.evidence.local,
              unsupportedFilterBadges: search.evidence.unsupported,
              emptyMessage: "No results found. Adjust the query and try again.",
            };
          },
          onLoadDiscovery: async () => {
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });
            const mode = stateManager.getState().mode;
            const results = await loadDiscoveryList(mode, context.signal);

            logger.info("Discovery list loaded", {
              mode,
              count: results.length,
            });
            diagnosticsService.record({
              category: "search",
              message: "Discovery list loaded",
              context: {
                mode,
                count: results.length,
              },
            });

            stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
            const freshBrowseContext = await loadBrowseDisplayContext(container, results);
            return {
              options: results.map((r) =>
                toBrowseResultOption(
                  r,
                  freshBrowseContext.historyMap[r.id] ?? null,
                  container.config.animeTitlePreference,
                  freshBrowseContext.enrichments.get(resultEnrichmentKey(r)) ?? null,
                  container.listService,
                ),
              ),
              subtitle: `${results.length} trending · ${mode === "anime" ? "AniList" : "TMDB"}`,
              emptyMessage: "Trending is unavailable right now. Search still works normally.",
            };
          },
          onLoadRecommendations: async () => {
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });
            const toBrowseResponse = async (
              discover: Awaited<ReturnType<typeof loadDiscoverResults>>,
            ) => {
              const results = [...discover.results];
              stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
              const freshBrowseContext = await loadBrowseDisplayContext(container, results);
              return {
                options: results.map((r) =>
                  toBrowseResultOption(
                    r,
                    freshBrowseContext.historyMap[r.id] ?? null,
                    container.config.animeTitlePreference,
                    freshBrowseContext.enrichments.get(resultEnrichmentKey(r)) ?? null,
                    container.listService,
                  ),
                ),
                subtitle: discover.subtitle,
                emptyMessage: discover.emptyMessage,
              };
            };

            // SWR: immediately return cached/in-memory discover list if present, then refresh in background.
            const currentResults = stateManager.getState().searchResults;
            const hasDiscoverLoaded = stateManager.getState().searchQuery.trim().length === 0;
            const warmResponse =
              hasDiscoverLoaded && currentResults.length > 0
                ? {
                    options: currentResults.map((r) =>
                      toBrowseResultOption(
                        r,
                        browseContext.historyMap[r.id] ?? null,
                        container.config.animeTitlePreference,
                        browseContext.enrichments.get(resultEnrichmentKey(r)) ?? null,
                        container.listService,
                      ),
                    ),
                    subtitle: `${currentResults.length} recommendation picks · cached`,
                    emptyMessage: "No recommendations available.",
                  }
                : {
                    options: [],
                    subtitle: "Refreshing recommendation picks…",
                    emptyMessage: "Recommendations are loading in the background.",
                  };

            return {
              ...warmResponse,
              revalidate: (async () => {
                const discover = await loadDiscoverResults(container, { refresh: true });
                return toBrowseResponse(discover);
              })(),
            };
          },
        });

        if (outcome.type === "cancelled") {
          return { status: "cancelled" };
        }

        if (outcome.type === "action") {
          if (outcome.action === "filters") {
            const chip = await chooseSearchFilterChip(stateManager.getState().searchQuery);
            if (chip) {
              const nextQuery = appendSearchFilterChip(stateManager.getState().searchQuery, chip);
              stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: nextQuery });
              stateManager.dispatch({
                type: "SET_PLAYBACK_FEEDBACK",
                note: `Filter added: ${chip}`,
              });
            }
            diagnosticsService.record({
              category: "search",
              message: chip ? "Search filter chip added" : "Search filter help opened",
              context: {
                chip,
                supported: "mode, provider, downloaded, watched, year, release, sort, type, rating",
              },
            });
            continue;
          }

          if (outcome.action === "download") {
            const { downloadSelectedResult } = await import("../app-shell/workflows");
            await downloadSelectedResult(container);
            continue;
          }

          if (outcome.action === "resume-continue-watching") {
            if (!continueWatchingSelection) {
              logger.info("Inline continue requested without a history target");
              continue;
            }

            applyHistorySelectionProvider(container, continueWatchingSelection);
            const title = titleFromHistorySelection(continueWatchingSelection);
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            const episode = episodeFromHistorySelection(continueWatchingSelection);
            if (episode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode });
            }
            return { status: "success", value: title };
          }

          if (outcome.action === "recommendation") {
            await loadSearchRoute("recommendation", context);
            continue;
          }

          if (
            outcome.action === "trending" ||
            outcome.action === "calendar" ||
            outcome.action === "random" ||
            outcome.action === "surprise"
          ) {
            await loadSearchRoute(outcome.action, context);
            continue;
          }

          const routedAction = await routeSearchShellAction({
            action: outcome.action,
            container,
          });

          if (routedAction === "quit") {
            return { status: "quit" };
          }
          if (typeof routedAction === "object" && routedAction.type === "history-entry") {
            stateManager.dispatch({ type: "SELECT_TITLE", title: routedAction.title });
            if (routedAction.episode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode: routedAction.episode });
            }
            return { status: "success", value: routedAction.title };
          }
          if (routedAction === "mode-switch" || routedAction === "handled") {
            continue;
          }

          logger.info("Browse shell action", { action: outcome.action });
          continue;
        }

        const originalSelected = outcome.value;
        const deferAnimeProviderMapping =
          !!input && "deferAnimeProviderMapping" in input && input.deferAnimeProviderMapping;
        const selected = deferAnimeProviderMapping
          ? originalSelected
          : await mapAnimeDiscoveryResultToProviderNative(originalSelected, {
              mode: stateManager.getState().mode,
              providerId: stateManager.getState().provider,
              animeLanguageProfile: container.config.animeLanguageProfile,
              providerRegistry,
              signal: context.signal,
            });
        const selectedIndex = stateManager
          .getState()
          .searchResults.findIndex((result) => result.id === originalSelected.id);
        if (selectedIndex >= 0) {
          stateManager.dispatch({ type: "SELECT_RESULT", index: selectedIndex });
        }

        // Convert SearchResult to TitleInfo
        const title = titleInfoFromSearchResult(
          selected,
          chooseSearchResultTitle(selected, container.config.animeTitlePreference),
        );

        stateManager.dispatch({ type: "SELECT_TITLE", title });

        return { status: "success", value: title };
      }
    } catch (e) {
      if (context.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("Search phase error", { error: String(e) });
      diagnosticsService.record({
        category: "search",
        message: "Search phase error",
        context: { error: String(e) },
      });
      return {
        status: "error",
        error: {
          code: "NETWORK_ERROR",
          message: String(e),
          retryable: true,
          service: searchRegistry.getDefault()?.metadata.id,
        },
      };
    }
  }
}

async function loadSearchRoute(
  route: Exclude<NonNullable<SearchPhaseInput["initialRoute"]>, "history">,
  context: PhaseContext,
): Promise<void> {
  const { container } = context;
  const { stateManager, diagnosticsService, logger } = container;
  stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
  stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

  const mode = stateManager.getState().mode;
  const bundle =
    route === "trending"
      ? {
          results: await loadDiscoveryList(mode, context.signal),
          subtitle: `${mode === "anime" ? "AniList" : "TMDB"} trending`,
        }
      : route === "calendar"
        ? await loadCalendarResults(container, context.signal)
        : route === "random" || route === "surprise"
          ? await loadRandomResults(container, { signal: context.signal })
          : await loadDiscoverResults(container);

  const results = [...bundle.results];
  stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
  stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "ready" });
  if (results.length > 0) {
    stateManager.dispatch({ type: "SELECT_RESULT", index: 0 });
  }

  logger.info("Search route loaded", {
    route,
    mode,
    count: results.length,
  });
  diagnosticsService.record({
    category: "search",
    message: "Search route loaded",
    context: {
      route,
      mode,
      count: results.length,
    },
  });
}

async function chooseSearchFilterChip(currentQuery: string): Promise<string | null> {
  const picked = await chooseFromListShell<string | null>({
    title: "Filter by category",
    subtitle: currentQuery.trim()
      ? `Adds to "${currentQuery.trim()}"  ·  type to narrow chips`
      : "Pick a category — type to narrow (e.g. 'genre', 'year', 'rating').",
    options: [
      // ── Type ──
      { value: "type:movie", label: "Type · Movies", detail: "Only movies" },
      { value: "type:series", label: "Type · Series", detail: "Only TV / series" },
      { value: "mode:anime", label: "Type · Anime", detail: "Search anime catalogs" },
      // ── Genre (anime catalogs honor these directly) ──
      { value: "genre:action", label: "Genre · Action", detail: "" },
      { value: "genre:adventure", label: "Genre · Adventure", detail: "" },
      { value: "genre:comedy", label: "Genre · Comedy", detail: "" },
      { value: "genre:drama", label: "Genre · Drama", detail: "" },
      { value: "genre:fantasy", label: "Genre · Fantasy", detail: "" },
      { value: "genre:horror", label: "Genre · Horror", detail: "" },
      { value: "genre:mystery", label: "Genre · Mystery", detail: "" },
      { value: "genre:romance", label: "Genre · Romance", detail: "" },
      { value: "genre:supernatural", label: "Genre · Supernatural", detail: "" },
      { value: "genre:thriller", label: "Genre · Thriller", detail: "" },
      { value: "genre:sports", label: "Genre · Sports", detail: "" },
      { value: "genre:mecha", label: "Genre · Mecha", detail: "" },
      // ── Year ──
      { value: "year:2025", label: "Year · 2025", detail: "" },
      { value: "year:2024", label: "Year · 2024", detail: "" },
      { value: "year:2023", label: "Year · 2023", detail: "" },
      { value: "year:2022", label: "Year · 2022", detail: "" },
      { value: "year:2020", label: "Year · 2020", detail: "" },
      // ── Release status ──
      { value: "release:today", label: "Release · Today", detail: "Releasing today" },
      { value: "release:this-week", label: "Release · This week", detail: "Airing this week" },
      { value: "release:upcoming", label: "Release · Upcoming", detail: "Not yet aired" },
      // ── Rating ──
      { value: "rating:9", label: "Rating · 9+", detail: "Top rated" },
      { value: "rating:8", label: "Rating · 8+", detail: "Highly rated" },
      { value: "rating:7", label: "Rating · 7+", detail: "Well rated" },
      // ── Your library ──
      { value: "watched:watching", label: "Library · Continue watching", detail: "In-progress" },
      { value: "watched:completed", label: "Library · Completed", detail: "Finished" },
      { value: "watched:unwatched", label: "Library · Unwatched", detail: "Not started" },
      { value: "downloaded:true", label: "Library · Downloaded", detail: "Available offline" },
      // ── Sort ──
      { value: "sort:popular", label: "Sort · Popular", detail: "" },
      { value: "sort:rating", label: "Sort · Top rated", detail: "" },
      { value: "sort:recent", label: "Sort · Recent", detail: "" },
      // ── Advanced (edit the code after inserting) ──
      { value: "audio:ja", label: "Audio · Japanese", detail: "Edit code: ja/en/hi/de…" },
      { value: "subtitles:en", label: "Subtitles · English", detail: "Edit code: en/es/ja…" },
      {
        value: "provider:allanime",
        label: "Provider · …",
        detail: "Edit provider id after insert",
      },
      { value: null, label: "Cancel" },
    ],
  });
  return picked ?? null;
}

function appendSearchFilterChip(query: string, chip: string): string {
  const trimmed = query.trim();
  if (!trimmed) return chip;
  if (trimmed.split(/\s+/).includes(chip)) return trimmed;
  return `${trimmed} ${chip}`;
}

type BrowseDisplayContext = {
  readonly historyMap: Record<string, HistoryProgress>;
  readonly enrichments: ReadonlyMap<string, ResultEnrichment>;
};

async function loadBrowseDisplayContext(
  container: PhaseContext["container"],
  results: readonly SearchResult[],
): Promise<BrowseDisplayContext> {
  const historyMap = await container.historyStore.getAll().catch(() => ({}));
  const enrichments = await container.resultEnrichmentService
    .enrichResults(results, { preloadedHistory: historyMap })
    .catch(() => new Map<string, ResultEnrichment>());

  return { historyMap, enrichments };
}
