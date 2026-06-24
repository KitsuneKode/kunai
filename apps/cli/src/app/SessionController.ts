// =============================================================================
// Session Controller
//
// Orchestrates the application lifecycle through phases.
// Outer loop: Search → Playback → (repeat or quit)
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import type { SearchPhaseInput } from "@/app/SearchPhase";
import { primeShareBootstrapStartSeconds } from "@/app/share-bootstrap-start";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { runBackgroundTask } from "@/services/diagnostics/background-task";

export type SessionOutcome = "quit" | "mode_switch";

export interface SessionBootstrap {
  initialQuery?: string;
  initialTitle?: TitleInfo | null;
  initialEpisode?: EpisodeInfo | null;
  initialRoute?: SearchPhaseInput["initialRoute"];
  preserveExistingSearch?: boolean;
  /** 1-based search result index for the first bootstrap query (`--jump` / `--quick`). */
  autoPickSearchResultIndex?: number;
}

export class SessionController {
  private abortController = new AbortController();

  constructor(private container: Container) {}

  public async shutdown(): Promise<void> {
    this.container.player.beginShutdown();
    this.container.workControl.cancelActive("shutdown");
    this.abortController.abort();
    const cleanupResults = await Promise.allSettled([
      this.container.player.releasePersistentSession(),
      this.container.presence.shutdown(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "fulfilled") continue;
      this.container.diagnosticsService.record({
        category: "session",
        message: "Session shutdown cleanup failed",
        context: { error: String(result.reason) },
      });
    }
  }

  async run(bootstrap: SessionBootstrap = {}): Promise<void> {
    const { logger, tracer, stateManager, diagnosticsService } = this.container;
    let pendingInitialTitle = bootstrap.initialTitle ?? null;
    let pendingInitialEpisode = bootstrap.initialEpisode ?? null;
    let pendingInitialQuery = bootstrap.initialQuery;
    let pendingInitialRoute = bootstrap.initialRoute;
    let preserveExistingSearch = bootstrap.preserveExistingSearch ?? false;
    let pendingAutoPick = bootstrap.autoPickSearchResultIndex;

    await tracer.span("session", async () => {
      try {
        diagnosticsService.record({
          category: "session",
          message: "Session started",
          sessionId: this.container.sessionId,
          context: {
            mode: stateManager.getState().mode,
            provider: stateManager.getState().provider,
          },
        });
        while (true) {
          let title: TitleInfo;
          if (pendingInitialTitle) {
            title = pendingInitialTitle;
            pendingInitialTitle = null;
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            if (pendingInitialEpisode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode: pendingInitialEpisode });
              pendingInitialEpisode = null;
            }
          } else {
            // Phase 1: Search
            const searchResult = await this.executePhase(
              {
                initialQuery: pendingInitialQuery,
                initialRoute: pendingInitialRoute,
                preserveExistingSearch,
                autoPickSearchResultIndex: pendingAutoPick,
              } satisfies SearchPhaseInput,
              new (await import("./SearchPhase")).SearchPhase(),
            );
            pendingInitialQuery = undefined;
            pendingInitialRoute = undefined;
            pendingAutoPick = undefined;
            preserveExistingSearch = false;

            if (this.abortController.signal.aborted) break;

            if (searchResult.status === "quit") break;
            if (searchResult.status === "cancelled") continue;
            if (searchResult.status === "error") {
              // Log error and continue to next iteration
              logger.error("Search phase failed", { error: searchResult.error });
              continue;
            }

            title = searchResult.value;
          }

          // Phase 2: Playback (inner loop for episodes)
          const playbackResult = await this.executePhase(
            title,
            new (await import("./PlaybackPhase")).PlaybackPhase(),
          );

          runBackgroundTask({
            task: "presence.clearAfterPlayback",
            category: "presence",
            diagnostics: diagnosticsService,
            context: { sessionId: this.container.sessionId, reason: "playback-exited" },
            run: () => this.container.presence.clearPlayback("playback-exited"),
          });

          if (this.abortController.signal.aborted) break;

          if (playbackResult.status === "quit") break;
          if (playbackResult.status === "cancelled") continue;
          if (playbackResult.status === "error") {
            logger.error("Playback phase failed", { error: playbackResult.error });
            console.error(
              `\n⚠ Playback failed: ${playbackResult.error.message}${playbackResult.error.retryable ? " (try a different provider)" : ""}`,
            );
            continue;
          }

          // Playback completed (mode switch or back to search)
          const outcome = playbackResult.value;
          if (outcome === "quit") break;
          if (typeof outcome === "object" && outcome.type === "history_entry") {
            pendingInitialTitle = outcome.title;
            pendingInitialEpisode = outcome.episode ?? null;
            primeShareBootstrapStartSeconds(outcome.startSeconds);
            preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (typeof outcome === "object" && outcome.type === "browse_route") {
            pendingInitialRoute = outcome.route;
            preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (typeof outcome === "object" && outcome.type === "playlist-advance") {
            pendingInitialTitle = outcome.titleInfo;
            const targetMode = outcome.mode;
            if (targetMode !== stateManager.getState().mode) {
              stateManager.dispatch({
                type: "SET_MODE",
                mode: targetMode,
                provider: stateManager.getState().defaultProviders[targetMode],
              });
            }
            if (outcome.episode !== undefined) {
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: { season: outcome.season ?? 1, episode: outcome.episode },
              });
            }
            preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (outcome === "back_to_results") {
            stateManager.dispatch({ type: "RESET_CONTENT" });
            preserveExistingSearch = true;
          }
          if (outcome === "back_to_history") {
            pendingInitialRoute = "history";
            stateManager.dispatch({ type: "RESET_CONTENT" });
            preserveExistingSearch = false;
          }
          if (outcome === "back_to_search") {
            // Returning to a fresh search must drop the finished session's
            // context: clear currentTitle (so the /download context command is
            // gone) and reset the autoplay/autoskip pause flags (so the
            // "autoplay paused" banner does not bleed into the new search).
            stateManager.dispatch({ type: "RESET_CONTENT" });
            preserveExistingSearch = false;
          }
          // "mode_switch" falls through to next iteration
        }
      } catch (e) {
        logger.error("Session fatal error", { error: String(e) });
        diagnosticsService.record({
          category: "session",
          message: "Session fatal error",
          context: { error: String(e) },
        });
        throw e;
      }
    });
  }

  private async executePhase<TInput, TOutput>(
    input: TInput,
    phase: Phase<TInput, TOutput>,
  ): Promise<PhaseResult<TOutput>> {
    const { tracer } = this.container;

    return tracer.span(phase.name, async () => {
      const context: PhaseContext = {
        container: this.container,
        signal: this.abortController.signal,
      };
      return phase.execute(input, context);
    });
  }
}
