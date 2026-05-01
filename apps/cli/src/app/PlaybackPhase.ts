// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { routePlaybackShellAction } from "@/app-shell/command-router";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  StreamInfo,
  PlaybackResult,
} from "@/domain/types";
import {
  buildPickerActionContext,
  openSubtitlePicker,
  handleShellAction,
} from "@/app-shell/workflows";
import { resolveCommands } from "@/app-shell/commands";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import {
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";
import {
  createPlaybackSessionState,
  resolveAutoplayAdvanceEpisode,
  resolvePlaybackResultDecision,
  resolvePostPlaybackSessionAction,
  syncPlaybackSessionState,
  type PlaybackSessionState,
} from "@/app/playback-session-controller";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import { createResolveTraceStub } from "@/app/resolve-trace";
import { choosePlaybackSubtitle } from "@/app/subtitle-selection";
import { formatTimestamp } from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import { resolveWithFallback } from "@kunai/core";
import { fetchPlaybackTimingMetadata } from "@/introdb";

export type PlaybackOutcome =
  | "back_to_search"
  | "back_to_results"
  | "mode_switch"
  | "quit"
  | { type: "history_entry"; title: TitleInfo };

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    const {
      providerRegistry,
      stateManager,
      logger,
      historyStore,
      config,
      diagnosticsStore,
      playerControl,
      player,
    } = container;
    const animeEpisodeCatalogByProvider = new Map<
      string,
      readonly EpisodePickerOption[] | undefined
    >();
    const playbackTimingByEpisode = new Map<
      string,
      Awaited<ReturnType<typeof fetchPlaybackTimingMetadata>>
    >();
    let playbackSession: PlaybackSessionState = createPlaybackSessionState({
      autoNextEnabled: config.autoNext,
    });

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
        const playbackTiming = await this.getPlaybackTimingMetadata(
          title,
          currentEpisode,
          playbackTimingByEpisode,
          context.signal,
        );
        const watchedEntries = await historyStore.listByTitle(title.id);
        const currentAnimeEpisodes = await this.getAnimeEpisodeOptions({
          title,
          mode: stateManager.getState().mode,
          provider: currentProvider,
          cache: animeEpisodeCatalogByProvider,
          signal: context.signal,
        });
        const shellEpisodePicker = await buildPlaybackEpisodePickerOptions({
          title,
          currentEpisode,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes: currentAnimeEpisodes,
          watchedEntries,
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
        const resolveTrace = createResolveTraceStub({
          title,
          episode: currentEpisode,
          providerId: currentProvider.metadata.id,
          mode: stateManager.getState().mode,
        });
        diagnosticsStore.record({
          category: "provider",
          message: "Resolve trace started",
          context: {
            trace: resolveTrace,
          },
        });
        const compatibleProviders = providerRegistry.getCompatible(title);
        const resolveResult = await resolveWithFallback<StreamInfo>({
          candidates: compatibleProviders.map((provider) => ({
            providerId: provider.metadata.id,
            preferred: provider.metadata.id === currentProvider.metadata.id,
            resolve: () =>
              provider.resolveStream(
                {
                  title,
                  episode: currentEpisode,
                  subLang: stateManager.getState().subLang,
                },
                context.signal,
              ),
          })),
        });

        stream = resolveResult.stream;
        resolvedProviderId = resolveResult.providerId ?? currentProvider.metadata.id;

        for (const attempt of resolveResult.attempts) {
          diagnosticsStore.record({
            category: "provider",
            message: attempt.stream
              ? "Provider resolve attempt succeeded"
              : "Provider resolve attempt failed",
            context: {
              provider: attempt.providerId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              hasTrace: Boolean(attempt.result?.trace),
              failure: attempt.failure ?? null,
            },
          });
        }

        if (resolvedProviderId !== currentProvider.metadata.id) {
          logger.info("Resolved stream with fallback provider", {
            from: currentProvider.metadata.id,
            fallback: resolvedProviderId,
          });
          stateManager.dispatch({ type: "SET_PROVIDER", provider: resolvedProviderId });
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

        if (stream.providerResolveResult) {
          diagnosticsStore.record({
            category: "provider",
            message: "Provider resolve trace completed",
            context: {
              trace: stream.providerResolveResult.trace,
              streamCandidates: stream.providerResolveResult.streams.length,
              subtitleCandidates: stream.providerResolveResult.subtitles.length,
              cachePolicy: stream.providerResolveResult.cachePolicy,
            },
          });
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
          playbackSession.mode,
        );

        // Save history
        if (shouldPersistHistory(result, playbackTiming)) {
          const historyTimestamp = toHistoryTimestamp(result, playbackTiming);
          await historyStore.save(title.id, {
            title: title.name,
            type: title.type,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            timestamp: historyTimestamp,
            duration: result.duration,
            completed: didPlaybackReachCompletionThreshold(result, playbackTiming),
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

        const playbackControlAction = playerControl.consumeLastAction();
        playbackSession = syncPlaybackSessionState(playbackSession, {
          autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
          stopAfterCurrent: stateManager.getState().stopAfterCurrent,
        });
        const playbackDecision = resolvePlaybackResultDecision({
          result,
          controlAction: playbackControlAction,
          session: playbackSession,
          timing: playbackTiming,
        });
        playbackSession = playbackDecision.session;
        if (playbackDecision.shouldTreatAsInterrupted) {
          stateManager.dispatch({
            type: "SET_SESSION_AUTOPLAY_PAUSED",
            paused: playbackDecision.session.autoplayPaused,
          });
        }
        if (playbackDecision.shouldRefreshSource) {
          pendingStartAt = toHistoryTimestamp(result);
          diagnosticsStore.record({
            category: "playback",
            message: "Refreshing current provider source",
            context: {
              provider: resolvedProviderId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              resumeSeconds: pendingStartAt,
            },
          });
          continue;
        }

        if (playbackDecision.shouldFallbackProvider) {
          pendingStartAt = toHistoryTimestamp(result);
          const fallback = providerRegistry
            .getCompatible(title)
            .find((candidate) => candidate.metadata.id !== resolvedProviderId);

          if (fallback) {
            stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
            diagnosticsStore.record({
              category: "playback",
              message: "Switching to fallback provider after playback control request",
              context: {
                from: resolvedProviderId,
                fallback: fallback.metadata.id,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                resumeSeconds: pendingStartAt,
              },
            });
            continue;
          }

          diagnosticsStore.record({
            category: "playback",
            message: "Fallback playback control requested but no compatible provider was available",
            context: {
              provider: resolvedProviderId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            },
          });
        }

        if (playbackControlAction === "next" && title.type === "series") {
          if (episodeAvailability.nextEpisode) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: episodeAvailability.nextEpisode,
            });
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            playbackSession = {
              ...playbackSession,
              stopAfterCurrent: false,
            };
            continue;
          }
        }

        if (playbackControlAction === "previous" && title.type === "series") {
          if (episodeAvailability.previousEpisode) {
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: episodeAvailability.previousEpisode,
            });
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            playbackSession = {
              ...playbackSession,
              stopAfterCurrent: false,
            };
            continue;
          }
        }

        // Handle post-playback
        const nextEpisode = await resolveAutoplayAdvanceEpisode({
          result,
          title,
          currentEpisode,
          session: playbackSession,
          availability: episodeAvailability,
          timing: playbackTiming,
        });
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
          stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
          playbackSession = {
            ...playbackSession,
            stopAfterCurrent: false,
          };
          continue;
        }

        if (playbackSession.stopAfterCurrent) {
          stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
          playbackSession = {
            ...playbackSession,
            stopAfterCurrent: false,
          };
        }

        await player.releasePersistentSession();

        // Post-playback menu — inner loop so unavailable navigation
        // actions stay in the menu instead of re-resolving the stream.
        const { openPlaybackShell } = await import("../app-shell/ink-shell");
        const shellRuntime = buildShellRuntimeBindings(container);

        postPlayback: while (true) {
          const resumeSeconds = toHistoryTimestamp(result);
          const autoplaySessionPaused = playbackSession.autoplayPaused;
          const canResumePlayback =
            result.endReason !== "eof" &&
            resumeSeconds > 10 &&
            (result.duration <= 0 || resumeSeconds < Math.max(0, result.duration - 5));
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
              autoplayPaused: autoplaySessionPaused,
              showMemory: config.showMemory,
              mode: stateManager.getState().mode,
              resumeLabel: canResumePlayback
                ? `resume ${formatTimestamp(resumeSeconds)}`
                : undefined,
              status: { label: "Ready for next action", tone: "success" },
              footerMode: config.getRaw().footerHints,
              commands: resolveCommands(stateManager.getState(), [
                "search",
                "settings",
                "toggle-mode",
                "provider",
                "history",
                "toggle-autoplay",
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

          const routedAction = await routePlaybackShellAction({
            action: postAction,
            container,
          });

          if (routedAction === "quit") {
            return { status: "quit" };
          } else if (typeof routedAction === "object" && routedAction.type === "history-entry") {
            return {
              status: "success",
              value: { type: "history_entry", title: routedAction.title },
            };
          } else if (routedAction === "mode-switch") {
            return { status: "success", value: "back_to_search" };
          } else if (routedAction === "toggle-autoplay") {
            const playbackAction = resolvePostPlaybackSessionAction(
              "toggle-autoplay",
              playbackSession,
            );
            playbackSession = playbackAction.session;
            stateManager.dispatch({
              type: "SET_SESSION_AUTOPLAY_PAUSED",
              paused: playbackAction.session.autoplayPaused,
            });
            continue postPlayback;
          } else if (routedAction === "resume") {
            pendingStartAt = resumeSeconds;
            const playbackAction = resolvePostPlaybackSessionAction("resume", playbackSession);
            playbackSession = playbackAction.session;
            if (!playbackAction.session.autoplayPaused) {
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
            }
            break postPlayback;
          } else if (routedAction === "replay") {
            const playbackAction = resolvePostPlaybackSessionAction("replay", playbackSession);
            playbackSession = playbackAction.session;
            if (!playbackAction.session.autoplayPaused) {
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
            }
            break postPlayback;
          } else if (routedAction === "back-to-search") {
            return { status: "success", value: "back_to_search" };
          } else if (routedAction === "back-to-results") {
            return { status: "success", value: "back_to_results" };
          } else if (routedAction === "handled") {
            continue postPlayback;
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
          } else {
            return { status: "success", value: "back_to_search" };
          }
        }
      }
    } catch (e) {
      if (context.signal.aborted) {
        return { status: "cancelled" };
      }
      logger.error("Playback phase error", { error: String(e) });
      return {
        status: "error",
        error: {
          code: "PLAYER_FAILED",
          message: String(e),
          retryable: false,
        },
      };
    } finally {
      await player.releasePersistentSession();
    }

    // Fallback return (should not reach here)
    return { status: "success", value: "back_to_search" };
  }

  private async getPlaybackTimingMetadata(
    title: TitleInfo,
    episode: EpisodeInfo,
    cache: Map<string, Awaited<ReturnType<typeof fetchPlaybackTimingMetadata>>>,
    signal?: AbortSignal,
  ) {
    const cacheKey =
      title.type === "movie"
        ? `movie:${title.id}`
        : `series:${title.id}:${episode.season}:${episode.episode}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const timing = await fetchPlaybackTimingMetadata({
      tmdbId: title.id,
      type: title.type,
      season: title.type === "series" ? episode.season : undefined,
      episode: title.type === "series" ? episode.episode : undefined,
      signal,
    });
    cache.set(cacheKey, timing);
    return timing;
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
          context.container,
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
    playbackMode: "manual" | "autoplay-chain" = "manual",
  ): Promise<PlaybackResult> {
    const { player, stateManager } = context.container;

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;
    const subtitleStatus = describeSubtitleStatus(stream, stateManager.getState().subLang);

    try {
      const result = await player.play(stream, {
        url: stream.url,
        headers: stream.headers,
        subtitle: stream.subtitle,
        subtitleStatus,
        displayTitle,
        startAt,
        attach: false,
        playbackMode,
        onPlayerReady: () => {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });
        },
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
    signal,
  }: {
    title: TitleInfo;
    mode: "series" | "anime";
    provider: import("../services/providers/Provider").Provider | undefined;
    cache: Map<string, readonly EpisodePickerOption[] | undefined>;
    signal?: AbortSignal;
  }): Promise<readonly EpisodePickerOption[] | undefined> {
    const cacheKey = provider?.metadata.id;
    if (cacheKey && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = await this.loadAnimeEpisodeOptions(title, mode, provider, signal);
    if (cacheKey) {
      cache.set(cacheKey, result);
    }
    return result;
  }

  private async loadAnimeEpisodeOptions(
    title: TitleInfo,
    mode: "series" | "anime",
    provider: import("../services/providers/Provider").Provider | undefined,
    signal?: AbortSignal,
  ): Promise<readonly EpisodePickerOption[] | undefined> {
    if (mode !== "anime" || title.type !== "series" || !provider?.listEpisodes) {
      return undefined;
    }

    try {
      return (await provider.listEpisodes({ title }, signal)) ?? undefined;
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
