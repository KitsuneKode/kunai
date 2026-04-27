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
import { buildPickerActionContext, openSubtitlePicker, handleShellAction } from "@/app-shell/workflows";
import { resolveCommands } from "@/app-shell/commands";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import { switchSessionMode } from "@/app/mode-switch";
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
      let pendingStartAt = 0;
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
        pendingStartAt = selection.startAt ?? 0;
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

        stateManager.dispatch({
          type: "SET_PLAYBACK_STATUS",
          status: "loading",
        });

        let stream: StreamInfo | null = null;
        let resolvedProviderId = currentProvider.metadata.id;
        try {
          stream = await currentProvider.resolveStream({
            title,
            episode: currentEpisode,
            subLang: stateManager.getState().subLang,
          });
        } catch (e) {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
          throw e;
        }

        if (!stream) {
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

          // Try fallback provider — update loading in-place to avoid shell flicker
          const compatible = providerRegistry
            .getCompatible(title)
            .filter(
              (p: import("../services/providers/Provider").Provider) =>
                p.metadata.id !== currentProvider.metadata.id,
            );

          const fallback = compatible[0];
          if (fallback) {
            logger.info("Trying fallback provider", { fallback: fallback.metadata.id });
            diagnosticsStore.record({
              category: "provider",
              message: "Trying fallback provider",
              context: {
                from: currentProvider.metadata.id,
                fallback: fallback.metadata.id,
              },
            });
            stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
            try {
              const fallbackStream = await fallback.resolveStream({
                title,
                episode: currentEpisode,
                subLang: stateManager.getState().subLang,
              });
              if (fallbackStream) {
                stream = fallbackStream;
                resolvedProviderId = fallback.metadata.id;
              }
            } catch (e) {
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              throw e;
            }
          }
        }

        if (!stream) {
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

        // Play in MPV — consume the pending resume position on the first play only.
        // Pass loading handle so playStream can update it in-place (no shell flicker).
        const startAt = pendingStartAt;
        pendingStartAt = 0;
        const result = await this.playStream(
          preparedStream,
          title,
          currentEpisode,
          context,
          startAt,
        );

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
            provider: resolvedProviderId,
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

          const { openLoadingShell } = await import("../app-shell/ink-shell");
          const countdownShell = openLoadingShell({
            state: {
              title: "Auto-Next",
              subtitle: `Next up: ${nextEpisode.name || `Episode ${nextEpisode.episode}`}`,
              operation: "loading",
              details: "Starting in 5 seconds... (Press ESC to cancel)",
              cancellable: true,
            },
            cancellable: true,
          });

          let cancelled = false;
          let secondsLeft = 5;

          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              secondsLeft--;
              if (secondsLeft <= 0) {
                clearInterval(interval);
                countdownShell.close();
                resolve();
              } else {
                countdownShell.update({
                  title: "Auto-Next",
                  subtitle: `Next up: ${nextEpisode.name || `Episode ${nextEpisode.episode}`}`,
                  operation: "loading",
                  details: `Starting in ${secondsLeft} seconds... (Press ESC to cancel)`,
                  cancellable: true,
                });
              }
            }, 1000);

            countdownShell.result.then((res) => {
              if (res === "cancelled") {
                cancelled = true;
                clearInterval(interval);
                resolve();
              }
            });
          });

          if (!cancelled) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: nextEpisode,
            });
            continue;
          }
        }

        // Post-playback menu — inner loop so unavailable navigation
        // actions stay in the menu instead of re-resolving the stream.
        const { openPlaybackShell } = await import("../app-shell/ink-shell");
        const shellRuntime = buildShellRuntimeBindings(container);

        postPlayback: while (true) {
          const postAction = await openPlaybackShell({
            state: {
              type: title.type,
              title: title.name,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              posterUrl: title.posterUrl,
              provider: resolvedProviderId,
              subtitleStatus: describeSubtitleStatus(
                preparedStream,
                stateManager.getState().subLang,
              ),
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
              episode: { season: postAction.season, episode: postAction.episode },
            });
            break postPlayback;
          }

          if (postAction === "quit") {
            return { status: "quit" };
          } else if (postAction === "toggle-mode") {
            switchSessionMode(stateManager);
            return { status: "success", value: "back_to_search" };
          } else if (postAction === "replay") {
            break postPlayback;
          } else if (postAction === "clear-cache" || postAction === "clear-history") {
            await handleShellAction({ action: postAction, container });
            continue postPlayback;
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
            if (!selection) {
              logger.info("Episode picker cancelled", {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              });
              continue postPlayback;
            }
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: { season: selection.season, episode: selection.episode },
            });
            break postPlayback;
          } else if (postAction === "next" && title.type === "series") {
            if (episodeAvailability.nextEpisode) {
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: episodeAvailability.nextEpisode,
              });
              break postPlayback;
            }
            continue postPlayback;
          } else if (postAction === "previous" && title.type === "series") {
            if (episodeAvailability.previousEpisode) {
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: episodeAvailability.previousEpisode,
              });
              break postPlayback;
            }
            continue postPlayback;
          } else if (postAction === "next-season" && title.type === "series") {
            if (episodeAvailability.nextSeasonEpisode) {
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: episodeAvailability.nextSeasonEpisode,
              });
              break postPlayback;
            }
            continue postPlayback;
          } else if (postAction === "search") {
            return { status: "success", value: "back_to_search" };
          } else if (postAction === "back-to-results") {
            return { status: "success", value: "back_to_results" };
          } else {
            return { status: "success", value: "back_to_search" };
          }
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
      providerSubtitleSource: stream.subtitleSource ?? "none",
      providerSubtitleEvidence: stream.subtitleEvidence ?? null,
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
        providerSubtitleSource: stream.subtitleSource ?? "none",
        providerSubtitleEvidence: stream.subtitleEvidence ?? null,
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
    startAt = 0,
  ): Promise<PlaybackResult> {
    const { player, stateManager } = context.container;

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;
    const subtitleStatus = describeSubtitleStatus(stream, stateManager.getState().subLang);

    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });

    try {
      const result = await player.play(stream, {
        url: stream.url,
        headers: stream.headers,
        subtitle: stream.subtitle,
        subtitleStatus,
        displayTitle,
        startAt,
        attach: false,
      });

      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });
      return result;
    } finally {
      // resolved via status update
    }
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
