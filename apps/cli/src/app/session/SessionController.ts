// =============================================================================
// Session Controller
//
// Orchestrates the application lifecycle through phases.
// Outer loop: Search → Playback → (repeat or quit)
// =============================================================================

import { primeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import type { SearchPhaseInput } from "@/app/search/SearchPhase";
import { createPendingBootstrap, spendBootstrapIntent } from "@/app/session/pending-bootstrap";
import type { Phase, PhaseResult, PhaseContext } from "@/app/session/Phase";
import { abortOrphanDownloadResolve, type Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import { buildDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";

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
  private shutdownStarted = false;

  constructor(private container: Container) {}

  /**
   * Synchronous quiescence only: stop new session/player/download work without
   * touching external resources, so the shutdown coordinator can restore the
   * terminal and preserve state before mpv/Discord teardown. Idempotent.
   */
  public beginShutdown(): void {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    this.container.player.beginShutdown();
    this.container.workControl.cancelActive("shutdown");
    abortOrphanDownloadResolve(this.container);
    this.abortController.abort("shutdown");
  }

  /** Bounded external cleanup (mpv session, Discord presence), failure-isolated. */
  public async releaseExternalResources(): Promise<void> {
    const cleanupResults = await Promise.allSettled([
      this.container.playbackRouter.stop(),
      this.container.player.releasePersistentSession(),
      this.container.presence.shutdown(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "fulfilled") continue;
      this.container.diagnosticsService.record(
        buildDiagnosticEvent({
          category: "session",
          operation: "session.shutdown.cleanup.failed",
          status: "failed",
          severity: "recoverable",
          failureClass: "unknown",
          message: "Session shutdown cleanup failed",
          context: { error: String(result.reason) },
        }),
      );
    }
  }

  /** Compatibility wrapper until every caller uses the split lifecycle. */
  public async shutdown(): Promise<void> {
    this.beginShutdown();
    await this.releaseExternalResources();
  }

  async run(bootstrap: SessionBootstrap = {}): Promise<void> {
    const { logger, tracer, stateManager, diagnosticsService } = this.container;
    // One object, spent in one call. These were six independent locals cleared
    // per-branch, and the direct-title branch cleared only two of them — see
    // `spendBootstrapIntent`.
    const pending = createPendingBootstrap(bootstrap);

    await tracer.span("session", async () => {
      try {
        diagnosticsService.record(
          buildDiagnosticEvent({
            category: "session",
            operation: "session.started",
            status: "started",
            severity: "healthy",
            recommendedAction: "none",
            message: "Session started",
            correlation: { sessionId: this.container.sessionId },
            context: {
              mode: stateManager.getState().mode,
              provider: stateManager.getState().provider,
            },
          }),
        );
        while (true) {
          let title: TitleInfo;
          if (pending.initialTitle) {
            title = pending.initialTitle;
            stateManager.dispatch({ type: "SELECT_TITLE", title });
            if (pending.initialEpisode) {
              stateManager.dispatch({ type: "SELECT_EPISODE", episode: pending.initialEpisode });
            }
            spendBootstrapIntent(pending);
          } else {
            // Phase 1: Search
            const searchResult = await this.executePhase(
              {
                initialQuery: pending.initialQuery,
                initialRoute: pending.initialRoute,
                preserveExistingSearch: pending.preserveExistingSearch,
                autoPickSearchResultIndex: pending.autoPickSearchResultIndex,
              } satisfies SearchPhaseInput,
              new (await import("@/app/search/SearchPhase")).SearchPhase(),
            );
            spendBootstrapIntent(pending);

            if (this.abortController.signal.aborted) break;

            if (searchResult.status === "quit") break;
            if (searchResult.status === "cancelled") continue;
            if (searchResult.status === "error") {
              logger.error("Search phase failed", { error: searchResult.error });
              continue;
            }

            title = searchResult.value;
          }

          // Phase 2: Playback (inner loop for episodes)
          const playbackResult = await this.executePhase(
            title,
            new (await import("@/app/playback/PlaybackPhase")).PlaybackPhase(),
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
            diagnosticsService.record(
              buildDiagnosticEvent({
                category: "playback",
                operation: "playback.phase.failed",
                status: "failed",
                severity: playbackResult.error.retryable ? "recoverable" : "blocked",
                recommendedAction: playbackResult.error.retryable
                  ? "fallback-provider"
                  : "export-diagnostics",
                spanFamily: "playback.startup",
                message: "Playback phase failed",
                context: {
                  code: playbackResult.error.code,
                  retryable: playbackResult.error.retryable,
                  message: playbackResult.error.message,
                },
              }),
            );
            stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Playback failed: ${playbackResult.error.message}${
                playbackResult.error.retryable ? " (try a different provider)" : ""
              }`,
            });
            continue;
          }

          // Playback completed (mode switch or back to search)
          const outcome = playbackResult.value;
          if (outcome === "quit") break;
          if (typeof outcome === "object" && outcome.type === "history_entry") {
            pending.initialTitle = outcome.title;
            pending.initialEpisode = outcome.episode ?? null;
            primeShareBootstrapStartSeconds(outcome.startSeconds);
            pending.preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (typeof outcome === "object" && outcome.type === "browse_route") {
            pending.initialRoute = outcome.route;
            pending.preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (typeof outcome === "object" && outcome.type === "playlist-advance") {
            pending.initialTitle = outcome.titleInfo;
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
            pending.preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (outcome === "back_to_results") {
            stateManager.dispatch({ type: "RESET_CONTENT" });
            pending.preserveExistingSearch = true;
          }
          if (outcome === "back_to_history") {
            pending.initialRoute = "history";
            stateManager.dispatch({ type: "RESET_CONTENT" });
            pending.preserveExistingSearch = false;
          }
          if (outcome === "back_to_search") {
            // Returning to a fresh search must drop the finished session's
            // context: clear currentTitle (so the /download context command is
            // gone) and reset the autoplay/autoskip pause flags (so the
            // "autoplay paused" banner does not bleed into the new search).
            stateManager.dispatch({ type: "RESET_CONTENT" });
            pending.preserveExistingSearch = false;
          }
          // "mode_switch" falls through to next iteration
        }
      } catch (e) {
        logger.error("Session fatal error", { error: String(e) });
        diagnosticsService.record(
          buildDiagnosticEvent({
            category: "session",
            operation: "session.fatal",
            status: "failed",
            severity: "blocked",
            failureClass: "unknown",
            message: "Session fatal error",
            context: { error: String(e) },
          }),
        );
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
