// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "./Phase";
import type { TitleInfo, EpisodeInfo, StreamInfo, PlaybackResult } from "../domain/types";

export type PlaybackOutcome = "back_to_search" | "mode_switch" | "quit";

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    const { providerRegistry, stateManager, logger, historyStore, config } = container;

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;

      if (title.type === "series") {
        // Check history for resume
        const history = await historyStore.get(title.id);
        if (history) {
          logger.info("History found", {
            season: history.season,
            episode: history.episode,
            timestamp: history.timestamp,
          });
        }

        // For now, use legacy session-flow logic
        // TODO: Implement proper episode picker with Ink
        const { chooseStartingEpisode } = await import("../session-flow");
        const selection = await chooseStartingEpisode({
          currentId: title.id,
          isAnime: stateManager.getState().mode === "anime",
          apiPicked: null,
          flags: {},
          getHistoryEntry: () => Promise.resolve(history),
        });

        episode = {
          season: selection.season,
          episode: selection.episode,
        };
      } else {
        episode = { season: 1, episode: 1 };
      }

      stateManager.dispatch({ type: "SELECT_EPISODE", episode });

      // Inner playback loop
      while (true) {
        const currentEpisode = stateManager.getState().currentEpisode;
        if (!currentEpisode) break;

        stateManager.dispatch({
          type: "SET_EPISODE_NAVIGATION",
          navigation: buildEpisodeNavigationState(title.type, currentEpisode),
        });

        // Resolve stream with loading UI
        const provider = providerRegistry.get(stateManager.getState().provider);
        if (!provider) {
          return {
            status: "error",
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: `Provider ${stateManager.getState().provider} not found`,
              retryable: false,
            },
          };
        }

        const { openLoadingShell } = await import("../app-shell/ink-shell");

        // Show loading UI while the provider resolves the stream, then always
        // wait for Ink to finish unmounting before the next terminal render.
        const loading = openLoadingShell({
          state: {
            title: title.name,
            subtitle: `S${String(currentEpisode.season).padStart(
              2,
              "0",
            )}E${String(currentEpisode.episode).padStart(2, "0")}`,
            operation: "resolving",
            details: `Provider: ${stateManager.getState().provider}`,
          },
          cancellable: false,
        });

        stateManager.dispatch({
          type: "SET_PLAYBACK_STATUS",
          status: "loading",
        });

        let stream: StreamInfo | null = null;
        try {
          stream = await provider.resolveStream({
            title,
            episode: currentEpisode,
            subLang: stateManager.getState().subLang,
          });
        } finally {
          loading.close();
          await loading.result;
        }

        if (!stream) {
          console.log(`⚠ Stream not found on ${provider.metadata.id}`);
          logger.error("Stream not found", { provider: provider.metadata.id });

          // Try fallback provider
          const compatible = providerRegistry
            .getCompatible(title)
            .filter(
              (p: import("../services/providers/Provider").Provider) =>
                p.metadata.id !== provider.metadata.id,
            );

          const fallback = compatible[0];
          if (fallback) {
            console.log(`🔄 Trying fallback: ${fallback.metadata.id}...`);
            logger.info("Trying fallback provider", {
              fallback: fallback.metadata.id,
            });
            const fallbackStream = await fallback.resolveStream({
              title,
              episode: currentEpisode,
              subLang: stateManager.getState().subLang,
            });

            if (fallbackStream) {
              stateManager.dispatch({
                type: "SET_STREAM",
                stream: fallbackStream,
              });
              stateManager.dispatch({
                type: "SET_PLAYBACK_STATUS",
                status: "ready",
              });
              await this.playStream(fallbackStream, title, currentEpisode, context);
              continue;
            }
          }

          return {
            status: "error",
            error: {
              code: "STREAM_NOT_FOUND",
              message: "Could not resolve stream from any provider",
              retryable: true,
              provider: provider.metadata.id,
            },
          };
        }

        stateManager.dispatch({ type: "SET_STREAM", stream });
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });

        // Play in MPV
        const result = await this.playStream(stream, title, currentEpisode, context);

        // Save history
        if (result.watchedSeconds > 10) {
          await historyStore.save(title.id, {
            title: title.name,
            type: title.type,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            timestamp: result.watchedSeconds,
            duration: result.duration,
            provider: stateManager.getState().provider,
            watchedAt: new Date().toISOString(),
          });
        }

        // Handle post-playback
        if (result.endReason === "eof" && config.autoNext && title.type === "series") {
          // Auto-advance to next episode
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: {
              season: currentEpisode.season,
              episode: currentEpisode.episode + 1,
            },
          });
          continue;
        }

        // Show post-playback menu
        const { openPlaybackShell } = await import("../app-shell/ink-shell");
        const { resolveCommands } = await import("../app-shell/commands");

        const postAction = await openPlaybackShell({
          type: title.type,
          title: title.name,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          provider: stateManager.getState().provider,
          showMemory: false,
          mode: stateManager.getState().mode,
          status: { label: "Ready for next action", tone: "success" },
          commands: resolveCommands(stateManager.getState(), [
            "settings",
            "toggle-mode",
            "provider",
            "replay",
            "next",
            "previous",
            "next-season",
            "diagnostics",
            "help",
            "about",
            "quit",
          ]),
        });

        if (postAction === "quit") {
          return { status: "cancelled" };
        } else if (postAction === "toggle-mode") {
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
          return { status: "success", value: "back_to_search" };
        } else if (postAction === "replay") {
          // Loop continues - same episode
          continue;
        } else if (postAction === "next" && title.type === "series") {
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: {
              season: currentEpisode.season,
              episode: currentEpisode.episode + 1,
            },
          });
          continue;
        } else if (postAction === "previous" && title.type === "series") {
          if (currentEpisode.episode > 1) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: {
                season: currentEpisode.season,
                episode: currentEpisode.episode - 1,
              },
            });
          }
          continue;
        } else if (postAction === "next-season" && title.type === "series") {
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: {
              season: currentEpisode.season + 1,
              episode: 1,
            },
          });
          continue;
        } else if (postAction === "provider") {
          // Switch provider but continue with same episode
          const { openListShell } = await import("../app-shell/ink-shell");
          const providers = providerRegistry.getCompatible(title);
          const selected = await openListShell({
            title: "Switch Provider",
            subtitle: `${providers.length} available`,
            options: providers.map((p) => ({
              value: p.metadata.id,
              label: p.metadata.name,
              detail:
                stateManager.getState().mode === "anime" ? "Anime provider" : "General provider",
            })),
          });
          if (selected) {
            stateManager.dispatch({
              type: "SET_PROVIDER",
              provider: selected,
            });
            continue; // Retry with new provider
          }
          continue;
        } else {
          // Any other action goes back to search
          return { status: "success", value: "back_to_search" };
        }
      }
    } catch (e) {
      logger.error("Playback phase error", { error: String(e) });
      return {
        status: "error",
        error: {
          code: "PLAYER_FAILED",
          message: String(e),
          retryable: false,
        },
      };
    }

    // Fallback return (should not reach here)
    return { status: "success", value: "back_to_search" };
  }

  private async playStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
  ): Promise<PlaybackResult> {
    const { player, stateManager, config } = context.container;

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;

    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });

    const result = await player.play(stream, {
      url: stream.url,
      headers: stream.headers,
      subtitle: stream.subtitle,
      displayTitle,
      startAt: 0,
      autoNext: config.autoNext && title.type === "series",
      attach: false,
    });

    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });

    return result;
  }
}

function buildEpisodeNavigationState(type: TitleInfo["type"], episode: EpisodeInfo) {
  if (type !== "series") {
    return {
      hasPrevious: false,
      hasNext: false,
      hasNextSeason: false,
      previousUnavailableReason: "Previous episode is only available for episodic playback.",
      nextUnavailableReason: "Next episode is only available for episodic playback.",
      nextSeasonUnavailableReason: "Season jump is only available for episodic playback.",
    };
  }

  return {
    hasPrevious: episode.episode > 1,
    hasNext: true,
    hasNextSeason: true,
    previousLabel:
      episode.episode > 1
        ? `S${String(episode.season).padStart(2, "0")}E${String(episode.episode - 1).padStart(
            2,
            "0",
          )}`
        : undefined,
    nextLabel: `S${String(episode.season).padStart(2, "0")}E${String(episode.episode + 1).padStart(
      2,
      "0",
    )}`,
    nextSeasonLabel: `S${String(episode.season + 1).padStart(2, "0")}E01`,
    previousUnavailableReason:
      episode.episode > 1 ? undefined : "Already at the first known episode.",
  };
}
