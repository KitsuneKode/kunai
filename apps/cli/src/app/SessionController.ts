// =============================================================================
// Session Controller
//
// Orchestrates the application lifecycle through phases.
// Outer loop: Search → Playback → (repeat or quit)
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import type { SearchPhaseInput } from "@/app/SearchPhase";
import type { Container } from "@/container";
import type { TitleInfo } from "@/domain/types";

export type SessionOutcome = "quit" | "mode_switch";

export interface SessionBootstrap {
  initialQuery?: string;
  initialTitle?: TitleInfo | null;
  preserveExistingSearch?: boolean;
  /** 1-based search result index for the first bootstrap query (`--jump` / `--quick`). */
  autoPickSearchResultIndex?: number;
}

export class SessionController {
  private abortController = new AbortController();

  constructor(private container: Container) {}

  public async shutdown(): Promise<void> {
    this.abortController.abort();
    this.container.workControl.setActive(null);
    await this.container.presence.shutdown();
    await this.container.player.releasePersistentSession();
  }

  async run(bootstrap: SessionBootstrap = {}): Promise<void> {
    const { logger, tracer, stateManager, diagnosticsStore } = this.container;
    let pendingInitialTitle = bootstrap.initialTitle ?? null;
    let pendingInitialQuery = bootstrap.initialQuery;
    let preserveExistingSearch = bootstrap.preserveExistingSearch ?? false;
    let pendingAutoPick = bootstrap.autoPickSearchResultIndex;

    await tracer.span("session", async () => {
      try {
        diagnosticsStore.record({
          category: "session",
          message: "Session started",
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
          } else {
            // Phase 1: Search
            const searchResult = await this.executePhase(
              {
                initialQuery: pendingInitialQuery,
                preserveExistingSearch,
                autoPickSearchResultIndex: pendingAutoPick,
              } satisfies SearchPhaseInput,
              new (await import("./SearchPhase")).SearchPhase(),
            );
            pendingInitialQuery = undefined;
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
            preserveExistingSearch = false;
            stateManager.dispatch({ type: "RESET_CONTENT" });
            continue;
          }
          if (outcome === "back_to_results") {
            stateManager.dispatch({ type: "RESET_CONTENT" });
            preserveExistingSearch = true;
          }
          // "mode_switch" falls through to next iteration
        }
      } catch (e) {
        logger.error("Session fatal error", { error: String(e) });
        diagnosticsStore.record({
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
