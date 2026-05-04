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
import { toBrowseResultOption } from "@/app/browse-option-mappers";
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
    const { searchRegistry, providerRegistry, stateManager, logger, diagnosticsStore } = container;

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
              const title: TitleInfo = {
                id: selected.id,
                type: selected.type,
                name: selected.title,
                year: selected.year,
                overview: selected.overview,
                posterUrl: selected.posterPath ?? undefined,
                episodeCount: selected.episodeCount,
              };
              stateManager.dispatch({ type: "SELECT_TITLE", title });
              return { status: "success", value: title };
            }
          }
        }

        const shellRuntime = buildShellRuntimeBindings(container);
        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          ...shellRuntime,
          initialQuery: currentState.searchQuery,
          initialResults: currentState.searchResults.map(toBrowseResultOption),
          initialResultSubtitle:
            currentState.searchResults.length > 0
              ? `${currentState.searchResults.length} results · previous search`
              : undefined,
          initialSelectedIndex: currentState.selectedResultIndex,
          placeholder: currentState.mode === "anime" ? "Demon Slayer" : "Breaking Bad",
          footerMode: effectiveFooterHints(container),
          commands: resolveCommands(currentState, [
            "settings",
            "toggle-mode",
            "provider",
            "history",
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

            return {
              options: results.map(toBrowseResultOption),
              subtitle: `${results.length} results · ${search.sourceName}`,
              emptyMessage: "No results found. Adjust the query and try again.",
            };
          },
        });

        if (outcome.type === "cancelled") {
          return { status: "cancelled" };
        }

        if (outcome.type === "action") {
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

        const selected = outcome.value;
        const selectedIndex = stateManager
          .getState()
          .searchResults.findIndex((result) => result.id === selected.id);
        if (selectedIndex >= 0) {
          stateManager.dispatch({ type: "SELECT_RESULT", index: selectedIndex });
        }

        // Convert SearchResult to TitleInfo
        const title: TitleInfo = {
          id: selected.id,
          type: selected.type,
          name: selected.title,
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
