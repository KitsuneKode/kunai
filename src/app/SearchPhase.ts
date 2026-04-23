// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "./Phase";
import type { TitleInfo } from "../domain/types";
import { searchTitles } from "./search-routing";
import { resolveCommands } from "../app-shell/commands";
import { openBrowseShell } from "../app-shell/ink-shell";

export class SearchPhase implements Phase<void, TitleInfo> {
  name = "search";

  async execute(_input: void, context: PhaseContext): Promise<PhaseResult<TitleInfo>> {
    const { container } = context;
    const { searchRegistry, stateManager, logger } = container;

    try {
      stateManager.dispatch({ type: "RESET_SEARCH" });
      stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });

      while (true) {
        const currentState = stateManager.getState();
        stateManager.dispatch({
          type: "SET_VIEW",
          view: currentState.searchResults.length > 0 ? "results" : "search",
        });

        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          initialQuery: currentState.searchQuery,
          placeholder: currentState.mode === "anime" ? "Demon Slayer" : "Breaking Bad",
          commands: resolveCommands(currentState, [
            "settings",
            "toggle-mode",
            "history",
            "diagnostics",
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
              searchRegistry,
            });
            const results = search.results;

            logger.info("Search complete", {
              query,
              count: results.length,
              strategy: search.strategy,
              source: search.sourceId,
            });

            stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });

            return {
              options: results.map((result) => ({
                value: result,
                label: result.year ? `${result.title} (${result.year})` : result.title,
                detail: `${result.type === "series" ? "Series" : "Movie"}${
                  result.overview ? ` · ${result.overview}` : ""
                }`,
              })),
              subtitle: `${results.length} results · ${search.sourceName}`,
              emptyMessage: "No results found. Adjust the query and try again.",
            };
          },
        });

        if (outcome.type === "cancelled") {
          return { status: "cancelled" };
        }

        if (outcome.type === "action") {
          if (outcome.action === "quit") {
            return { status: "cancelled" };
          }

          if (outcome.action === "toggle-mode") {
            const nextState = stateManager.getState();
            const newMode = nextState.mode === "anime" ? "series" : "anime";
            stateManager.dispatch({
              type: "SET_MODE",
              mode: newMode,
              provider:
                newMode === "anime"
                  ? nextState.defaultProviders.anime
                  : nextState.defaultProviders.series,
            });
            stateManager.dispatch({ type: "RESET_SEARCH" });
            stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
            continue;
          }

          if (outcome.action === "settings") {
            logger.info("Settings - not implemented");
            continue;
          }

          logger.info("Browse shell action", { action: outcome.action });
          continue;
        }

        const selected = outcome.value;

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
      logger.error("Search phase error", { error: String(e) });
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
