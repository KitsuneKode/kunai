// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import type { TitleInfo } from "@/domain/types";
import { toBrowseResultOption } from "@/app/browse-option-mappers";
import { searchTitles } from "@/app/search-routing";
import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "@/app-shell/panel-data";
import { resolveCommands } from "@/app-shell/commands";
import { openBrowseShell } from "@/app-shell/ink-shell";
import { applySettingsToRuntime, handleShellAction } from "@/app-shell/workflows";

export type SearchPhaseInput = {
  initialQuery?: string;
  preserveExistingSearch?: boolean;
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
      stateManager,
      logger,
      diagnosticsStore,
      providerRegistry,
      historyStore,
      config,
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
            searchRegistry,
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

        const outcome = await openBrowseShell({
          mode: currentState.mode,
          provider: currentState.provider,
          providerOptions: buildProviderPickerOptions({
            providers: providerRegistry
              .getAll()
              .map((provider) => provider.metadata)
              .filter((metadata) => metadata.isAnimeProvider === (currentState.mode === "anime")),
            currentProvider: currentState.provider,
          }),
          settings: config.getRaw(),
          settingsSeriesProviderOptions: buildProviderPickerOptions({
            providers: providerRegistry
              .getAll()
              .map((provider) => provider.metadata)
              .filter((metadata) => !metadata.isAnimeProvider),
            currentProvider: config.getRaw().provider,
          }),
          settingsAnimeProviderOptions: buildProviderPickerOptions({
            providers: providerRegistry
              .getAll()
              .map((provider) => provider.metadata)
              .filter((metadata) => metadata.isAnimeProvider),
            currentProvider: config.getRaw().animeProvider,
          }),
          onChangeProvider: async (providerId) => {
            stateManager.dispatch({ type: "SET_PROVIDER", provider: providerId });
            diagnosticsStore.record({
              category: "ui",
              message: "Browse provider switched in-shell",
              context: {
                mode: stateManager.getState().mode,
                provider: providerId,
              },
            });
          },
          onSaveSettings: async (next) => {
            await applySettingsToRuntime({
              container,
              next,
              previous: config.getRaw(),
            });
          },
          loadHelpPanel: async () => buildHelpPanelLines(),
          loadAboutPanel: async () =>
            buildAboutPanelLines({
              config: config.getRaw(),
              state: stateManager.getState(),
            }),
          loadDiagnosticsPanel: async () =>
            buildDiagnosticsPanelLines({
              state: stateManager.getState(),
              recentEvents: diagnosticsStore.getRecent(10),
            }),
          loadHistoryPanel: async () =>
            buildHistoryPanelLines(Object.entries(await historyStore.getAll())),
          initialQuery: currentState.searchQuery,
          initialResults: currentState.searchResults.map(toBrowseResultOption),
          initialResultSubtitle:
            currentState.searchResults.length > 0
              ? `${currentState.searchResults.length} results · previous search`
              : undefined,
          initialSelectedIndex: currentState.selectedResultIndex,
          placeholder: currentState.mode === "anime" ? "Demon Slayer" : "Breaking Bad",
          footerMode: config.getRaw().footerHints,
          commands: resolveCommands(currentState, [
            "settings",
            "toggle-mode",
            "provider",
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
          if (outcome.action === "quit") {
            return { status: "quit" };
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
            await handleShellAction({
              action: "settings",
              container,
            });
            continue;
          }

          const actionResult = await handleShellAction({
            action: outcome.action,
            container,
          });
          if (actionResult === "quit") {
            return { status: "cancelled" };
          }
          if (actionResult === "handled") {
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
