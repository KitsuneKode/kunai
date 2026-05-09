// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import { routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommands } from "@/app-shell/commands";
import { openBrowseShell } from "@/app-shell/ink-shell";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { chooseSearchResultTitle, toBrowseResultOption } from "@/app/browse-option-mappers";
import { loadDiscoverResults } from "@/app/discover-results";
import { loadDiscoveryList } from "@/app/discovery-lists";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { searchTitles } from "@/app/search-routing";
import { effectiveFooterHints } from "@/container";
import type { TitleInfo } from "@/domain/types";

export type SearchPhaseInput = {
  initialQuery?: string;
  preserveExistingSearch?: boolean;
  /** 1-based index into search results; skips the browse shell when in range (use with bootstrap search). */
  autoPickSearchResultIndex?: number;
};

export class SearchPhase implements Phase<SearchPhaseInput | void, TitleInfo> {
  name = "search";

  async execute(
    input: SearchPhaseInput | void,
    context: PhaseContext,
  ): Promise<PhaseResult<TitleInfo>> {
    const { container } = context;
    const {
      searchRegistry,
      providerRegistry,
      stateManager,
      logger,
      diagnosticsStore,
      historyStore,
    } = container;

    try {
      const preserveExistingSearch =
        !!input && "preserveExistingSearch" in input && input.preserveExistingSearch === true;

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
        if (currentState.searchQuery.trim().length > 0 && currentState.searchResults.length === 0) {
          stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

          const search = await searchTitles(currentState.searchQuery, {
            mode: currentState.mode,
            providerId: currentState.provider,
            animeLang: currentState.animeLang,
            signal: context.signal,
            searchRegistry,
            providerRegistry,
            enrichAnimeMetadata: true,
          });
          const results = search.results;

          logger.info("Bootstrap search complete", {
            query: currentState.searchQuery,
            count: results.length,
            strategy: search.strategy,
            source: search.sourceId,
          });
          diagnosticsStore.record({
            category: "search",
            message: "Bootstrap search complete",
            context: {
              query: currentState.searchQuery,
              count: results.length,
              strategy: search.strategy,
              source: search.sourceId,
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
                animeLang: stateManager.getState().animeLang,
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
        const historyMap = await historyStore
          .getAll()
          .catch(
            () =>
              ({}) as Record<string, import("@/services/persistence/HistoryStore").HistoryEntry>,
          );
        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          ...shellRuntime,
          initialQuery: currentState.searchQuery,
          initialResults: currentState.searchResults.map((r) =>
            toBrowseResultOption(
              r,
              historyMap[r.id] ?? null,
              container.config.animeTitlePreference,
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
          commands: resolveCommands(currentState, [
            "setup",
            "settings",
            "trending",
            "recommendation",
            "toggle-mode",
            "provider",
            "history",
            "download",
            "details",
            "diagnostics",
            "export-diagnostics",
            "help",
            "about",
            "quit",
          ]),
          onSearch: async (query) => {
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "loading" });

            const search = await searchTitles(query, {
              mode: stateManager.getState().mode,
              providerId: stateManager.getState().provider,
              animeLang: stateManager.getState().animeLang,
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

            const freshHistoryMap = await historyStore
              .getAll()
              .catch(
                () =>
                  ({}) as Record<
                    string,
                    import("@/services/persistence/HistoryStore").HistoryEntry
                  >,
              );
            return {
              options: results.map((r) =>
                toBrowseResultOption(
                  r,
                  freshHistoryMap[r.id] ?? null,
                  container.config.animeTitlePreference,
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
            const freshHistoryMap = await historyStore
              .getAll()
              .catch(
                () =>
                  ({}) as Record<
                    string,
                    import("@/services/persistence/HistoryStore").HistoryEntry
                  >,
              );
            return {
              options: results.map((r) =>
                toBrowseResultOption(
                  r,
                  freshHistoryMap[r.id] ?? null,
                  container.config.animeTitlePreference,
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
              const freshHistoryMap = await historyStore
                .getAll()
                .catch(
                  () =>
                    ({}) as Record<
                      string,
                      import("@/services/persistence/HistoryStore").HistoryEntry
                    >,
                );
              return {
                options: results.map((r) =>
                  toBrowseResultOption(
                    r,
                    freshHistoryMap[r.id] ?? null,
                    container.config.animeTitlePreference,
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
                      toBrowseResultOption(r, null, container.config.animeTitlePreference),
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
              animeLang: stateManager.getState().animeLang,
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
            const discover = await loadDiscoverResults(container);
            stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: "" });
            stateManager.dispatch({
              type: "SET_SEARCH_RESULTS",
              results: [...discover.results],
            });
            if (discover.results.length > 0) {
              stateManager.dispatch({ type: "SELECT_RESULT", index: 0 });
            }
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
          animeLang: stateManager.getState().animeLang,
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
