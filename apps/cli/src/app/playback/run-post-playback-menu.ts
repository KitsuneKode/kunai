// Post-playback menu inner loop — extracted from PlaybackPhase.execute() so the
// outer episode loop can call a single function and act on its directive.
import { resolveCommandContext } from "@/app-shell/commands";
import { shouldAutoPresentTitleControlForPostPlay } from "@/app-shell/title-control/title-control-post-play";
import type { PlaybackShellResult, PlaybackShellState, ShellAction } from "@/app-shell/types";
import {
  openTracksPanel,
  handleShellAction,
  enqueueCurrentPlaybackDownload,
} from "@/app-shell/workflows";
import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import type { EpisodePrefetchTarget } from "@/app/playback/episode-prefetch";
import { buildEpisodeNavigationTransitionContext } from "@/app/playback/playback-episode-navigation";
import type { PlaybackIteration } from "@/app/playback/playback-iteration";
import type { PlaybackOutcome } from "@/app/playback/playback-outcome";
import {
  canAutoContinueIntoRecommendation,
  canResumePlayback as resolveCanResumePlayback,
  isNearEndVoluntaryQuit,
} from "@/app/playback/playback-postplay-policy";
import { alignPostPlayProviderRestart } from "@/app/playback/playback-provider-align";
import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import {
  enqueuePostPlaybackRecommendation,
  openPostPlaybackRecommendationActionPanel,
  recommendationRailItemToSearchResult,
} from "@/app/playback/playback-recommendation-actions";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import {
  resolvePostPlaybackSessionAction,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  type PlaybackStartIntent,
} from "@/app/playback/playback-start-intent";
import {
  evaluateAutoAdvanceNextUp,
  type AutoAdvanceGuards,
} from "@/app/playback/policies/auto-advance-policy";
import { streamSelectionFromTrackPick } from "@/app/playback/source-quality";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import { describePlaybackSubtitleStatus } from "@/app/playback/subtitle-status";
import { buildTrackPickTransitionContext } from "@/app/playback/tracks-panel-pick";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import {
  buildPostPlayEpisodeLabel,
  buildPostPlayInputFromPlaybackContext,
  buildPostPlayNextEpisodeLabel,
  buildPostPlayQueueNextLabel,
} from "@/app/post-play/post-play-input";
import type { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import {
  resolvePostPlaybackEpisodeNavigationRoute,
  resolvePostPlaybackExitOutcome,
  resolvePostPlaybackTrackPanelSection,
} from "@/app/post-play/post-playback-routing";
import type { PhaseResult } from "@/app/session/Phase";
import type { Container } from "@/container";
import { episodeThumbKey } from "@/domain/catalog/title-detail";
import { resolveContentKind } from "@/domain/media/content-kind";
import { toHistoryTimestamp } from "@/domain/playback/playback-history";
import { didPlaybackEndNearNaturalEnd } from "@/domain/playback/playback-policy";
import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import { resolvePostPlayState } from "@/domain/playback/post-play-state";
import type { PostPlayState } from "@/domain/playback/post-play-state";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import { aggregateWatchTime, formatWatchTimeSummary } from "@/domain/playback/watch-time-stats";
import type { EpisodeInfo, EpisodePickerOption, ShellMode, TitleInfo } from "@/domain/types";
import { peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { formatTimestamp } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

export type PostPlaybackMenuResult =
  | { readonly kind: "restart" }
  | { readonly kind: "exit"; readonly result: PhaseResult<PlaybackOutcome> }
  | {
      readonly kind: "playlist-advance";
      readonly value: Extract<PlaybackOutcome, { type: "playlist-advance" }>;
    };

export type PostPlaybackMenuDeps = {
  readonly container: Container;
  readonly signal: AbortSignal;
  readonly quitNearEndBehavior: string;
  readonly quitNearEndThresholdMode: QuitNearEndThresholdMode;
  readonly recommendationRail: PostPlaybackRecommendationRail;
  readonly historyRepository: Container["historyRepository"];
  readonly diagnosticsService: Container["diagnosticsService"];

  readonly getMode: () => ShellMode;
  readonly getAutoplaySessionPaused: () => boolean;
  readonly getAutoskipSessionPaused: () => boolean;
  readonly getProvider: () => string;
  readonly getAnimeSubtitlePreference: () => string;
  readonly getSeriesSubtitlePreference: () => string;
  readonly dispatchAutoplayPaused: (paused: boolean) => void;
  readonly dispatchAutoskipPaused: (paused: boolean) => void;
  readonly dispatchStopAfterCurrent: (enabled: boolean) => void;
  readonly dispatchWatchTimeSummary: (summary: string | null) => void;
  readonly resolvePostPlaybackCommands: () => ReturnType<typeof resolveCommandContext>;
  readonly routeShellAction: (
    action: ShellAction,
  ) => Promise<
    | string
    | { readonly type: "history-entry"; readonly title: TitleInfo; readonly episode?: EpisodeInfo }
  >;

  readonly updatePlaybackFeedback: (feedback: {
    detail?: string | null;
    note?: string | null;
  }) => void;
  readonly transitionPlaybackSession: (
    session: PlaybackSessionState,
    event: PlaybackSessionPhaseEvent,
    meta?: Record<string, unknown>,
  ) => PlaybackSessionState;

  readonly runAutoNextCountdown: (
    episode: EpisodeInfo,
  ) => Promise<"continue" | "cancelled" | "skipped">;
  readonly navigatePlaybackEpisode: (
    episode: EpisodeInfo,
    options?: {
      loadingOrder?: "before-start" | "after-start" | "none";
      resetStopAfterCurrent?: boolean;
      resumeInterruptedAutoplay?: boolean;
      cancelPrefetchReason?: string;
    },
  ) => Promise<PlaybackStartIntent>;
  readonly completeSourceTrackPick: (
    episode: EpisodeInfo,
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent | null,
    resumeSeconds: number,
    reason: string,
  ) => Promise<PlaybackStartIntent>;
  readonly handoffNextEpisodePrefetch: (
    target: EpisodePrefetchTarget,
    reason: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
  ) => Promise<void>;
  readonly buildPrefetchTarget: (episode: EpisodeInfo, providerId: string) => EpisodePrefetchTarget;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;

  readonly openPlaybackShell: (input: {
    container: Container;
    state: PlaybackShellState;
  }) => Promise<PlaybackShellResult>;
  readonly openTracksPanel: typeof openTracksPanel;
  readonly chooseEpisodeFromMetadata: (input: {
    currentId: string;
    isAnime: boolean;
    currentSeason: number;
    currentEpisode: number;
    animeEpisodeCount?: number;
    animeEpisodes?: readonly EpisodePickerOption[];
    container: Container;
  }) => Promise<{ season: number; episode: number } | null>;
  readonly episodeInfoFromSelection: (input: {
    season: number;
    episode: number;
    isAnime: boolean;
    titleId: string;
    animeEpisodes?: readonly EpisodePickerOption[];
  }) => EpisodeInfo;

  readonly readAutoAdvanceGuards: () => AutoAdvanceGuards;
  readonly getCompatibleProviders: () => readonly { metadata: { id: string } }[];
  readonly switchPlaybackProviderFallback: typeof switchPlaybackProviderFallback;
  readonly teardownPlaybackForPostPlayExit: () => Promise<void>;
  readonly enqueuePostPlaybackRecommendation: typeof enqueuePostPlaybackRecommendation;
  readonly openPostPlaybackRecommendationActionPanel: typeof openPostPlaybackRecommendationActionPanel;
  readonly handleShellAction: typeof handleShellAction;
  readonly enqueueCurrentPlaybackDownload: typeof enqueueCurrentPlaybackDownload;
  readonly pickTitleControlPostPlayAction: (input: {
    readonly postPlayState: PostPlayState;
    readonly canResumePlayback: boolean;
  }) => Promise<ShellAction | null>;
};

export async function runPostPlaybackMenu(
  run: PlaybackRunState,
  iteration: PlaybackIteration,
  deps: PostPlaybackMenuDeps,
): Promise<PostPlaybackMenuResult> {
  const { container, signal } = deps;
  const { logger } = container;
  const { title, currentEpisode, episodeAvailability, result, preparedStream } = iteration;
  let resolvedProviderId = iteration.resolvedProviderId;

  postPlayback: while (true) {
    const resumeSeconds = toHistoryTimestamp(
      result,
      iteration.effectiveTimingCurrent,
      deps.quitNearEndThresholdMode,
    );
    const nearNaturalEpisodeEnd = didPlaybackEndNearNaturalEnd(
      result,
      iteration.effectiveTimingCurrent,
      deps.quitNearEndThresholdMode,
    );
    const nearEndVoluntaryQuit =
      !iteration.nearEndAutoNextDeclined &&
      isNearEndVoluntaryQuit({
        endReason: result.endReason,
        quitNearEndBehavior: deps.quitNearEndBehavior,
        sessionMode: run.playbackSession.mode,
        autoplayPaused: run.playbackSession.autoplayPaused,
        stopAfterCurrent: iteration.stopAfterCurrentAtMenuEntry,
        hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
        endedNearNaturalEnd: nearNaturalEpisodeEnd,
      });
    if (nearEndVoluntaryQuit && episodeAvailability.nextEpisode) {
      const postPlayNextEpisode = episodeAvailability.nextEpisode;
      const countdownResult = await deps.runAutoNextCountdown(postPlayNextEpisode);
      if (countdownResult !== "cancelled" && !signal.aborted) {
        logger.info("Post-play auto-next advancing after near-end quit", {
          titleId: title.id,
          nextSeason: postPlayNextEpisode.season,
          nextEpisode: postPlayNextEpisode.episode,
        });
        run.pendingStart = await deps.navigatePlaybackEpisode(postPlayNextEpisode, {
          resetStopAfterCurrent: true,
        });
        const autoplayPrefetchTarget = deps.buildPrefetchTarget(
          postPlayNextEpisode,
          resolvedProviderId,
        );
        await deps.handoffNextEpisodePrefetch(
          autoplayPrefetchTarget,
          "post-playback.autonext.prefetch-wait",
        );
        break postPlayback;
      }
      if (countdownResult === "cancelled") {
        // Declining this advance skips the prompt for the episode but must not
        // flip the session autoplay preference — quitting is not "pause
        // autoplay". Mirror whatever the user actually set (a toggles it).
        iteration.nearEndAutoNextDeclined = true;
        const autoplayPaused = deps.getAutoplaySessionPaused();
        run.playbackSession = {
          ...run.playbackSession,
          autoplayPaused,
          autoplayPauseReason: autoplayPaused ? "user" : null,
        };
      }
    }
    const autoplaySessionPaused = run.playbackSession.autoplayPaused;
    const canResumePlayback = resolveCanResumePlayback({
      resumeSeconds,
      durationSeconds: result.duration,
      endReason: result.endReason,
      endedNearNaturalEnd: nearNaturalEpisodeEnd,
    });
    if (iteration.openRecoverySourcePanelOnPostPlay) {
      iteration.openRecoverySourcePanelOnPostPlay = false;
      const hasStreams = Boolean(preparedStream.providerResolveResult?.streams.length);
      if (!hasStreams) {
        run.pendingRecomputeSources = true;
        run.pendingSourceRefreshAction = "recover";
        continue postPlayback;
      }
      const picked = await deps.openTracksPanel(
        preparedStream,
        {
          initialSection: "source",
          failedCurrentReason: result.suspectedDeadStream
            ? "Playback failed on this stream."
            : "Playback did not start on this stream.",
        },
        container,
      );
      const selection = picked ? streamSelectionFromTrackPick(picked) : null;
      if (picked && selection) {
        run.pendingStart = await deps.completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          resumeSeconds,
          "post-playback-tracks",
        );
        run.playbackSession = deps.transitionPlaybackSession(
          run.playbackSession,
          "recovery-started",
          {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            provider: resolvedProviderId,
            action: "recover",
          },
        );
        break postPlayback;
      }
    }
    const mode = deps.getMode();
    const autoContinueIntoRecommendationPossible = canAutoContinueIntoRecommendation({
      sessionMode: run.playbackSession.mode,
      hasNextEpisode: Boolean(iteration.episodeAvailability.nextEpisode),
      endReason: result.endReason,
      autoplayPaused: run.playbackSession.autoplayPaused,
      autoplaySessionPaused: deps.getAutoplaySessionPaused(),
      aborted: signal.aborted,
      hasQueuedNext: Boolean(container.queueService.peekNext()),
      autoplayRecommendationsEnabled: container.config.autoplayRecommendations,
    });
    const recommendationRailItems = await deps.recommendationRail.resolveRailItems({
      mode,
      prefetchedItems: iteration.prefetchedRecommendationItems,
      autoContinueIntoRecommendationPossible,
    });
    const topRec = recommendationRailItems[0];
    const recommendationAutoNext = !iteration.nextEpisode
      ? evaluateAutoAdvanceNextUp({
          guards: deps.readAutoAdvanceGuards(),
          nextEpisode: null,
          queueHead: container.queueService.peekNext(),
          topRecommendation: topRec
            ? {
                mediaKind: topRec.type === "movie" ? "movie" : "series",
                titleId: topRec.id,
                title: topRec.title,
                sourceId: topRec.sourceId,
              }
            : null,
          seriesDone: !episodeAvailability.nextEpisode,
          autoplayRecommendations: container.config.autoplayRecommendations,
        })
      : null;
    if (recommendationAutoNext?.kind === "recommendation") {
      const topRecAdvance = recommendationAutoNext.item;
      const recCountdown = await runAutoplayAdvanceCountdown({
        seconds: 5,
        signal,
        sleep: (ms) => Bun.sleep(ms),
        onTick: (remaining) =>
          deps.updatePlaybackFeedback({
            detail: "Up next ready",
            note: `Up next: ${topRecAdvance.title} in ${remaining}s  ·  a to pause`,
          }),
        isCancelled: () => deps.getAutoplaySessionPaused(),
      });
      if (recCountdown !== "cancelled") {
        return {
          kind: "playlist-advance",
          value: {
            type: "playlist-advance",
            titleInfo: {
              id: topRecAdvance.titleId,
              name: topRecAdvance.title,
              type: topRec?.type === "movie" ? "movie" : "series",
              posterUrl: topRec?.posterPath ?? undefined,
            },
            mode,
          },
        };
      }
      // Cancelled only when the user already paused autoplay — mirror, don't force.
      const autoplayPaused = deps.getAutoplaySessionPaused();
      run.playbackSession = {
        ...run.playbackSession,
        autoplayPaused,
        autoplayPauseReason: autoplayPaused ? "user" : null,
      };
      deps.updatePlaybackFeedback({ detail: null, note: null });
    }
    const playbackStarted =
      result.endReason === "eof" || result.watchedSeconds >= 30 || resumeSeconds > 10;
    const postPlayInput = buildPostPlayInputFromPlaybackContext({
      title,
      currentEpisode,
      availability: episodeAvailability,
      isAnime: mode === "anime",
      nextAirDateHint: iteration.catalogAutoplayEndBanner?.replace(/^Caught up ·\s*/i, ""),
      playbackStarted,
    });
    const postPlayState = resolvePostPlayState(postPlayInput);
    const watchTimeSummary =
      postPlayState.kind === "series-complete" && container.config.showWatchTimeStats
        ? formatWatchTimeSummary(aggregateWatchTime(deps.historyRepository.listByTitle(title.id)))
        : null;
    deps.dispatchWatchTimeSummary(watchTimeSummary);

    let postAction: PlaybackShellResult | ShellAction | undefined;

    if (
      !iteration.titleControlAutoPresented &&
      shouldAutoPresentTitleControlForPostPlay(postPlayState, episodeAvailability)
    ) {
      iteration.titleControlAutoPresented = true;
      const titleControlPick = await deps.pickTitleControlPostPlayAction({
        postPlayState,
        canResumePlayback,
      });
      if (titleControlPick) {
        postAction = titleControlPick;
      }
    }

    if (postAction === undefined) {
      const upcomingEpisode = episodeAvailability.nextEpisode;
      const nextEpisodePickerOption = upcomingEpisode
        ? iteration.shellEpisodePicker.options.find(
            (option) => option.value === `${upcomingEpisode.season}:${upcomingEpisode.episode}`,
          )
        : undefined;
      const priorEpisode = episodeAvailability.previousEpisode;
      const previousEpisodePickerOption = priorEpisode
        ? iteration.shellEpisodePicker.options.find(
            (option) => option.value === `${priorEpisode.season}:${priorEpisode.episode}`,
          )
        : undefined;
      const episodesInCurrentSeason = iteration.shellEpisodePicker.options.filter((option) =>
        option.value.startsWith(`${currentEpisode.season}:`),
      ).length;
      const watchedEpisodes = iteration.watchedEntries.filter((entry: HistoryProgress) =>
        title.type === "series" ? entry.season === currentEpisode.season : true,
      ).length;
      const postPlayTitleDetail = peekTitleDetail(title.id, title.type);
      const nextEpisodeThumbUrl =
        upcomingEpisode && postPlayTitleDetail?.artwork?.episodeThumbnails
          ? postPlayTitleDetail.artwork.episodeThumbnails[
              episodeThumbKey(upcomingEpisode.season, upcomingEpisode.episode)
            ]
          : undefined;
      const previousEpisodeThumbUrl =
        priorEpisode && postPlayTitleDetail?.artwork?.episodeThumbnails
          ? postPlayTitleDetail.artwork.episodeThumbnails[
              episodeThumbKey(priorEpisode.season, priorEpisode.episode)
            ]
          : undefined;
      postAction = await deps.openPlaybackShell({
        container,
        state: {
          type: title.type,
          title: title.name,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          posterUrl: title.posterUrl,
          titleDetail: postPlayTitleDetail,
          provider: resolvedProviderId,
          subtitleStatus: describePlaybackSubtitleStatus(
            preparedStream,
            mode === "anime"
              ? deps.getAnimeSubtitlePreference()
              : deps.getSeriesSubtitlePreference(),
          ),
          autoplayPaused: autoplaySessionPaused,
          autoskipPaused: deps.getAutoskipSessionPaused(),
          stopAfterCurrent: run.playbackSession.stopAfterCurrent,
          showMemory: false,
          mode,
          resumeLabel: canResumePlayback
            ? title.type === "series"
              ? `resume S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}  ·  ${formatTimestamp(resumeSeconds)}`
              : `resume ${formatTimestamp(resumeSeconds)}`
            : undefined,
          status: iteration.catalogAutoplayEndBanner
            ? { label: iteration.catalogAutoplayEndBanner, tone: "neutral" }
            : { label: "Ready for next action", tone: "success" },
          footerMode: "minimal",
          postPlayState,
          episodeLabel: buildPostPlayEpisodeLabel(
            title,
            currentEpisode,
            episodesInCurrentSeason || undefined,
          ),
          nextEpisodeLabel: buildPostPlayNextEpisodeLabel(
            upcomingEpisode,
            nextEpisodePickerOption?.label,
          ),
          previousEpisodeLabel: buildPostPlayNextEpisodeLabel(
            priorEpisode,
            previousEpisodePickerOption?.label,
          ),
          queueNextLabel: buildPostPlayQueueNextLabel(container.queueService.peekNext()),
          nextEpisodeThumbUrl,
          previousEpisodeThumbUrl,
          totalEpisodes: title.episodeCount ?? iteration.shellEpisodePicker.options.length,
          watchedEpisodes,
          currentSeason: currentEpisode.season,
          currentEpisode: currentEpisode.episode,
          contentKind: resolveContentKind(title, mode),
          // Carry the session's captured video metadata so the post-play `video`
          // panel keeps channel/views/length facts that were shown during playback.
          videoMeta: container.stateManager.getState().videoMeta,
          recommendationRailItems: recommendationRailItems.slice(0, 4).map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            ...(item.sourceId ? { sourceId: item.sourceId } : {}),
            ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
            ...(item.year ? { year: item.year } : {}),
            ...(item.overview ? { overview: item.overview } : {}),
            ...(item.posterPath !== undefined ? { posterPath: item.posterPath } : {}),
            ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
          })),
          commands: deps.resolvePostPlaybackCommands(),
        } as PlaybackShellState,
      });
    }

    if (typeof postAction === "object" && postAction !== null && "type" in postAction) {
      if (postAction.type === "track-selection") {
        const picked = postAction.pick;
        const selection = streamSelectionFromTrackPick(picked);
        if (!selection) {
          continue postPlayback;
        }
        const fromProviderId = resolvedProviderId;
        run.pendingStart = await deps.completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          resumeSeconds,
          "post-playback-tracks",
        );
        run.playbackSession = deps.transitionPlaybackSession(
          run.playbackSession,
          "episode-navigation",
          buildTrackPickTransitionContext({
            titleId: title.id,
            episode: currentEpisode,
            selection,
            fromProviderId,
          }),
        );
        break postPlayback;
      }
      if (postAction.type === "play-recommendation") {
        await deps.teardownPlaybackForPostPlayExit();
        return {
          kind: "exit",
          result: {
            status: "success",
            value: {
              type: "history_entry",
              title: titleInfoFromSearchResult(
                recommendationRailItemToSearchResult(postAction.item),
              ),
            },
          },
        };
      }
      if (postAction.type === "queue-recommendation") {
        await deps.enqueuePostPlaybackRecommendation(container, postAction.item);
      } else if (postAction.type === "open-recommendation-actions") {
        await deps.openPostPlaybackRecommendationActionPanel({
          container,
          items: postAction.items,
          mode,
        });
      }
      continue postPlayback;
    }

    const routedAction = await deps.routeShellAction(postAction as ShellAction);

    const exitOutcome = resolvePostPlaybackExitOutcome(routedAction);
    if (exitOutcome) {
      await deps.teardownPlaybackForPostPlayExit();
      return { kind: "exit", result: exitOutcome as PhaseResult<PlaybackOutcome> };
    }
    if (routedAction === "toggle-autoplay") {
      const playbackAction = resolvePostPlaybackSessionAction(
        "toggle-autoplay",
        run.playbackSession,
      );
      run.playbackSession = playbackAction.session;
      deps.dispatchAutoplayPaused(playbackAction.session.autoplayPaused);
      continue postPlayback;
    }
    if (routedAction === "toggle-autoskip") {
      deps.dispatchAutoskipPaused(!deps.getAutoskipSessionPaused());
      continue postPlayback;
    }
    if (routedAction === "stop-after-current") {
      const enabled = !run.playbackSession.stopAfterCurrent;
      deps.dispatchStopAfterCurrent(enabled);
      run.playbackSession = {
        ...run.playbackSession,
        stopAfterCurrent: enabled,
      };
      continue postPlayback;
    }

    const navigationRoute = resolvePostPlaybackEpisodeNavigationRoute({
      action: routedAction,
      titleType: title.type,
      availability: episodeAvailability,
    });
    if (navigationRoute) {
      run.pendingStart = await deps.navigatePlaybackEpisode(navigationRoute.episode);
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "episode-navigation",
        buildEpisodeNavigationTransitionContext({
          titleId: title.id,
          episode: navigationRoute.episode,
          source: navigationRoute.source,
        }),
      );
      break postPlayback;
    }
    if (routedAction === "next" || routedAction === "previous" || routedAction === "next-season") {
      continue postPlayback;
    }

    const trackPanelSection = resolvePostPlaybackTrackPanelSection(routedAction);

    if (routedAction === "resume") {
      run.pendingStart = startAtResumePoint(resumeSeconds, { suppressResumePrompt: true });
      const playbackAction = resolvePostPlaybackSessionAction("resume", run.playbackSession);
      run.playbackSession = playbackAction.session;
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "resume-requested",
        {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          resumeSeconds,
        },
      );
      if (!playbackAction.session.autoplayPaused) {
        deps.dispatchAutoplayPaused(false);
      }
      break postPlayback;
    }
    if (routedAction === "replay") {
      run.pendingStart = startFromBeginning();
      if (postPlayState.kind === "did-not-start") {
        run.pendingSourceRefreshAction = "recover";
        run.autoSourceRecoverAttempts = 0;
        deps.invalidateRecentEpisodeStream(currentEpisode);
      }
      const playbackAction = resolvePostPlaybackSessionAction("replay", run.playbackSession);
      run.playbackSession = playbackAction.session;
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "replay-requested",
        {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
        },
      );
      if (!playbackAction.session.autoplayPaused) {
        deps.dispatchAutoplayPaused(false);
      }
      break postPlayback;
    }
    if (routedAction === "recompute") {
      run.pendingStart = startEpisodeNavigation({ targetResumeSeconds: resumeSeconds });
      run.pendingSourceRefreshAction = "recover";
      run.pendingRecomputeSources = true;
      run.autoSourceRecoverAttempts = 0;
      deps.invalidateRecentEpisodeStream(currentEpisode);
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "recovery-started",
        {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          provider: resolvedProviderId,
          action: "recompute",
        },
      );
      deps.diagnosticsService.record({
        category: "playback",
        message: "Recomputing provider sources after shell command",
        context: {
          provider: resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          resumeSeconds,
        },
      });
      break postPlayback;
    }
    if (routedAction === "fallback") {
      const fallback = pickCompatibleFallbackProvider(
        deps.getCompatibleProviders(),
        resolvedProviderId,
      );
      if (!fallback) {
        continue postPlayback;
      }
      const switched = await deps.switchPlaybackProviderFallback({
        container,
        fromProviderId: resolvedProviderId,
        toProviderId: fallback.metadata.id,
        title,
        episode: currentEpisode,
        mode,
        invalidateRecentEpisodeStream: deps.invalidateRecentEpisodeStream,
      });
      resolvedProviderId = switched.providerId;
      iteration.resolvedProviderId = switched.providerId;
      alignPostPlayProviderRestart({
        run,
        iteration,
        currentEpisode,
        nextProviderId: switched.providerId,
        resumeSeconds,
        invalidateRecentEpisodeStream: deps.invalidateRecentEpisodeStream,
      });
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "episode-navigation",
        {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          fromProvider: switched.fromProviderId,
          provider: switched.providerId,
        },
      );
      deps.diagnosticsService.record({
        category: "playback",
        message: "Switching to fallback provider after shell command",
        context: {
          from: switched.fromProviderId,
          fallback: switched.providerId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          resumeSeconds,
        },
      });
      break postPlayback;
    }
    if (trackPanelSection) {
      const picked = await deps.openTracksPanel(
        preparedStream,
        { initialSection: trackPanelSection },
        container,
      );
      if (!picked) {
        continue postPlayback;
      }
      const selection = streamSelectionFromTrackPick(picked);
      if (!selection && picked.section !== "subtitle") {
        continue postPlayback;
      }
      const fromProviderId = resolvedProviderId;
      run.pendingStart = await deps.completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        resumeSeconds,
        "post-playback-tracks",
      );
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "episode-navigation",
        selection
          ? buildTrackPickTransitionContext({
              titleId: title.id,
              episode: currentEpisode,
              selection,
              fromProviderId,
            })
          : {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            },
      );
      break postPlayback;
    }
    if (routedAction === "download") {
      await deps.enqueueCurrentPlaybackDownload({
        container,
        reason: "post-playback-command",
      });
      continue postPlayback;
    }
    if (routedAction === "handled") {
      const nextProviderId = deps.getProvider();
      if (nextProviderId !== iteration.postPlayProviderId) {
        iteration.postPlayProviderId = nextProviderId;
        alignPostPlayProviderRestart({
          run,
          iteration,
          currentEpisode,
          nextProviderId,
          resumeSeconds,
          invalidateRecentEpisodeStream: deps.invalidateRecentEpisodeStream,
        });
        resolvedProviderId = nextProviderId;
        deps.diagnosticsService.record({
          category: "playback",
          message: "Post-play provider switch staged for fresh resolve",
          context: {
            provider: nextProviderId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
          },
        });
        break postPlayback;
      }
      continue postPlayback;
    }
    if (
      postAction === "clear-cache" ||
      postAction === "reset-provider-health" ||
      postAction === "clear-history"
    ) {
      await deps.handleShellAction({ action: postAction, container });
      continue postPlayback;
    }
    if (routedAction === "pick-episode" && title.type === "series") {
      const selection = await deps.chooseEpisodeFromMetadata({
        currentId: title.id,
        isAnime: mode === "anime",
        currentSeason: currentEpisode.season,
        currentEpisode: currentEpisode.episode,
        animeEpisodeCount: title.episodeCount,
        animeEpisodes: iteration.currentAnimeEpisodes,
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
      const pickedEpisode = deps.episodeInfoFromSelection({
        season: selection.season,
        episode: selection.episode,
        isAnime: mode === "anime",
        titleId: title.id,
        animeEpisodes: iteration.currentAnimeEpisodes,
      });
      run.pendingStart = await deps.navigatePlaybackEpisode(pickedEpisode);
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "episode-navigation",
        buildEpisodeNavigationTransitionContext({
          titleId: title.id,
          episode: pickedEpisode,
          source: "episode-picker",
        }),
      );
      break postPlayback;
    }

    const fallbackNavigationRoute = resolvePostPlaybackEpisodeNavigationRoute({
      action: postAction,
      titleType: title.type,
      availability: episodeAvailability,
    });
    if (fallbackNavigationRoute) {
      run.pendingStart = await deps.navigatePlaybackEpisode(fallbackNavigationRoute.episode);
      run.playbackSession = deps.transitionPlaybackSession(
        run.playbackSession,
        "episode-navigation",
        buildEpisodeNavigationTransitionContext({
          titleId: title.id,
          episode: fallbackNavigationRoute.episode,
          source: fallbackNavigationRoute.source,
        }),
      );
      break postPlayback;
    }
    if (postAction === "next" || postAction === "previous" || postAction === "next-season") {
      continue postPlayback;
    }

    logger.warn("Unhandled post-play shell action; staying on post-play menu", {
      postAction,
      routedAction,
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
    });
    continue postPlayback;
  }

  iteration.resolvedProviderId = resolvedProviderId;
  return { kind: "restart" };
}
