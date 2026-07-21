// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import {
  buildBrowseIdleContext,
  type ContinueWatchingSelection,
} from "@/app-shell/browse-idle-context";
import type { CalendarTypeTab } from "@/app-shell/calendar-ui.model";
import { routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommands } from "@/app-shell/commands";
import { openBrowseShell } from "@/app-shell/ink-shell";
import { chooseFromListShell } from "@/app-shell/pickers";
import type { BrowseIdleContext, BrowseShellOption } from "@/app-shell/types";
import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  prepareReplayTitleForProvider,
  titleFromHistorySelection,
} from "@/app/bootstrap/launch-entry";
import { primeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import { titleInfoFromSearchResult, videoMetaFromSearchResult } from "@/app/bootstrap/title-info";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import { loadDiscoverResults } from "@/app/discover/discover-results";
import { loadDiscoveryList } from "@/app/discover/discovery-lists";
import { loadRandomResults, loadSurpriseResults } from "@/app/discover/random-results";
import { buildBrowseInitialResults } from "@/app/search/browse-initial-results";
import { browseLibraryFilterAvailability } from "@/app/search/browse-local-filter-facts";
import {
  chooseSearchResultTitle,
  describeSearchResultAvailability,
  toBrowseResultOption,
} from "@/app/search/browse-option-mappers";
import { launchCalendarContinue } from "@/app/search/calendar-continue-launch";
import { isCalendarSearchResult, loadCalendarResults } from "@/app/search/calendar-results";
import { playTrailer } from "@/app/search/details-trailer";
import { enrichSelectedTitleIdentity } from "@/app/search/enrich-selected-title";
import { buildSearchFilterChipOptions } from "@/app/search/search-filter-chips";
import { applySearchSelectionSessionRouting } from "@/app/search/search-selection-routing";
import {
  shouldDeferBrowseIdleContext,
  type SearchStartupRoute,
} from "@/app/search/search-startup-policy";
import type { Phase, PhaseResult, PhaseContext } from "@/app/session/Phase";
import { kitsuneErrorFromUnknown } from "@/domain/kitsune-error-mapping";
import {
  mediaItemFromSearchResult,
  titleInfoFromQueueEntry,
} from "@/domain/media/media-item-adapters";
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
import { ensureSessionProviderMatchesLane } from "@/domain/session/session-display";
import type { SearchResult, ShellMode, TitleInfo } from "@/domain/types";
import { openExternalUrl } from "@/infra/shell/open-external-url";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import { readLatestHistoryByTitle } from "@/services/continuation/history-progress";
import { recordCliStartupMilestone } from "@/services/diagnostics/cli-startup-milestone";
import { buildSearchDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import { seedCaughtUpReleaseProgressFromCatalogCount } from "@/services/history-metadata/history-catalog-seed";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";
import { observeOnline } from "@/services/network/network-observation";
import {
  enqueueReleaseReconciliation,
  collectReleaseReconciliationRows,
} from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { searchTitles, type SearchFilterEvidence } from "@/services/search/SearchRoutingService";
import type { FollowedTitlePreference, HistoryProgress } from "@kunai/storage";

export type SearchPhaseInput = {
  initialQuery?: string;
  initialRoute?: SearchStartupRoute;
  preserveExistingSearch?: boolean;
  /** 1-based index into search results; skips the browse shell when in range (use with bootstrap search). */
  autoPickSearchResultIndex?: number;
  /** Return catalog identity without anime provider mapping; callers can map after an explicit action gate. */
  deferAnimeProviderMapping?: boolean;
};

import {
  claimQueuePlaybackLaunch,
  episodeInfoFromQueuePlaybackLaunch,
  titleInfoFromQueuePlaybackLaunch,
} from "@/app-shell/root-queue-bridge";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";

export { SEARCH_BROWSE_COMMAND_IDS };

/** Projection-only display title from cached aliases — does not hit providers. */
export function projectSearchResultDisplayTitle(
  result: import("@/domain/types").SearchResult,
  titlePreference: import("@/domain/types").TitleAliasKind | "provider",
): string {
  return chooseSearchResultTitle(result, titlePreference);
}

export function searchResultsHaveCachedTitleAliases(
  results: readonly import("@/domain/types").SearchResult[],
): boolean {
  return results.some((result) => (result.titleAliases?.length ?? 0) > 0);
}

export { describeSearchResultAvailability };

export class SearchPhase implements Phase<SearchPhaseInput | void, TitleInfo> {
  name = "search";
  private hasQueuedStartupReleaseReconciliation = false;
  private hasHealedHistoryMetadata = false;

  private readLocalBrowseHistory(context: PhaseContext): Record<string, HistoryProgress> {
    const { container } = context;
    let allHistory: Record<string, HistoryProgress> = {};
    try {
      allHistory = readLatestHistoryByTitle(container.historyRepository);
      enqueueReleaseReconciliation(
        container,
        collectReleaseReconciliationRows(container),
        this.hasQueuedStartupReleaseReconciliation ? "browse-idle" : "startup",
        context.signal,
      );
      this.hasQueuedStartupReleaseReconciliation = true;

      if (!this.hasHealedHistoryMetadata) {
        this.hasHealedHistoryMetadata = true;
        const historyForHeal = Object.values(allHistory);
        void (async () => {
          try {
            const healed = await container.historyMetadataHealer.heal(
              historyForHeal,
              context.signal,
            );
            if (healed.length === 0) return;
            const latestByTitle = new Map(historyForHeal.map((row) => [row.titleId, row] as const));
            const now = new Date().toISOString();
            for (const outcome of healed) {
              if (outcome.episodeCount) {
                container.historyCatalogEpisodeCounts.set(outcome.titleId, outcome.episodeCount);
                const entry = latestByTitle.get(outcome.titleId);
                if (entry) {
                  seedCaughtUpReleaseProgressFromCatalogCount(
                    container.releaseProgressWriter,
                    entry,
                    outcome.episodeCount,
                    now,
                  );
                }
              }
            }
            const healedIds = new Set(healed.map((outcome) => outcome.titleId));
            enqueueReleaseReconciliation(
              container,
              historyForHeal.filter((row) => healedIds.has(row.titleId)),
              "history",
              context.signal,
            );
          } catch {
            // best-effort; healing retries next session
          }
        })();
      }
    } catch {
      // best-effort local reads only
    }
    return allHistory;
  }

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

      // Browse owns the live draft locally, but root overlays temporarily end and
      // recreate its mounted shell. Keep one controller-owned draft for this phase.
      const browseQueryDraft = {
        value: stateManager.getState().searchQuery,
        mode: stateManager.getState().mode,
      };
      const syncBrowseQueryDraft = () => {
        browseQueryDraft.value = stateManager.getState().searchQuery;
      };

      // Carries a one-shot calendar type tab from /anime-calendar · /series-calendar
      // into the next BrowseShell open (which seeds the useCalendarState hook). Reset
      // after each open so a plain /calendar afterwards is not stuck on a filter.
      let pendingCalendarType: CalendarTypeTab | undefined;

      // The subtitle for the most recently loaded route (calendar/trending/surprise/
      // discover). Without this, an empty-query results view always showed the generic
      // "N recommendation picks · loaded" even on the calendar. Cleared on manual search.
      let routeSubtitle: string | undefined;

      // Filter evidence + parser warnings from the most recent bootstrap/`-S`
      // search, consumed once when the browse shell mounts so bootstrap results
      // go through the same honest local-filter pipeline as interactive Enter.
      let pendingSearchEvidence: SearchFilterEvidence | undefined;
      let pendingSearchWarnings: readonly string[] = [];

      while (true) {
        const currentState = stateManager.getState();
        if (container.config.offlineMode && currentState.searchQuery.trim().length === 0) {
          container.stateManager.dispatch({
            type: "OPEN_OVERLAY",
            overlay: { type: "library", view: "library" },
          });
          return { status: "cancelled" };
        }
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
              primeShareBootstrapStartSeconds(routedAction.startSeconds);
              stateManager.dispatch({ type: "SELECT_TITLE", title: routedAction.title });
              if (routedAction.episode) {
                stateManager.dispatch({ type: "SELECT_EPISODE", episode: routedAction.episode });
              }
              return { status: "success", value: routedAction.title };
            }
            continue;
          }
          routeSubtitle = await loadSearchRoute(pendingInitialRoute, context);
          syncBrowseQueryDraft();
          pendingInitialRoute = undefined;
          continue;
        }

        if (currentState.searchQuery.trim().length > 0 && currentState.searchResults.length === 0) {
          // A real text search supersedes any route subtitle (calendar/trending/etc).
          routeSubtitle = undefined;
          stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

          const searchIntent = createSearchIntentEngine().fromText(currentState.searchQuery, {
            currentMode: currentState.mode,
          });
          const search = await observeOnline(container, "search-error", () =>
            searchTitles(searchIntent.intent, {
              mode: stateManager.getState().mode,
              providerId: currentState.provider,
              animeLanguageProfile: container.config.animeLanguageProfile,
              youtubeLanguageProfile: container.config.youtubeLanguageProfile,
              signal: context.signal,
              searchRegistry,
              providerRegistry,
              enrichAnimeMetadata: true,
            }),
          );
          const results = search.results;
          pendingSearchEvidence = search.evidence;
          pendingSearchWarnings = searchIntent.warnings;

          logger.info("Bootstrap search complete", {
            query: searchIntent.intent.query,
            count: results.length,
            strategy: search.strategy,
            source: search.sourceId,
            filters: searchIntent.chips,
          });
          diagnosticsService.record(
            buildSearchDiagnosticEvent({
              operation: "search.bootstrap.completed",
              status: "succeeded",
              severity: "healthy",
              recommendedAction: "none",
              message: "Bootstrap search complete",
              context: {
                query: searchIntent.intent.query,
                count: results.length,
                strategy: search.strategy,
                source: search.sourceId,
                filters: searchIntent.chips,
                warnings: searchIntent.warnings,
              },
            }),
          );

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
              const selectionMode = applySearchSelectionSessionRouting(container, selected);
              const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
                mode: selectionMode,
                providerId: stateManager.getState().provider,
                animeLanguageProfile: container.config.animeLanguageProfile,
                providerRegistry,
                signal: context.signal,
              });
              const title = await enrichSelectedTitleIdentity(
                container.catalogIdentityService,
                titleInfoFromSearchResult(
                  mapped,
                  chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
                ),
                selectionMode,
                context.signal,
              );
              stateManager.dispatch({
                type: "SELECT_TITLE",
                title,
                videoMeta: videoMetaFromSearchResult(mapped),
              });
              return { status: "success", value: title };
            }
          }
        }

        const deferIdleContext = shouldDeferBrowseIdleContext({
          query: currentState.searchQuery,
          resultCount: currentState.searchResults.length,
          initialRoute: pendingInitialRoute,
        });
        const allHistory = deferIdleContext ? {} : this.readLocalBrowseHistory(context);
        const browseContext =
          currentState.searchResults.length === 0
            ? {
                historyMap: allHistory,
                enrichments: new Map<string, ResultEnrichment>(),
                queueTitleIds: new Set<string>(),
                followPreferenceByTitleId: new Map<string, FollowedTitlePreference>(),
              }
            : await loadBrowseDisplayContext(container, currentState.searchResults, {
                preloadedHistory: allHistory,
              });

        let latestIdleContext: BrowseIdleContext | undefined;
        let continueWatchingSelection: ContinueWatchingSelection | null = null;
        if (!deferIdleContext) {
          const bundle = await buildBrowseIdleContext(container, {
            preloadedHistory: allHistory,
          });
          latestIdleContext = bundle.idleContext;
          continueWatchingSelection = bundle.continueWatchingSelection;
        }
        const loadIdleContext = deferIdleContext
          ? async () => {
              try {
                const deferredHistory = this.readLocalBrowseHistory(context);
                const bundle = await buildBrowseIdleContext(container, {
                  preloadedHistory: deferredHistory,
                });
                latestIdleContext = bundle.idleContext;
                continueWatchingSelection = bundle.continueWatchingSelection;
                recordCliStartupMilestone(diagnosticsService, "idle-context-ready");
                return bundle.idleContext;
              } catch (error) {
                recordCliStartupMilestone(diagnosticsService, "idle-context-failed");
                throw error;
              }
            }
          : undefined;

        const initialCalendarTypeTab = pendingCalendarType;
        pendingCalendarType = undefined;
        const browseState = currentState;
        ensureSessionProviderMatchesLane(stateManager, providerRegistry);
        const syncedState = stateManager.getState();

        // Bootstrap / `-S` and preserved-search remounts feed results straight
        // into the shell, so run them through the same local-filter pipeline that
        // interactive Enter uses — otherwise `-S "mob downloaded:true"` would show
        // an unfiltered list while Enter honestly narrows it.
        const initialBrowse = buildBrowseInitialResults({
          options: browseState.searchResults.map((r) =>
            mapBrowseResultOption(container, browseContext, r),
          ),
          query: browseState.searchQuery,
          evidence: pendingSearchEvidence,
        });
        const initialWarnings = pendingSearchWarnings;
        pendingSearchEvidence = undefined;
        pendingSearchWarnings = [];

        const outcomePromise = openBrowseShell({
          mode: syncedState.mode,
          provider: syncedState.provider,
          settings: container.config.getRaw(),
          initialCalendarTypeTab,
          initialQuery: browseState.searchQuery,
          queryDraft: browseQueryDraft,
          initialResults: initialBrowse.options,
          initialResultSubtitle:
            browseState.searchResults.length > 0
              ? browseState.searchQuery.trim().length === 0
                ? (routeSubtitle ??
                  `${browseState.searchResults.length} recommendation picks · loaded`)
                : `${initialBrowse.options.length} results · previous search${initialBrowse.subtitleSuffix}`
              : undefined,
          initialWarnings,
          initialSelectedIndex: browseState.selectedResultIndex,
          placeholder:
            syncedState.mode === "anime"
              ? "Demon Slayer"
              : syncedState.mode === "youtube"
                ? "lofi hip hop"
                : "Breaking Bad",
          commands: resolveCommands(syncedState, SEARCH_BROWSE_COMMAND_IDS, {
            excludeGroups: ["Experimental"],
          }),
          idleContext: latestIdleContext,
          loadIdleContext,
          onQueueSelected: async (result) => {
            const router = createContainerMediaActionRouter(container);
            await router.run({
              actionId: "add-to-up-next",
              item: mediaItemFromSearchResult(result),
              source: "search",
            });
            stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Added ${chooseSearchResultTitle(result, container.config.animeTitlePreference)} to Up Next.`,
            });
          },
          onWatchlistSelected: async (result) => {
            const router = createContainerMediaActionRouter(container);
            await router.run({
              actionId: "add-to-watchlist",
              item: mediaItemFromSearchResult(result),
              source: "search",
            });
            stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Added ${chooseSearchResultTitle(result, container.config.animeTitlePreference)} to Watchlist.`,
            });
          },
          onFollowSelected: async (result) => {
            const router = createContainerMediaActionRouter(container);
            await router.run({
              actionId: "follow",
              item: mediaItemFromSearchResult(result),
              source: "search",
            });
            stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Following ${chooseSearchResultTitle(result, container.config.animeTitlePreference)}.`,
            });
          },
          onPlayTrailer: (url) => {
            void playTrailer(
              {
                playUrl: async (target) => {
                  if (!Bun.which("mpv")) return false;
                  Bun.spawn(["mpv", target], {
                    stdout: "ignore",
                    stderr: "ignore",
                    stdin: "ignore",
                  });
                  return true;
                },
                openInBrowser: async (target) => openExternalUrl(target),
              },
              url,
            );
          },
          onOpenLink: (url) => openExternalUrl(url),
          onSearch: async (query) => {
            ensureSessionProviderMatchesLane(stateManager, providerRegistry);
            const searchIntent = createSearchIntentEngine().fromText(query, {
              currentMode: stateManager.getState().mode,
            });
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

            const search = await observeOnline(container, "search-error", () =>
              searchTitles(searchIntent.intent, {
                mode: stateManager.getState().mode,
                providerId: stateManager.getState().provider,
                animeLanguageProfile: container.config.animeLanguageProfile,
                youtubeLanguageProfile: container.config.youtubeLanguageProfile,
                signal: context.signal,
                searchRegistry,
                providerRegistry,
                enrichAnimeMetadata: true,
              }),
            );
            const results = search.results;

            logger.info("Search complete", {
              query,
              count: results.length,
              strategy: search.strategy,
              source: search.sourceId,
              filters: search.evidence,
            });
            diagnosticsService.record(
              buildSearchDiagnosticEvent({
                operation: "search.query.completed",
                status: "succeeded",
                severity: "healthy",
                recommendedAction: "none",
                message: "Search complete",
                context: {
                  query,
                  count: results.length,
                  strategy: search.strategy,
                  source: search.sourceId,
                  filters: search.evidence,
                },
              }),
            );

            stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });

            const freshBrowseContext = await loadBrowseDisplayContext(container, results);
            return {
              options: results.map((r) => mapBrowseResultOption(container, freshBrowseContext, r)),
              subtitle: `${results.length} results · ${search.sourceName}`,
              upstreamFilterBadges: search.evidence.upstream,
              localFilterBadges: search.evidence.local,
              unsupportedFilterBadges: search.evidence.unsupported,
              warnings: searchIntent.warnings,
              emptyMessage: "No results found. Adjust the query and try again.",
            };
          },
          onLoadDiscovery: async () => {
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });
            const mode = stateManager.getState().mode;
            const results = await observeOnline(container, "search-error", () =>
              loadDiscoveryList(mode, context.signal),
            );

            logger.info("Discovery list loaded", {
              mode,
              count: results.length,
            });
            diagnosticsService.record(
              buildSearchDiagnosticEvent({
                operation: "search.discovery.loaded",
                status: "succeeded",
                severity: "healthy",
                recommendedAction: "none",
                message: "Discovery list loaded",
                context: {
                  mode,
                  count: results.length,
                },
              }),
            );

            stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
            const freshBrowseContext = await loadBrowseDisplayContext(container, results);
            return {
              options: results.map((r) => mapBrowseResultOption(container, freshBrowseContext, r)),
              subtitle: `${results.length} trending · ${
                mode === "anime" ? "AniList" : mode === "youtube" ? "YouTube" : "TMDB"
              }`,
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
                  mapBrowseResultOption(container, freshBrowseContext, r),
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
                      mapBrowseResultOption(container, browseContext, r),
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
                const discover = await observeOnline(container, "search-error", () =>
                  loadDiscoverResults(container, { refresh: true }),
                );
                return toBrowseResponse(discover);
              })(),
            };
          },
        });
        recordCliStartupMilestone(diagnosticsService, "browse-mounted");
        const outcome = await outcomePromise;

        // Leaving the calendar surface — stamp the visit so the next open marks
        // only releases that aired since now as "new". Done at this close event
        // (not a render effect) so the just-shown rows still used the prior value.
        const firstShownResult = currentState.searchResults[0];
        if (firstShownResult && isCalendarSearchResult(firstShownResult)) {
          try {
            await container.config.update({ lastCalendarVisitAt: Date.now() });
            await container.config.save();
          } catch {
            // best-effort; a failed visit stamp only over-reports "new" next open
          }
        }

        if (outcome.type === "cancelled") {
          return { status: "cancelled" };
        }

        if (outcome.type === "offline-playback") {
          stateManager.dispatch({ type: "SELECT_TITLE", title: outcome.launch.title });
          if (outcome.launch.episode) {
            stateManager.dispatch({ type: "SELECT_EPISODE", episode: outcome.launch.episode });
          }
          return { status: "success", value: outcome.launch.title };
        }

        if (outcome.type === "action") {
          if (outcome.action === "filters") {
            const chip = await chooseSearchFilterChip(stateManager.getState().searchQuery, {
              sessionMode: stateManager.getState().mode,
              downloadsEnabled: container.config.downloadsEnabled,
              calendarReleaseContext: stateManager
                .getState()
                .searchResults.some(isCalendarSearchResult),
            });
            if (chip) {
              const nextQuery = appendSearchFilterChip(stateManager.getState().searchQuery, chip);
              stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: nextQuery });
              stateManager.dispatch({
                type: "SET_PLAYBACK_FEEDBACK",
                note: `Filter added: ${chip}`,
              });
            }
            syncBrowseQueryDraft();
            diagnosticsService.record(
              buildSearchDiagnosticEvent({
                operation: chip ? "search.filter.applied" : "search.filter.help",
                status: chip ? "succeeded" : "skipped",
                severity: "healthy",
                recommendedAction: "none",
                message: chip ? "Search filter chip added" : "Search filter help opened",
                context: {
                  chip,
                  supported:
                    "mode, provider, downloaded, watched, year, release, sort, type, rating",
                },
              }),
            );
            continue;
          }

          if (outcome.action === "download") {
            const { downloadSelectedResult } = await import("../../app-shell/workflows");
            await downloadSelectedResult(container);
            continue;
          }

          // Browse `m` opens the same playback entry path as Enter so the rich
          // "Where to start?" / movie resume picker appears — not sparse title-control.
          if (outcome.action === "menu") {
            if (outcome.value) {
              const originalSelected = outcome.value;
              const deferAnimeProviderMapping =
                !!input && "deferAnimeProviderMapping" in input && input.deferAnimeProviderMapping;
              const selectionMode = applySearchSelectionSessionRouting(container, originalSelected);
              const selected = deferAnimeProviderMapping
                ? originalSelected
                : await mapAnimeDiscoveryResultToProviderNative(originalSelected, {
                    mode: selectionMode,
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
              const title = await enrichSelectedTitleIdentity(
                container.catalogIdentityService,
                titleInfoFromSearchResult(
                  selected,
                  chooseSearchResultTitle(selected, container.config.animeTitlePreference),
                ),
                selectionMode,
                context.signal,
              );
              stateManager.dispatch({
                type: "SELECT_TITLE",
                title,
                videoMeta: videoMetaFromSearchResult(selected),
              });
              return { status: "success", value: title };
            }

            // Idle continue / queue: prime the title without locking an episode so
            // PlaybackPhase still presents the starting-point menu.
            if (!stateManager.getState().currentTitle) {
              if (continueWatchingSelection) {
                applyHistorySelectionProvider(container, continueWatchingSelection);
                const title = await prepareReplayTitleForProvider(
                  container,
                  titleFromHistorySelection(continueWatchingSelection),
                  continueWatchingSelection.entry,
                );
                stateManager.dispatch({ type: "SELECT_TITLE", title });
              } else {
                const queueNext = container.queueService.peekNext();
                if (queueNext && latestIdleContext?.playlistNext?.titleId === queueNext.titleId) {
                  const title = titleInfoFromQueueEntry(queueNext);
                  stateManager.dispatch({ type: "SELECT_TITLE", title });
                }
              }
            } else {
              const existing = stateManager.getState().currentTitle;
              if (existing) {
                stateManager.dispatch({ type: "SELECT_TITLE", title: existing });
              }
            }

            const menuTitle = stateManager.getState().currentTitle;
            if (menuTitle) {
              return { status: "success", value: menuTitle };
            }
          }

          if (outcome.action === "resume-continue-watching") {
            if (!continueWatchingSelection) {
              logger.info("Inline continue requested without a history target");
              continue;
            }

            applyHistorySelectionProvider(container, continueWatchingSelection);
            const title = await prepareReplayTitleForProvider(
              container,
              titleFromHistorySelection(continueWatchingSelection),
              continueWatchingSelection.entry,
            );
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            const episode = episodeFromHistorySelection(continueWatchingSelection);
            if (episode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode });
            }
            return { status: "success", value: title };
          }

          if (outcome.action === "play-offline-ready") {
            const jobId = latestIdleContext?.offlineReadyNext?.offlineJobId;
            if (!jobId) {
              logger.info("Offline-ready idle row requested without a local job");
              continue;
            }
            const { prepareOfflinePlaybackLaunch } =
              await import("@/app/offline/offline-playback-launch");
            const launch = await prepareOfflinePlaybackLaunch(container, jobId);
            if (!launch) continue;
            return { status: "success", value: launch.title };
          }

          if (outcome.action === "play-queue-next") {
            const next = container.queueService.peekNext();
            if (!next) {
              logger.info("Queue-next idle row requested with an empty queue");
              continue;
            }
            // Claim the exact peeked row — do not re-peek after claim.
            const launch = claimQueuePlaybackLaunch(container.queueService, next.id, "queue");
            if (!launch) {
              logger.info("Queue-next claim failed; leaving row pending for retry", {
                queueEntryId: next.id,
              });
              continue;
            }
            const title = titleInfoFromQueuePlaybackLaunch(launch);
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            const episode = episodeInfoFromQueuePlaybackLaunch(launch);
            if (episode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode });
            }
            return { status: "success", value: title };
          }

          if (outcome.action === "recommendation") {
            routeSubtitle = await loadSearchRoute("recommendation", context);
            syncBrowseQueryDraft();
            continue;
          }

          if (
            outcome.action === "trending" ||
            outcome.action === "calendar" ||
            outcome.action === "random" ||
            outcome.action === "surprise"
          ) {
            routeSubtitle = await loadSearchRoute(outcome.action, context);
            syncBrowseQueryDraft();
            continue;
          }

          // Anime/series calendars load the same schedule route, but seed the next
          // BrowseShell open with the matching type tab so it opens pre-filtered.
          if (outcome.action === "anime-calendar" || outcome.action === "series-calendar") {
            pendingCalendarType = outcome.action === "anime-calendar" ? "Anime" : "TV";
            routeSubtitle = await loadSearchRoute("calendar", context);
            syncBrowseQueryDraft();
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
        if (
          isCalendarSearchResult(originalSelected) &&
          originalSelected.calendar?.continuation?.playable
        ) {
          const launch = await launchCalendarContinue(container, originalSelected);
          if (launch) {
            stateManager.dispatch({ type: "SELECT_TITLE", title: launch.title });
            return { status: "success", value: launch.title };
          }
        }
        const deferAnimeProviderMapping =
          !!input && "deferAnimeProviderMapping" in input && input.deferAnimeProviderMapping;
        const selectionMode = applySearchSelectionSessionRouting(container, originalSelected);
        const selected = deferAnimeProviderMapping
          ? originalSelected
          : await mapAnimeDiscoveryResultToProviderNative(originalSelected, {
              mode: selectionMode,
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
        const title = await enrichSelectedTitleIdentity(
          container.catalogIdentityService,
          titleInfoFromSearchResult(
            selected,
            chooseSearchResultTitle(selected, container.config.animeTitlePreference),
          ),
          selectionMode,
          context.signal,
        );

        stateManager.dispatch({
          type: "SELECT_TITLE",
          title,
          videoMeta: videoMetaFromSearchResult(selected),
        });

        return { status: "success", value: title };
      }
    } catch (e) {
      if (context.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("Search phase error", { error: String(e) });
      diagnosticsService.record(
        buildSearchDiagnosticEvent({
          operation: "search.phase.failed",
          status: "failed",
          severity: "recoverable",
          failureClass: "unknown",
          message: "Search phase error",
          context: { error: String(e) },
        }),
      );
      return {
        status: "error",
        error: kitsuneErrorFromUnknown(e, {
          code: "NETWORK_ERROR",
          message: "Search failed",
          service: searchRegistry.getDefault()?.metadata.id,
          retryable: true,
        }),
      };
    }
  }
}

async function loadSearchRoute(
  route: Exclude<NonNullable<SearchPhaseInput["initialRoute"]>, "history">,
  context: PhaseContext,
): Promise<string | undefined> {
  const { container } = context;
  const { stateManager, diagnosticsService, logger } = container;
  stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
  stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

  const mode = stateManager.getState().mode;
  const bundle =
    route === "trending"
      ? {
          results: await loadDiscoveryList(mode, context.signal),
          subtitle:
            mode === "anime"
              ? "AniList trending"
              : mode === "youtube"
                ? "YouTube trending"
                : "TMDB trending",
        }
      : route === "calendar"
        ? await loadCalendarResults(container, context.signal)
        : route === "surprise"
          ? await loadSurpriseResults(container, { signal: context.signal })
          : route === "random"
            ? await loadRandomResults(container, { signal: context.signal })
            : await loadDiscoverResults(container);

  if (route === "calendar") {
    enqueueReleaseReconciliation(
      container,
      collectReleaseReconciliationRows(container),
      "calendar",
      context.signal,
    );
  }

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
  diagnosticsService.record(
    buildSearchDiagnosticEvent({
      operation: "search.route.loaded",
      status: "succeeded",
      severity: "healthy",
      recommendedAction: "none",
      message: "Search route loaded",
      context: {
        route,
        mode,
        count: results.length,
      },
    }),
  );

  return "subtitle" in bundle && typeof bundle.subtitle === "string" ? bundle.subtitle : undefined;
}

async function chooseSearchFilterChip(
  currentQuery: string,
  context: {
    readonly sessionMode: ShellMode;
    readonly downloadsEnabled: boolean;
    readonly calendarReleaseContext?: boolean;
  },
): Promise<string | null> {
  const library = browseLibraryFilterAvailability({
    downloadsEnabled: context.downloadsEnabled,
    calendarReleaseContext: context.calendarReleaseContext,
  });
  const options = buildSearchFilterChipOptions({ sessionMode: context.sessionMode, library });

  const picked = await chooseFromListShell<string | null>({
    title: "Filter by category",
    subtitle: currentQuery.trim()
      ? `Adds to "${currentQuery.trim()}"  ·  type to narrow chips`
      : "Pick a category — type to narrow (e.g. 'genre', 'year', 'rating').",
    options,
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
  readonly queueTitleIds: ReadonlySet<string>;
  readonly followPreferenceByTitleId: ReadonlyMap<string, FollowedTitlePreference>;
};

async function loadBrowseDisplayContext(
  container: PhaseContext["container"],
  results: readonly SearchResult[],
  options?: { readonly preloadedHistory?: Record<string, HistoryProgress> },
): Promise<BrowseDisplayContext> {
  const historyMap =
    options?.preloadedHistory ??
    (() => {
      try {
        return readLatestHistoryByTitle(container.historyRepository);
      } catch {
        return {};
      }
    })();
  const enrichments = await container.resultEnrichmentService
    .enrichResults(results, { preloadedHistory: historyMap })
    .catch(() => new Map<string, ResultEnrichment>());
  const queueTitleIds = new Set(
    container.queueService
      .getAll()
      .filter((item) => !item.playedAt)
      .map((item) => item.titleId),
  );
  const followPreferenceByTitleId = new Map<string, FollowedTitlePreference>();
  for (const result of results) {
    const preference = container.followedTitleRepository.get(result.id)?.preference;
    if (preference && preference !== "implicit") {
      followPreferenceByTitleId.set(result.id, preference);
    }
  }

  return { historyMap, enrichments, queueTitleIds, followPreferenceByTitleId };
}

function mapBrowseResultOption(
  container: PhaseContext["container"],
  context: BrowseDisplayContext,
  result: SearchResult,
): BrowseShellOption<SearchResult> {
  return toBrowseResultOption(
    result,
    context.historyMap[result.id] ?? null,
    container.config.animeTitlePreference,
    context.enrichments.get(resultEnrichmentKey(result)) ?? null,
    container.listService,
    {
      followPreference: context.followPreferenceByTitleId.get(result.id),
      inUpNextQueue: context.queueTitleIds.has(result.id),
    },
  );
}
