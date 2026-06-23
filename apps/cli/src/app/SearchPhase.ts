// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import { buildBrowseIdleContext } from "@/app-shell/browse-idle-context";
import type { CalendarTypeTab } from "@/app-shell/calendar-ui.model";
import { routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommands } from "@/app-shell/commands";
import { openBrowseShell } from "@/app-shell/ink-shell";
import { chooseFromListShell } from "@/app-shell/pickers";
import type { BrowseShellOption } from "@/app-shell/types";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { chooseSearchResultTitle, toBrowseResultOption } from "@/app/browse-option-mappers";
import { launchCalendarContinue } from "@/app/calendar-continue-launch";
import { isCalendarSearchResult, loadCalendarResults } from "@/app/calendar-results";
import { playTrailer } from "@/app/details-trailer";
import { loadDiscoverResults } from "@/app/discover-results";
import { loadDiscoveryList } from "@/app/discovery-lists";
import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  prepareReplayTitleForProvider,
  titleFromHistorySelection,
} from "@/app/launch-entry";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { loadRandomResults, loadSurpriseResults } from "@/app/random-results";
import { applySearchSelectionSessionRouting } from "@/app/search-selection-routing";
import { titleInfoFromSearchResult } from "@/app/title-info";
import {
  episodeInfoFromQueueEntry,
  mediaItemFromSearchResult,
  titleInfoFromMediaItemIdentity,
  titleInfoFromQueueEntry,
} from "@/domain/media/media-item-adapters";
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
import type { SearchResult, TitleInfo } from "@/domain/types";
import { openExternalUrl } from "@/infra/shell/open-external-url";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import { readLatestHistoryByTitle } from "@/services/continuation/history-progress";
import {
  readCatalogBoundsForHistoryEntries,
  seedCaughtUpReleaseProgressFromCatalogCount,
} from "@/services/history-metadata/history-catalog-seed";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { searchTitles } from "@/services/search/SearchRoutingService";
import type { FollowedTitlePreference, HistoryProgress } from "@kunai/storage";

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
  private hasHealedHistoryMetadata = false;

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

      // Carries a one-shot calendar type tab from /anime-calendar · /series-calendar
      // into the next BrowseShell open (which seeds the useCalendarState hook). Reset
      // after each open so a plain /calendar afterwards is not stuck on a filter.
      let pendingCalendarType: CalendarTypeTab | undefined;

      // The subtitle for the most recently loaded route (calendar/trending/surprise/
      // discover). Without this, an empty-query results view always showed the generic
      // "N recommendation picks · loaded" even on the calendar. Cleared on manual search.
      let routeSubtitle: string | undefined;

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
          routeSubtitle = await loadSearchRoute(pendingInitialRoute, context);
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
              const selectionMode = applySearchSelectionSessionRouting(container, selected);
              const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
                mode: selectionMode,
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

        let allHistory: Record<string, HistoryProgress> = {};
        try {
          allHistory = readLatestHistoryByTitle(container.historyRepository);
          enqueueReleaseReconciliation(
            container,
            Object.values(allHistory),
            this.hasQueuedStartupReleaseReconciliation ? "browse-idle" : "startup",
            context.signal,
          );
          this.hasQueuedStartupReleaseReconciliation = true;

          // Self-heal missing posters / external ids for history titles, once per
          // session, in the background. Healed titles (now carrying external ids) are
          // re-reconciled so finished series learn their episode total and stop being
          // mis-bucketed as "continue".
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
                const latestByTitle = new Map(
                  historyForHeal.map((row) => [row.titleId, row] as const),
                );
                const now = new Date().toISOString();
                for (const outcome of healed) {
                  if (outcome.episodeCount) {
                    container.historyCatalogEpisodeCounts.set(
                      outcome.titleId,
                      outcome.episodeCount,
                    );
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
          // best-effort
        }

        const browseContext = await loadBrowseDisplayContext(
          container,
          currentState.searchResults,
          {
            preloadedHistory: allHistory,
          },
        );

        const { idleContext, continueWatchingSelection } = await buildBrowseIdleContext(container, {
          preloadedHistory: allHistory,
        });

        const initialCalendarTypeTab = pendingCalendarType;
        pendingCalendarType = undefined;
        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          settings: container.config.getRaw(),
          initialCalendarTypeTab,
          initialQuery: currentState.searchQuery,
          initialResults: currentState.searchResults.map((r) =>
            mapBrowseResultOption(container, browseContext, r),
          ),
          initialResultSubtitle:
            currentState.searchResults.length > 0
              ? currentState.searchQuery.trim().length === 0
                ? (routeSubtitle ??
                  `${currentState.searchResults.length} recommendation picks · loaded`)
                : `${currentState.searchResults.length} results · previous search`
              : undefined,
          initialSelectedIndex: currentState.selectedResultIndex,
          placeholder: currentState.mode === "anime" ? "Demon Slayer" : "Breaking Bad",
          commands: resolveCommands(currentState, SEARCH_BROWSE_COMMAND_IDS),
          idleContext,
          onQueueSelected: async (result) => {
            const router = createContainerMediaActionRouter(container);
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
              options: results.map((r) => mapBrowseResultOption(container, freshBrowseContext, r)),
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
              options: results.map((r) => mapBrowseResultOption(container, freshBrowseContext, r)),
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
                const discover = await loadDiscoverResults(container, { refresh: true });
                return toBrowseResponse(discover);
              })(),
            };
          },
        });

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
            const jobId = idleContext?.offlineReadyNext?.offlineJobId;
            if (!jobId) {
              logger.info("Offline-ready idle row requested without a local job");
              continue;
            }
            const { playCompletedDownload } = await import("./offline-playback");
            await playCompletedDownload(container, jobId);
            const offline = idleContext?.offlineReadyNext;
            const title = titleInfoFromMediaItemIdentity({
              titleId: offline?.titleId ?? jobId,
              title: offline?.title ?? "Offline title",
              mediaKind: "series",
            });
            return { status: "success", value: title };
          }

          if (outcome.action === "play-queue-next") {
            const next = container.queueService.peekNext();
            if (!next) {
              logger.info("Queue-next idle row requested with an empty queue");
              continue;
            }
            const title = titleInfoFromQueueEntry(next);
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            const episode = episodeInfoFromQueueEntry(next);
            if (episode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode });
            }
            return { status: "success", value: title };
          }

          if (outcome.action === "recommendation") {
            routeSubtitle = await loadSearchRoute("recommendation", context);
            continue;
          }

          if (
            outcome.action === "trending" ||
            outcome.action === "calendar" ||
            outcome.action === "random" ||
            outcome.action === "surprise"
          ) {
            routeSubtitle = await loadSearchRoute(outcome.action, context);
            continue;
          }

          // Anime/series calendars load the same schedule route, but seed the next
          // BrowseShell open with the matching type tab so it opens pre-filtered.
          if (outcome.action === "anime-calendar" || outcome.action === "series-calendar") {
            pendingCalendarType = outcome.action === "anime-calendar" ? "Anime" : "TV";
            routeSubtitle = await loadSearchRoute("calendar", context);
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
          subtitle: `${mode === "anime" ? "AniList" : "TMDB"} trending`,
        }
      : route === "calendar"
        ? await loadCalendarResults(container, context.signal)
        : route === "surprise"
          ? await loadSurpriseResults(container, { signal: context.signal })
          : route === "random"
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

  return "subtitle" in bundle && typeof bundle.subtitle === "string" ? bundle.subtitle : undefined;
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
