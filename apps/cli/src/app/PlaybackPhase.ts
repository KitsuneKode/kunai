// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import { routePlaybackShellAction } from "@/app-shell/command-router";
import { resolveCommands } from "@/app-shell/commands";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import {
  buildPickerActionContext,
  openSubtitlePicker,
  handleShellAction,
} from "@/app-shell/workflows";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
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
import { createResolveTraceStub } from "@/app/resolve-trace";
import { choosePlaybackSubtitle } from "@/app/subtitle-selection";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  StreamInfo,
  PlaybackResult,
  SubtitleTrack,
} from "@/domain/types";
import {
  classifyPlaybackFailureFromEvent,
  recoveryForPlaybackFailure,
} from "@/infra/player/playback-failure-classifier";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { fetchPlaybackTimingMetadata } from "@/introdb";
import { formatTimestamp } from "@/services/persistence/HistoryStore";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import { resolveWithFallback } from "@kunai/core";

export type PlaybackOutcome =
  | "back_to_search"
  | "back_to_results"
  | "mode_switch"
  | "quit"
  | { type: "history_entry"; title: TitleInfo };

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private updatePlaybackFeedback(
    context: PhaseContext,
    feedback: { detail?: string | null; note?: string | null },
  ) {
    context.container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      detail: feedback.detail,
      note: feedback.note,
    });
  }

  private describePlayerEvent(event: PlayerPlaybackEvent): {
    detail?: string | null;
    note?: string | null;
  } {
    switch (event.type) {
      case "launching-player":
        return { detail: "Launching player" };
      case "mpv-process-started":
        return { detail: "mpv launched" };
      case "ipc-connected":
        return { detail: "Player control connected" };
      case "ipc-command-failed":
        return {
          note: `Player command failed: ${event.command} (${event.error})`,
        };
      case "ipc-stalled":
        return {
          detail: "Player control stalled",
          note: `mpv did not answer ${event.command}; playback may still be alive`,
        };
      case "opening-stream":
        return { detail: "Opening provider stream" };
      case "resolving-playback":
        return { detail: "Resolving playback" };
      case "network-buffering": {
        const cacheAhead =
          typeof event.cacheAheadSeconds === "number"
            ? `${event.cacheAheadSeconds.toFixed(1)}s cached ahead`
            : null;
        const percent = typeof event.percent === "number" ? `${Math.round(event.percent)}%` : null;
        const recovery = recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event));
        const status =
          [percent, cacheAhead].filter(Boolean).join(" / ") || "mpv is filling HLS cache";
        return {
          detail: "Network buffering",
          note: `${status} · ${recovery.label}`,
        };
      }
      case "subtitle-inventory-ready":
        return {
          detail: "Attaching subtitles",
          note:
            event.trackCount > 0
              ? `${event.trackCount} alternate subtitle tracks are ready in mpv`
              : "Primary subtitle is ready",
        };
      case "subtitle-attached":
        return {
          note:
            event.trackCount > 0
              ? `${event.trackCount} subtitle tracks attached`
              : "Primary subtitle attached",
        };
      case "late-subtitles-attached":
        return {
          note: `${event.trackCount} late subtitle ${event.trackCount === 1 ? "track" : "tracks"} attached`,
        };
      case "player-ready":
        return { detail: "Player controls ready" };
      case "playback-started":
        return { detail: "Playing" };
      case "stream-stalled":
        return {
          detail: "Stream stalled",
          note: `No playback progress for ${event.secondsWithoutProgress}s · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      case "seek-stalled":
        return {
          detail: "Seek stalled",
          note: `mpv has been seeking for ${event.secondsSeeking}s · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      case "player-closing":
        return { detail: "Closing player" };
      case "player-closed":
        return { detail: "Player closed" };
      case "segment-skipped":
        return {
          note: `${event.kind.charAt(0).toUpperCase()}${event.kind.slice(1)} ${event.automatic ? "skipped automatically" : "skipped"}`,
        };
    }
  }

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
      workControl,
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

        const resolveController = new AbortController();
        const abortOnSessionStop = () => resolveController.abort();
        context.signal.addEventListener("abort", abortOnSessionStop, { once: true });
        workControl.setActive({
          id: `playback-resolve:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
          label: `${title.name} S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`,
          cancel: () => resolveController.abort(),
        });

        try {
          const currentProvider = providerRegistry.get(stateManager.getState().provider);

          // Kick off timing fetch in parallel with everything else — IntroDB is a
          // lightweight API call and should resolve well before the Playwright scrape.
          const timingFetch = this.getPlaybackTimingMetadata(
            title,
            currentEpisode,
            playbackTimingByEpisode,
            resolveController.signal,
          );

          const watchedEntries = await historyStore.listByTitle(title.id);
          const currentAnimeEpisodes = await this.getAnimeEpisodeOptions({
            title,
            mode: stateManager.getState().mode,
            provider: currentProvider,
            cache: animeEpisodeCatalogByProvider,
            signal: resolveController.signal,
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
          this.updatePlaybackFeedback(context, {
            detail: "Resolving provider stream",
            note: "Esc cancels this resolve and returns to results",
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
            candidates: compatibleProviders.map((p) => ({
              providerId: p.metadata.id,
              preferred: p.metadata.id === currentProvider.metadata.id,
              resolve: () =>
                p.resolveStream(
                  {
                    title,
                    episode: currentEpisode,
                    subLang: stateManager.getState().subLang,
                  },
                  resolveController.signal,
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

          // Await timing — stream resolve takes much longer so this is nearly free.
          // If IntroDB timed out and returned null, schedule a background retry that
          // injects timing into the running player once it arrives.
          const playbackTiming = await timingFetch;
          // effectiveTiming.current tracks the best timing we have — updated in-place
          // if the background retry resolves while the episode is playing, so all
          // post-playback decisions (history, autoNext, result classification) use it.
          const effectiveTiming = { current: playbackTiming };
          if (!playbackTiming) {
            void this.retryTimingInBackground(title, currentEpisode, container, effectiveTiming);
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
            playbackTiming,
          );

          // Save history — use effectiveTiming.current so that a background retry
          // that completed during playback is reflected in completion status.
          if (shouldPersistHistory(result, effectiveTiming.current)) {
            const historyTimestamp = toHistoryTimestamp(result, effectiveTiming.current);
            await historyStore.save(title.id, {
              title: title.name,
              type: title.type,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              timestamp: historyTimestamp,
              duration: result.duration,
              completed: didPlaybackReachCompletionThreshold(result, effectiveTiming.current),
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
            timing: effectiveTiming.current,
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
              message:
                "Fallback playback control requested but no compatible provider was available",
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
            timing: effectiveTiming.current,
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
          this.updatePlaybackFeedback(context, { detail: null, note: null });

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
        } catch (e) {
          if (resolveController.signal.aborted && !context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
            this.updatePlaybackFeedback(context, { detail: null, note: null });
            diagnosticsStore.record({
              category: "playback",
              message: "Playback resolve cancelled",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
            return { status: "success", value: "back_to_results" };
          }
          throw e;
        } finally {
          workControl.setActive(null);
          context.signal.removeEventListener("abort", abortOnSessionStop);
        }
      }
    } catch (e) {
      if (context.signal.aborted) {
        this.updatePlaybackFeedback(context, { detail: null, note: null });
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
      this.updatePlaybackFeedback(context, { detail: null, note: null });
      await player.releasePersistentSession();
    }

    // Fallback return (should not reach here)
    return { status: "success", value: "back_to_search" };
  }

  private retryTimingInBackground(
    title: TitleInfo,
    episode: EpisodeInfo,
    container: PhaseContext["container"],
    timingRef?: { current: Awaited<ReturnType<typeof fetchPlaybackTimingMetadata>> },
  ): Promise<void> {
    return (async () => {
      try {
        const timing = await fetchPlaybackTimingMetadata({
          tmdbId: title.id,
          type: title.type,
          season: title.type === "series" ? episode.season : undefined,
          episode: title.type === "series" ? episode.episode : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        if (timing) {
          if (timingRef) timingRef.current = timing;
          container.playerControl.updateCurrentPlaybackTiming(timing, "background-retry");
        }
      } catch {
        // background retry failed silently
      }
    })();
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
    timing: Awaited<ReturnType<typeof fetchPlaybackTimingMetadata>> = null,
  ): Promise<PlaybackResult> {
    const { player, stateManager, config } = context.container;

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;
    const subtitleStatus = describeSubtitleStatus(stream, stateManager.getState().subLang);

    try {
      this.updatePlaybackFeedback(context, {
        detail: "Launching player",
        note: subtitleStatus,
      });
      this.startLateSubtitleResolver({
        stream,
        title,
        episode,
        context,
      });
      const result = await player.play(stream, {
        url: stream.url,
        headers: stream.headers,
        subtitle: stream.subtitle,
        subtitleStatus,
        displayTitle,
        startAt,
        attach: false,
        playbackMode,
        timing,
        skipRecap: config.skipRecap,
        skipIntro: config.skipIntro,
        skipPreview: config.skipPreview,
        skipCredits: config.skipCredits,
        onPlaybackEvent: (event) => {
          this.updatePlaybackFeedback(context, this.describePlayerEvent(event));
          if (event.type === "network-buffering") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "buffering" });
          } else if (event.type === "stream-stalled" || event.type === "ipc-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "stalled" });
          } else if (event.type === "seek-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "seeking" });
          } else if (event.type === "playback-started") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });
          }
        },
        onPlayerReady: () => {
          this.updatePlaybackFeedback(context, {
            detail: "Player controls ready",
          });
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
        },
      });

      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });
      return result;
    } finally {
      // resolved via status update
    }
  }

  private startLateSubtitleResolver({
    stream,
    title,
    episode,
    context,
  }: {
    stream: StreamInfo;
    title: TitleInfo;
    episode: EpisodeInfo;
    context: PhaseContext;
  }): void {
    const { stateManager, diagnosticsStore, logger } = context.container;
    const requestedSubLang = stateManager.getState().subLang;
    if (
      requestedSubLang === "none" ||
      stream.subtitle ||
      stream.subtitleList?.length ||
      !title.id
    ) {
      return;
    }

    diagnosticsStore.record({
      category: "subtitle",
      message: "Late subtitle lookup started",
      context: {
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang,
      },
    });

    void (async () => {
      try {
        const result = await resolveSubtitlesByTmdbId({
          tmdbId: title.id,
          type: title.type,
          season: title.type === "series" ? episode.season : undefined,
          episode: title.type === "series" ? episode.episode : undefined,
          preferredLang: requestedSubLang,
        });

        if (context.signal.aborted) return;
        if (result.list.length === 0) {
          diagnosticsStore.record({
            category: "subtitle",
            message: result.failed ? "Late subtitle lookup failed" : "Late subtitle lookup empty",
            context: {
              titleId: title.id,
              requestedSubLang,
              failed: result.failed,
            },
          });
          return;
        }

        const mergedSubtitleList = mergeSubtitleTracks(
          stream.subtitleList,
          result.list as unknown as SubtitleTrack[],
        );
        const selected = selectSubtitle(mergedSubtitleList as never, requestedSubLang);
        const selectedUrl = selected?.url ?? result.selected ?? null;
        if (!selectedUrl) {
          diagnosticsStore.record({
            category: "subtitle",
            message: "Late subtitle lookup found tracks but no selectable URL",
            context: { titleId: title.id, trackCount: mergedSubtitleList.length },
          });
          return;
        }

        const attached = await this.attachLateSubtitlesWhenPlayerReady(context, {
          primarySubtitle: selectedUrl,
          subtitleTracks: mergedSubtitleList,
        });
        if (!attached) return;

        const currentState = stateManager.getState();
        if (
          currentState.currentTitle?.id === title.id &&
          currentState.currentEpisode?.season === episode.season &&
          currentState.currentEpisode?.episode === episode.episode
        ) {
          stateManager.dispatch({
            type: "SET_STREAM",
            stream: {
              ...stream,
              subtitle: selectedUrl,
              subtitleList: mergedSubtitleList,
              subtitleSource: "wyzie",
              subtitleEvidence: {
                directSubtitleObserved: Boolean(stream.subtitleList?.length),
                wyzieSearchObserved: true,
                reason: "wyzie-selected",
              },
            },
          });
        }

        diagnosticsStore.record({
          category: "subtitle",
          message: "Late subtitle lookup attached tracks",
          context: {
            titleId: title.id,
            selected: selectedUrl,
            trackCount: mergedSubtitleList.length,
          },
        });
      } catch (error) {
        if (context.signal.aborted) return;
        logger.warn("Late subtitle lookup failed", { error: String(error) });
        diagnosticsStore.record({
          category: "subtitle",
          message: "Late subtitle lookup failed",
          context: { titleId: title.id, error: String(error) },
        });
      }
    })();
  }

  private async attachLateSubtitlesWhenPlayerReady(
    context: PhaseContext,
    attachment: {
      primarySubtitle: string;
      subtitleTracks: readonly SubtitleTrack[];
    },
  ): Promise<boolean> {
    const deadline = Date.now() + 30_000;
    while (!context.signal.aborted && Date.now() < deadline) {
      if (context.container.playerControl.getActive()) {
        const attached = await context.container.playerControl.attachLateSubtitles(
          attachment,
          "late-subtitle-resolver",
        );
        if (attached) return true;
      }
      await Bun.sleep(250);
    }
    return false;
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
