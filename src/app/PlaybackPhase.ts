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
import { buildPickerActionContext, openSubtitlePicker } from "@/app-shell/workflows";
import { resolveCommands } from "@/app-shell/commands";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import {
  getAutoAdvanceEpisode,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import { choosePlaybackSubtitle } from "@/app/subtitle-selection";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";

export type PlaybackOutcome = "back_to_search" | "back_to_results" | "mode_switch" | "quit";

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    const { providerRegistry, stateManager, logger, historyStore, config, diagnosticsStore } =
      container;
    const animeEpisodeCatalogByProvider = new Map<
      string,
      readonly EpisodePickerOption[] | undefined
    >();

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;
      const provider = providerRegistry.get(stateManager.getState().provider);
      const initialAnimeEpisodes = await this.getAnimeEpisodeOptions({
        title,
        mode: stateManager.getState().mode,
        provider,
        cache: animeEpisodeCatalogByProvider,
      });
      logger.info("Episode selection metadata", {
        titleId: title.id,
        mode: stateManager.getState().mode,
        provider: stateManager.getState().provider,
        episodeCount: title.episodeCount ?? null,
        animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
      });
      diagnosticsStore.record({
        category: "provider",
        message: "Episode selection metadata",
        context: {
          titleId: title.id,
          mode: stateManager.getState().mode,
          provider: stateManager.getState().provider,
          episodeCount: title.episodeCount ?? null,
          animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
        },
      });

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
        const { chooseStartingEpisode } = await import("@/session-flow");
        const selection = await chooseStartingEpisode({
          currentId: title.id,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes: initialAnimeEpisodes,
          flags: {},
          getHistoryEntry: () => Promise.resolve(history),
          container,
        });

        if (!selection) {
          logger.info("Episode selection cancelled before playback", {
            titleId: title.id,
            mode: stateManager.getState().mode,
          });
          return { status: "success", value: "back_to_results" };
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

        const currentProvider = providerRegistry.get(stateManager.getState().provider);
        const currentAnimeEpisodes = await this.getAnimeEpisodeOptions({
          title,
          mode: stateManager.getState().mode,
          provider: currentProvider,
          cache: animeEpisodeCatalogByProvider,
        });
        const shellEpisodePicker = await buildPlaybackEpisodePickerOptions({
          title,
          currentEpisode,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes: currentAnimeEpisodes,
        });
        const episodeAvailability = await resolveEpisodeAvailability({
          title,
          currentEpisode,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes: currentAnimeEpisodes,
          loaders: {
            loadSeasons: fetchSeasons,
            loadEpisodes: fetchEpisodes,
          },
        });

        stateManager.dispatch({
          type: "SET_EPISODE_NAVIGATION",
          navigation: toEpisodeNavigationState(title.type, episodeAvailability),
        });

        // Resolve stream with loading UI
        if (!currentProvider) {
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
          stream = await currentProvider.resolveStream({
            title,
            episode: currentEpisode,
            subLang: stateManager.getState().subLang,
          });
        } finally {
          loading.close();
          await loading.result;
        }

        if (!stream) {
          console.log(`⚠ Stream not found on ${currentProvider.metadata.id}`);
          logger.error("Stream not found", { provider: currentProvider.metadata.id });
          diagnosticsStore.record({
            category: "provider",
            message: "Stream not found",
            context: {
              provider: currentProvider.metadata.id,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            },
          });

          // Try fallback provider
          const compatible = providerRegistry
            .getCompatible(title)
            .filter(
              (p: import("../services/providers/Provider").Provider) =>
                p.metadata.id !== currentProvider.metadata.id,
            );

          const fallback = compatible[0];
          if (fallback) {
            console.log(`🔄 Trying fallback: ${fallback.metadata.id}...`);
            logger.info("Trying fallback provider", {
              fallback: fallback.metadata.id,
            });
            diagnosticsStore.record({
              category: "provider",
              message: "Trying fallback provider",
              context: {
                from: currentProvider.metadata.id,
                fallback: fallback.metadata.id,
              },
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
              provider: currentProvider.metadata.id,
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
        if (shouldPersistHistory(result)) {
          const historyTimestamp = toHistoryTimestamp(result);
          await historyStore.save(title.id, {
            title: title.name,
            type: title.type,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            timestamp: historyTimestamp,
            duration: result.duration,
            provider: stateManager.getState().provider,
            watchedAt: new Date().toISOString(),
          });
        } else {
          diagnosticsStore.record({
            category: "playback",
            message: "Skipped history save",
            context: {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              watchedSeconds: result.watchedSeconds,
              duration: result.duration,
              endReason: result.endReason,
            },
          });
        }

        // Handle post-playback
        const nextEpisode = await getAutoAdvanceEpisode(
          result,
          title,
          currentEpisode,
          config.autoNext,
          episodeAvailability,
        );
        if (nextEpisode) {
          logger.info("Auto-next advancing to next episode", {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            nextSeason: nextEpisode.season,
            nextEpisode: nextEpisode.episode,
          });
          diagnosticsStore.record({
            category: "playback",
            message: "Auto-next advancing to next episode",
            context: {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              nextSeason: nextEpisode.season,
              nextEpisode: nextEpisode.episode,
            },
          });
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: nextEpisode,
          });
          continue;
        }

        // Show post-playback menu
        const { openPlaybackShell } = await import("../app-shell/ink-shell");

        const shellRuntime = buildShellRuntimeBindings(container);
        const postAction = await openPlaybackShell({
          state: {
            type: title.type,
            title: title.name,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            provider: stateManager.getState().provider,
            subtitleStatus: describeSubtitleStatus(preparedStream, stateManager.getState().subLang),
            showMemory: config.showMemory,
            mode: stateManager.getState().mode,
            status: { label: "Ready for next action", tone: "success" },
            footerMode: config.getRaw().footerHints,
            commands: resolveCommands(stateManager.getState(), [
              "search",
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
          },
          providerOptions: shellRuntime.providerOptions,
          episodePickerOptions: shellEpisodePicker.options,
          episodePickerSubtitle: shellEpisodePicker.subtitle,
          settings: shellRuntime.settings,
          settingsSeriesProviderOptions: shellRuntime.settingsSeriesProviderOptions,
          settingsAnimeProviderOptions: shellRuntime.settingsAnimeProviderOptions,
          onChangeProvider: shellRuntime.onChangeProvider,
          onSaveSettings: shellRuntime.onSaveSettings,
          loadHelpPanel: shellRuntime.loadHelpPanel,
          loadAboutPanel: shellRuntime.loadAboutPanel,
          loadDiagnosticsPanel: shellRuntime.loadDiagnosticsPanel,
          loadHistoryPanel: shellRuntime.loadHistoryPanel,
        });

        if (typeof postAction !== "string") {
          stateManager.dispatch({
            type: "SELECT_EPISODE",
            episode: {
              season: postAction.season,
              episode: postAction.episode,
            },
          });
          continue;
        }

        if (postAction === "quit") {
          return { status: "quit" };
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
          const { chooseEpisodeFromMetadata } = await import("@/session-flow");
          const selection = await chooseEpisodeFromMetadata({
            currentId: title.id,
            isAnime: stateManager.getState().mode === "anime",
            currentSeason: currentEpisode.season,
            currentEpisode: currentEpisode.episode,
            animeEpisodeCount: title.episodeCount,
            animeEpisodes: currentAnimeEpisodes,
            container,
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
          if (episodeAvailability.nextEpisode) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: episodeAvailability.nextEpisode,
            });
          }
          continue;
        } else if (postAction === "previous" && title.type === "series") {
          if (episodeAvailability.previousEpisode) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: episodeAvailability.previousEpisode,
            });
          }
          continue;
        } else if (postAction === "next-season" && title.type === "series") {
          if (episodeAvailability.nextSeasonEpisode) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: episodeAvailability.nextSeasonEpisode,
            });
          }
          continue;
        } else if (postAction === "search") {
          return { status: "success", value: "back_to_search" };
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
      pickSubtitle: (tracks) =>
        openSubtitlePicker(
          tracks,
          buildPickerActionContext({
            container: context.container,
            taskLabel: "Choose subtitles",
          }),
        ),
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
    context.container.diagnosticsStore.record({
      category: "subtitle",
      message: "Subtitle resolution",
      context: {
        provider: stateManager.getState().provider,
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang: subLang,
        subtitleReason: subtitleDecision.reason,
        availableTracks: subtitleDecision.availableTracks,
        subtitleSelected: subtitleDecision.subtitle ?? null,
      },
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
    const { player, stateManager } = context.container;

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
      attach: false,
    });

    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });

    return result;
  }

  private async getAnimeEpisodeOptions({
    title,
    mode,
    provider,
    cache,
  }: {
    title: TitleInfo;
    mode: "series" | "anime";
    provider: import("../services/providers/Provider").Provider | undefined;
    cache: Map<string, readonly EpisodePickerOption[] | undefined>;
  }): Promise<readonly EpisodePickerOption[] | undefined> {
    const cacheKey = provider?.metadata.id;
    if (cacheKey && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = await this.loadAnimeEpisodeOptions(title, mode, provider);
    if (cacheKey) {
      cache.set(cacheKey, result);
    }
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
