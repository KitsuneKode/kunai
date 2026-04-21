// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "./Phase";
import type {
  TitleInfo,
  EpisodeInfo,
  StreamInfo,
  PlaybackResult,
} from "../domain/types";

export type PlaybackOutcome = "back_to_search" | "mode_switch" | "quit";

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  async execute(
    title: TitleInfo,
    context: PhaseContext,
  ): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    const {
      shell,
      providerRegistry,
      player,
      stateManager,
      logger,
      historyStore,
      config,
    } = container;

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

        // Resolve stream
        console.log(
          `⏳ Resolving stream from ${stateManager.getState().provider}...`,
        );

        logger.info("Resolving stream", {
          provider: stateManager.getState().provider,
          title: title.name,
          episode: currentEpisode,
        });

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

        stateManager.dispatch({
          type: "SET_PLAYBACK_STATUS",
          status: "loading",
        });

        const stream = await provider.resolveStream({
          title,
          episode: currentEpisode,
          subLang: stateManager.getState().subLang,
        });

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
              await this.playStream(
                fallbackStream,
                title,
                currentEpisode,
                context,
              );
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
        const result = await this.playStream(
          stream,
          title,
          currentEpisode,
          context,
        );

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
        if (
          result.endReason === "eof" &&
          config.autoNext &&
          title.type === "series"
        ) {
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

        const postAction = await openPlaybackShell({
          type: title.type,
          title: title.name,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          provider: stateManager.getState().provider,
          showMemory: false,
          mode: stateManager.getState().mode,
          status: { label: "Ready for next action", tone: "success" },
        });

        if (postAction === "quit") {
          return { status: "cancelled" };
        } else if (postAction === "toggle-mode") {
          const newMode =
            stateManager.getState().mode === "anime" ? "series" : "anime";
          stateManager.dispatch({
            type: "SET_MODE",
            mode: newMode,
            provider: newMode === "anime" ? "allanime" : "vidking",
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
