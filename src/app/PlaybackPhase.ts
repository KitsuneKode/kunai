// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  StreamInfo,
  PlaybackResult,
} from "@/domain/types";
import { handleShellAction, openSubtitlePicker } from "@/app-shell/workflows";
import { choosePlaybackSubtitle } from "@/app/subtitle-selection";

export type PlaybackOutcome = "back_to_search" | "mode_switch" | "quit";

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    const { providerRegistry, stateManager, logger, historyStore, config } = container;

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;
      const provider = providerRegistry.get(stateManager.getState().provider);
      const animeEpisodes = await this.loadAnimeEpisodeOptions(
        title,
        stateManager.getState().mode,
        provider,
      );

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

        // Session-flow owns the current season/episode selection rules until the
        // mounted root shell fully absorbs the picker stack.
        const { chooseStartingEpisode } = await import("../session-flow");
        const selection = await chooseStartingEpisode({
          currentId: title.id,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes,
          flags: {},
          getHistoryEntry: () => Promise.resolve(history),
        });

        if (!selection) {
          logger.info("Episode selection cancelled before playback", {
            titleId: title.id,
            mode: stateManager.getState().mode,
          });
          return { status: "success", value: "back_to_search" };
        }

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
              const preparedFallback = await this.preparePlaybackStream(
                fallbackStream,
                title,
                currentEpisode,
                context,
              );
              stateManager.dispatch({
                type: "SET_STREAM",
                stream: preparedFallback,
              });
              stateManager.dispatch({
                type: "SET_PLAYBACK_STATUS",
                status: "ready",
              });
              await this.playStream(preparedFallback, title, currentEpisode, context);
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

        const preparedStream = await this.preparePlaybackStream(
          stream,
          title,
          currentEpisode,
          context,
        );
        stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });

        // Play in MPV
        const result = await this.playStream(preparedStream, title, currentEpisode, context);

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
          subtitleStatus: describeSubtitleStatus(preparedStream, stateManager.getState().subLang),
          showMemory: false,
          mode: stateManager.getState().mode,
          status: { label: "Ready for next action", tone: "success" },
          commands: resolveCommands(stateManager.getState(), [
            "settings",
            "toggle-mode",
            "provider",
            "history",
            "replay",
            "pick-episode",
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
        } else if (postAction === "pick-episode" && title.type === "series") {
          const { chooseEpisodeFromMetadata } = await import("../session-flow");
          const selection = await chooseEpisodeFromMetadata({
            currentId: title.id,
            isAnime: stateManager.getState().mode === "anime",
            currentSeason: currentEpisode.season,
            currentEpisode: currentEpisode.episode,
            animeEpisodeCount: title.episodeCount,
            animeEpisodes,
          });
          // Cancel keeps the user in the post-playback menu instead of mutating
          // the current episode or restarting playback implicitly.
          if (!selection) {
            logger.info("Episode picker cancelled", {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            });
            continue;
          }
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: {
              season: selection.season,
              episode: selection.episode,
            },
          });
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
          await handleShellAction({ action: "provider", container });
          continue;
        } else if (
          postAction === "settings" ||
          postAction === "history" ||
          postAction === "diagnostics" ||
          postAction === "help" ||
          postAction === "about"
        ) {
          const actionResult = await handleShellAction({
            action: postAction,
            container,
          });
          if (actionResult === "quit") {
            return { status: "cancelled" };
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

  private async preparePlaybackStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
  ): Promise<StreamInfo> {
    const { stateManager, logger } = context.container;
    const subLang = stateManager.getState().subLang;
    const subtitleDecision = await choosePlaybackSubtitle({
      stream,
      subLang,
      pickSubtitle: (tracks) => openSubtitlePicker(tracks),
    });

    logger.info("Subtitle resolution", {
      provider: stateManager.getState().provider,
      titleId: title.id,
      type: title.type,
      season: episode.season,
      episode: episode.episode,
      requestedSubLang: subLang,
      subtitleReason: subtitleDecision.reason,
      availableTracks: subtitleDecision.availableTracks,
      subtitleSelected: subtitleDecision.subtitle ?? null,
    });

    return {
      ...stream,
      subtitle: subtitleDecision.subtitle ?? undefined,
    };
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

  private async loadAnimeEpisodeOptions(
    title: TitleInfo,
    mode: "series" | "anime",
    provider: import("../services/providers/Provider").Provider | undefined,
  ): Promise<readonly EpisodePickerOption[] | undefined> {
    if (mode !== "anime" || title.type !== "series" || !provider?.listEpisodes) {
      return undefined;
    }

    try {
      return (await provider.listEpisodes({ title })) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function describeSubtitleStatus(stream: StreamInfo, subLang: string): string {
  if (subLang === "none") {
    return "subtitles disabled";
  }

  if (stream.subtitle) {
    return `subtitle attached`;
  }

  if (stream.subtitleList?.length) {
    return `${stream.subtitleList.length} subtitle tracks available`;
  }

  return "subtitles not found";
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
