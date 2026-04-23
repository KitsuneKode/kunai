// =============================================================================
// Search Phase
//
// Handles search input → results → title selection.
// Returns the selected title or cancellation/quit signals.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "./Phase";
import type { TitleInfo } from "../domain/types";
import { searchTitles } from "./search-routing";

export class SearchPhase implements Phase<void, TitleInfo> {
  name = "search";

  async execute(_input: void, context: PhaseContext): Promise<PhaseResult<TitleInfo>> {
    const { container } = context;
    const { searchRegistry, stateManager, logger } = container;

    try {
      // Initialize search UI state
      stateManager.dispatch({ type: "RESET_SEARCH" });
      stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });

      // Show search-first UI and wait for selection
      // For now, delegate to the existing shell functions
      // TODO: Implement search-first Ink shell with live results

      // Use legacy flow for now:
      const { openHomeShell } = await import("../app-shell/ink-shell");
      const { openSearchShell } = await import("../app-shell/ink-shell");
      const { openListShell } = await import("../app-shell/ink-shell");

      // ── Home Gate: Show hotkeys [c]/[a]/[q] before search ─────────────────────
      let gating = true;
      while (gating) {
        stateManager.dispatch({ type: "SET_VIEW", view: "home" });
        const gateAction = await openHomeShell({
          mode: stateManager.getState().mode,
          provider: stateManager.getState().provider,
          subtitle: stateManager.getState().subLang,
          animeLang: stateManager.getState().animeLang,
          status: { label: "Ready", tone: "neutral" },
          commands: (await import("../app-shell/commands")).resolveCommands(
            stateManager.getState(),
            [
              "search",
              "settings",
              "toggle-mode",
              "history",
              "diagnostics",
              "help",
              "about",
              "quit",
            ],
          ),
        });

        if (gateAction === "quit") {
          return { status: "cancelled" };
        }
        if (gateAction === "toggle-mode") {
          const currentState = stateManager.getState();
          const newMode = currentState.mode === "anime" ? "series" : "anime";
          stateManager.dispatch({
            type: "SET_MODE",
            mode: newMode,
            provider:
              newMode === "anime"
                ? currentState.defaultProviders.anime
                : currentState.defaultProviders.series,
          });
        } else if (gateAction === "settings") {
          // TODO: Open settings overlay
          logger.info("Settings - not implemented");
        } else {
          gating = false; // Proceed to search
        }
      }

      // Prompt for search query
      stateManager.dispatch({ type: "SET_VIEW", view: "search" });
      const query = await openSearchShell({
        mode: stateManager.getState().mode,
        provider: stateManager.getState().provider,
        placeholder: stateManager.getState().mode === "anime" ? "Demon Slayer" : "Breaking Bad",
      });

      if (!query) {
        return { status: "cancelled" };
      }

      // Search
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

      if (results.length === 0) {
        return {
          status: "error",
          error: {
            code: "STREAM_NOT_FOUND",
            message: "No results found",
            retryable: false,
          },
        };
      }

      // Show results and wait for selection
      const selected = await openListShell<import("../domain/types").SearchResult>({
        title: "Choose title",
        subtitle: `${results.length} results · ${search.sourceName}`,
        options: results.map((r: import("../domain/types").SearchResult) => ({
          value: r,
          label: `${r.title} (${r.year})`,
          detail: `${r.type === "series" ? "Series" : "Movie"}${
            r.overview ? ` · ${r.overview}` : ""
          }`,
        })),
      });

      if (!selected) {
        return { status: "cancelled" };
      }

      // Convert SearchResult to TitleInfo
      const title: TitleInfo = {
        id: selected.id,
        type: selected.type,
        name: selected.title,
        year: selected.year,
        overview: selected.overview,
        posterUrl: selected.posterPath ?? undefined,
      };

      stateManager.dispatch({ type: "SELECT_TITLE", title });

      return { status: "success", value: title };
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
