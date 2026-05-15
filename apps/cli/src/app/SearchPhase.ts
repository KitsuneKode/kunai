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
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { loadRandomResults } from "@/app/random-results";
import { searchTitles } from "@/app/search-routing";
import { effectiveFooterHints } from "@/container";
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
import type { SearchResult, TitleInfo } from "@/domain/types";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

export type SearchPhaseInput = {
  initialQuery?: string;
  initialRoute?: "trending" | "recommendation" | "calendar" | "random" | "surprise";
  preserveExistingSearch?: boolean;
  /** 1-based index into search results; skips the browse shell when in range (use with bootstrap search). */
  autoPickSearchResultIndex?: number;
};

export const SEARCH_BROWSE_COMMAND_IDS = [
  "filters",
  "recommendation",
  "random",
  "surprise",
  "calendar",
  "library",
  "downloads",
  "history",
  "download",
  "details",
  "setup",
  "settings",
  "trending",
  "toggle-mode",
  "provider",
  "diagnostics",
  "export-diagnostics",
  "help",
  "about",
  "quit",
] as const;

export class SearchPhase implements Phase<SearchPhaseInput | void, TitleInfo> {
  name = "search";

  async execute(
    input: SearchPhaseInput | void,
    context: PhaseContext,
  ): Promise<PhaseResult<TitleInfo>> {
    const { container } = context;
    const { searchRegistry, providerRegistry, stateManager, logger, diagnosticsStore } = container;

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
          diagnosticsStore.record({
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
              const title: TitleInfo = {
                id: mapped.id,
                type: mapped.type,
                name: chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
                year: mapped.year,
                overview: mapped.overview,
                posterUrl: mapped.posterPath ?? undefined,
                titleAliases: mapped.titleAliases,
                episodeCount: mapped.episodeCount,
              };
              stateManager.dispatch({ type: "SELECT_TITLE", title });
              return { status: "success", value: title };
            }
          }
        }

        const shellRuntime = buildShellRuntimeBindings(container);
        const browseContext = await loadBrowseDisplayContext(container, currentState.searchResults);
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
          onSearch: async (query) => {
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

            const search = await searchTitles(query, {
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
            });
            diagnosticsStore.record({
              category: "search",
              message: "Search complete",
              context: {
                query,
                count: results.length,
                strategy: search.strategy,
                source: search.sourceId,
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
                ),
              ),
              subtitle: `${results.length} results · ${search.sourceName}`,
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
            diagnosticsStore.record({
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
            diagnosticsStore.record({
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
            const selected =
              stateManager.getState().searchResults[stateManager.getState().selectedResultIndex];
            if (!selected) {
              stateManager.dispatch({
                type: "SET_PLAYBACK_FEEDBACK",
                note: "Choose a title before queueing a download.",
              });
              continue;
            }
            const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
              mode: stateManager.getState().mode,
              providerId: stateManager.getState().provider,
              animeLanguageProfile: container.config.animeLanguageProfile,
              providerRegistry,
              signal: context.signal,
            });
            const title: TitleInfo = {
              id: mapped.id,
              type: mapped.type,
              name: chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
              titleAliases: mapped.titleAliases,
              year: mapped.year,
              overview: mapped.overview,
              posterUrl: mapped.posterPath ?? undefined,
              episodeCount: mapped.episodeCount,
            };
            const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
            await new DownloadOnlyPhase().execute({ title }, context);
            continue;
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
            return { status: "success", value: routedAction.title };
          }
          if (routedAction === "mode-switch" || routedAction === "handled") {
            continue;
          }

          logger.info("Browse shell action", { action: outcome.action });
          continue;
        }

        const originalSelected = outcome.value;
        const selected = await mapAnimeDiscoveryResultToProviderNative(originalSelected, {
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
        const title: TitleInfo = {
          id: selected.id,
          type: selected.type,
          name: chooseSearchResultTitle(selected, container.config.animeTitlePreference),
          titleAliases: selected.titleAliases,
          year: selected.year,
          overview: selected.overview,
          posterUrl: selected.posterPath ?? undefined,
          episodeCount: selected.episodeCount,
        };

        stateManager.dispatch({ type: "SELECT_TITLE", title });

        return { status: "success", value: title };
      }
    } catch (e) {
      if (context.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("Search phase error", { error: String(e) });
      diagnosticsStore.record({
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
  route: NonNullable<SearchPhaseInput["initialRoute"]>,
  context: PhaseContext,
): Promise<void> {
  const { container } = context;
  const { stateManager, diagnosticsStore, logger } = container;
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
  diagnosticsStore.record({
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
    title: "Search filters",
    subtitle: currentQuery.trim()
      ? `Current query: ${currentQuery}`
      : "Pick a chip, then edit it in the search box if needed.",
    options: [
      {
        value: "mode:anime",
        label: "Anime mode",
        detail: "Search anime catalogs/providers",
      },
      {
        value: "mode:series",
        label: "Series mode",
        detail: "Search TV catalogs/providers",
      },
      {
        value: "downloaded:true",
        label: "Downloaded",
        detail: "Prefer local/downloaded facts when results are loaded",
      },
      {
        value: "watched:watching",
        label: "Continue watching",
        detail: "Show intent for in-progress titles",
      },
      {
        value: "release:today",
        label: "Released today",
        detail: "Use cached release facts where available",
      },
      {
        value: "year:2021",
        label: "Year",
        detail: "Edit the year after insertion",
      },
      {
        value: "sort:recent",
        label: "Sort recent",
        detail: "Prefer recent/local activity ordering where supported",
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
  readonly historyMap: Record<string, HistoryEntry>;
  readonly enrichments: ReadonlyMap<string, ResultEnrichment>;
};

async function loadBrowseDisplayContext(
  container: PhaseContext["container"],
  results: readonly SearchResult[],
): Promise<BrowseDisplayContext> {
  const [historyResult, enrichmentResult] = await Promise.allSettled([
    container.historyStore.getAll(),
    container.resultEnrichmentService.enrichResults(results),
  ]);

  return {
    historyMap: historyResult.status === "fulfilled" ? historyResult.value : {},
    enrichments:
      enrichmentResult.status === "fulfilled"
        ? enrichmentResult.value
        : new Map<string, ResultEnrichment>(),
  };
}
