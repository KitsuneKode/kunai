// =============================================================================
// Playback episode bootstrap
//
// Everything before the playback loop: the mpv dependency gate, catalog detail
// and provider-native episode list, history lookup, and the episode/start
// choice (smart auto-launch, the "Where to start?" menu, or the movie
// Resume/Restart point). Ends with the chosen episode selected in the shell.
// =============================================================================

import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import { consumeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import { gatePlaybackDependencies } from "@/app/playback/playback-dependency-gate";
import { getAnimeEpisodeOptions } from "@/app/playback/playback-episode-catalog";
import { type PlaybackOutcome } from "@/app/playback/playback-outcome";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import {
  type PlaybackPhaseSession,
  type PlaybackEpisodeBootstrap,
} from "@/app/playback/playback-phase-session";
import { playbackEpisodeCatalogLanguages } from "@/app/playback/playback-profile-context";
import { resumeSecondsFromHistoryForEpisode } from "@/app/playback/playback-resume-from-history";
import {
  sharedStartOverride,
  startEpisodeNavigation,
  startFromEpisodeSelection,
} from "@/app/playback/playback-start-intent";
import type { PhaseResult } from "@/app/session/Phase";
import { applyCatalogDetailToTitle } from "@/domain/catalog/apply-title-detail";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { usesProviderNativeEpisodeCatalog } from "@/domain/media/provider-native-episodes";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import { episodeRequestFlags } from "@/domain/session/SessionState";
import type { TitleInfo, EpisodeInfo } from "@/domain/types";
import { fetchTitleDetail } from "@/services/catalog/TitleDetailService";
import { isFinished } from "@/services/continuation/history-progress";
import { fetchSeasons } from "@/tmdb";

/**
 * Gate before episode/provider/history work so the phase's finally still rolls
 * back unacknowledged queue claims when mpv (or other deps) are missing.
 * Returns the phase result when playback cannot start, otherwise null.
 */
export async function gatePlaybackStart(
  session: PlaybackPhaseSession,
  title: TitleInfo,
): Promise<PhaseResult<PlaybackOutcome> | null> {
  const { context } = session;
  const { container } = context;
  const { diagnosticsService, stateManager, player } = container;
  const dependencyGate = await gatePlaybackDependencies({
    player,
    playerMode: container.playerMode,
  });
  if (!dependencyGate.ok) {
    diagnosticsService.record({
      category: "playback",
      operation: "playback.dependency.gate",
      message: dependencyGate.problem.userMessage,
      context: {
        dependency: dependencyGate.dependency,
        cause: dependencyGate.problem.cause,
        stage: dependencyGate.problem.stage,
        severity: dependencyGate.problem.severity,
        recommendedAction: dependencyGate.problem.recommendedAction,
        remediation: dependencyGate.remediation,
        titleId: title.id,
      },
    });
    stateManager.dispatch({
      type: "SET_PLAYBACK_PROBLEM",
      problem: dependencyGate.problem,
    });
    updatePlaybackFeedback(context, {
      detail: "Playback unavailable",
      note: dependencyGate.problem.userMessage,
    });
    return { status: "success", value: "back_to_results" };
  }
  return null;
}

export type PlaybackEpisodeBootstrapOutcome =
  | { readonly kind: "exit"; readonly result: PhaseResult<PlaybackOutcome> }
  | ({ readonly kind: "ready" } & PlaybackEpisodeBootstrap);

export async function bootstrapPlaybackEpisode(
  session: PlaybackPhaseSession,
  initialTitle: TitleInfo,
): Promise<PlaybackEpisodeBootstrapOutcome> {
  let title = initialTitle;
  const { context, run, isOfflineLaunch, animeEpisodeCatalogByProvider, queueAttempt } = session;
  const { container } = context;
  const { providerRegistry, stateManager, logger, historyRepository, config, diagnosticsService } =
    container;
  // Episode selection (for series)
  queueAttempt?.setStage("episode-selection");
  let episode: EpisodeInfo | undefined;
  // One-shot shared start position from a share link (kunai://...&t=). Consumed once
  // here and applied to the first episode by `sharedStartOverride` on both the series
  // and movie paths below; later episodes resume from history.
  const bootstrapStartSeconds = consumeShareBootstrapStartSeconds();
  const historyTitleLookup = {
    id: title.id,
    kind: classifyPersistedKind(title, stateManager.getState().mode),
    title: title.name,
    externalIds: enrichExternalIdsWithVideoMeta(
      title.externalIds,
      stateManager.getState().videoMeta,
    ),
  };
  // Navigation always resumes from history. The shared timestamp is not folded
  // in here: this function outlives the first episode, and a first episode that
  // started from an explicit selection never consumed it, so episode 2 used to
  // inherit the link's `t=`.
  const startNavigationToEpisode = async (target: EpisodeInfo) =>
    startEpisodeNavigation({
      targetResumeSeconds: resumeSecondsFromHistoryForEpisode(
        historyRepository,
        historyTitleLookup,
        target,
      ),
    });
  const bootstrapEpisode =
    stateManager.getState().currentTitle?.id === title.id
      ? stateManager.getState().currentEpisode
      : undefined;
  const bootstrapLocalEpisode =
    bootstrapEpisode ?? (title.type === "movie" ? { season: 1, episode: 1 } : undefined);
  // Continue with a validated local choice needs no provider or remote enrichment.
  // The source policy still honors an explicit preference for online playback.
  const skipRemotePreparation =
    isOfflineLaunch ||
    (title.launchSource === "continue" &&
      bootstrapLocalEpisode !== undefined &&
      Boolean(
        await resolveLocalEpisodePlayback(container, title, bootstrapLocalEpisode, {
          entrypoint: "continue",
        }),
      ));
  const provider = skipRemotePreparation
    ? undefined
    : providerRegistry.get(stateManager.getState().provider);
  const catalogDetailPromise = skipRemotePreparation
    ? Promise.resolve(undefined)
    : fetchTitleDetail(title.id, title.type, undefined, {
        externalIds: title.externalIds,
        isAnime: stateManager.getState().mode === "anime" || title.isAnime === true,
      }).catch(() => undefined);
  const initialAnimeEpisodes = skipRemotePreparation
    ? undefined
    : await getAnimeEpisodeOptions({
        title,
        mode: stateManager.getState().mode,
        provider,
        cache: animeEpisodeCatalogByProvider,
        languages: playbackEpisodeCatalogLanguages({
          mode: stateManager.getState().mode,
          title,
          config,
        }),
      });
  const catalogDetail = await catalogDetailPromise;
  if (catalogDetail) {
    // Everything persisted or broadcast below reads this `title`, not the
    // reducer's copy — history, the ledger, presence, and share links. Fold
    // the whole catalog answer in, not just its structure, or a `-i/--id`
    // launch writes "TMDB 438631" and no ids to all four.
    title = applyCatalogDetailToTitle(title, catalogDetail);
    stateManager.dispatch({
      type: "SET_TITLE_DETAIL",
      titleId: title.id,
      titleType: catalogDetail.type,
      detail: catalogDetail,
    });
  }
  logger.info("Episode selection metadata", {
    titleId: title.id,
    mode: stateManager.getState().mode,
    provider: stateManager.getState().provider,
    episodeCount: title.episodeCount ?? null,
    animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
  });
  diagnosticsService.record({
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

  let providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;
  const shellMode = stateManager.getState().mode;
  const usesNativeEpisodes = usesProviderNativeEpisodeCatalog(shellMode, title.id);

  if (title.type === "series") {
    // Check history for resume
    const history =
      historyRepository.getLatestForTitleIdentity({
        id: title.id,
        kind:
          stateManager.getState().mode === "youtube"
            ? "video"
            : stateManager.getState().mode === "anime" || title.isAnime
              ? "anime"
              : "series",
        externalIds: title.externalIds,
      }) ?? null;
    if (history) {
      logger.info("History found", {
        season: history.season,
        episode: history.episode,
        timestamp: history.positionSeconds,
      });
    }

    const { applyTitleProviderPreferenceToSession } =
      await import("@/app/playback/playback-provider-switch");
    if (!skipRemotePreparation) {
      applyTitleProviderPreferenceToSession(
        container,
        title.id,
        title,
        stateManager.getState().mode,
      );
    }
    providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;

    // Session-flow owns the current season/episode selection rules until the
    // mounted root shell fully absorbs the picker stack.
    //
    // A one-shot `-e/--episode` request folds into both the preselection
    // and the `flags` the resolvers were built for: `resolvePlaybackEpisodeEntry`
    // auto-plays it (flags are what let a no-history pick launch directly),
    // and `chooseStartingEpisode` returns it as an immediate selection if
    // the menu path still runs (offline-library, movie-gated, etc).
    const episodeRequest = stateManager.getState().episodeRequest;
    const requestFlags = episodeRequestFlags(episodeRequest, usesNativeEpisodes);
    const preselectedCurrentEpisode =
      stateManager.getState().currentTitle?.id === title.id
        ? stateManager.getState().currentEpisode
        : undefined;
    const preselectedEpisode = episodeRequest ?? preselectedCurrentEpisode;

    const { resolvePlaybackEpisodeEntry } =
      await import("@/app-shell/title-control/smart-auto-launch");
    const providerHealth = skipRemotePreparation
      ? undefined
      : container.providerHealth.get(stateManager.getState().provider);
    const failedProvider =
      providerHealth?.status === "degraded" || providerHealth?.status === "down";
    const seasonCount = skipRemotePreparation
      ? undefined
      : usesNativeEpisodes
        ? (title.episodeCount ?? initialAnimeEpisodes?.length)
        : ((await fetchSeasons(title.id).catch(() => null))?.length ?? undefined);

    // The Enter contract resolves "next unwatched" only when it decides
    // something: a finished last episode and no explicit pick. It runs the
    // same loader the starting menu would, so this adds no fetch the menu
    // path wasn't already paying — it just answers before opening one.
    const nextEpisode =
      !isOfflineLaunch && !preselectedEpisode && history && isFinished(history)
        ? await (async () => {
            const { resolveNextHistoryEpisode } = await import("@/session-flow");
            return resolveNextHistoryEpisode({
              currentId: title.id,
              isAnime: usesNativeEpisodes,
              history,
              animeEpisodeCount: title.episodeCount,
              animeEpisodes: initialAnimeEpisodes,
            }).catch(() => null);
          })()
        : null;

    const episodeEntry = resolvePlaybackEpisodeEntry({
      titleId: title.id,
      titleType: title.type,
      isAnime: usesNativeEpisodes,
      launchSource: title.launchSource,
      preselectedEpisode: preselectedEpisode ?? undefined,
      history,
      nextEpisode: nextEpisode ?? undefined,
      seasonCount,
      failedProvider,
      forceMenu: title.forceStartingMenu === true,
      flags: requestFlags,
    });

    if (episodeEntry.kind === "auto") {
      episode = episodeInfoFromSelection({
        season: episodeEntry.selection.season,
        episode: episodeEntry.selection.episode,
        isAnime: usesNativeEpisodes,
        titleId: title.id,
        animeEpisodes: initialAnimeEpisodes,
        providerEpisodeIdentity: episodeRequest
          ? undefined
          : preselectedCurrentEpisode?.providerEpisodeIdentity,
      });
      // A notification/queue launch names the absolute episode — keep it
      // so the history row records the identity it actually played.
      if (preselectedCurrentEpisode?.absoluteEpisode !== undefined) {
        episode = { ...episode, absoluteEpisode: preselectedCurrentEpisode.absoluteEpisode };
      }
      run.pendingStart =
        episodeEntry.selection.startAt !== undefined || episodeEntry.selection.suppressResumePrompt
          ? startFromEpisodeSelection(episodeEntry.selection)
          : await startNavigationToEpisode(episode);
    } else {
      const { chooseStartingEpisode } = await import("@/session-flow");
      const outcome = await chooseStartingEpisode({
        currentId: title.id,
        isAnime: usesNativeEpisodes,
        animeEpisodeCount: title.episodeCount,
        animeEpisodes: initialAnimeEpisodes,
        flags: requestFlags,
        getHistoryEntry: () => Promise.resolve(history),
        container,
      });

      if (outcome.kind !== "selected") {
        // A catalog failure is not a cancel. Both used to unwind silently,
        // so a TMDB outage dropped the user back into History with no idea
        // the fetch had failed -- surface the reason instead.
        if (outcome.kind === "unavailable") {
          logger.warn("Episode selection unavailable before playback", {
            titleId: title.id,
            reason: outcome.reason,
            mode: stateManager.getState().mode,
          });
          stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: outcome.reason,
          });
        } else {
          logger.info("Episode selection cancelled before playback", {
            titleId: title.id,
            mode: stateManager.getState().mode,
          });
        }
        return {
          kind: "exit",
          result: {
            status: "success",
            value: title.launchSource === "history" ? "back_to_history" : "back_to_results",
          },
        };
      }
      const selection = outcome.selection;

      episode = episodeInfoFromSelection({
        season: selection.season,
        episode: selection.episode,
        isAnime: usesNativeEpisodes,
        titleId: title.id,
        animeEpisodes: initialAnimeEpisodes,
      });
      run.pendingStart =
        selection.startAt !== undefined || selection.suppressResumePrompt
          ? startFromEpisodeSelection(selection)
          : await startNavigationToEpisode(episode);
    }
    run.pendingStart = sharedStartOverride(bootstrapStartSeconds) ?? run.pendingStart;
  } else {
    // Movies have no season/episode axis but still carry saved progress.
    // Offer Resume/Restart when there is a resumable position; otherwise play
    // from the beginning (no menu). Previously movies started at 0 always.
    const movieHistory =
      historyRepository.getLatestForTitleIdentity({
        id: historyTitleLookup.id,
        kind: historyTitleLookup.kind,
        externalIds: historyTitleLookup.externalIds,
      }) ?? null;
    const { chooseMovieStartingPoint, resolveMovieStartingChoice } = await import("@/session-flow");
    // Enter resumes a live position directly — the same answer the
    // Resume/Restart picker leads with. `m` (forceStartingMenu) still
    // opens that picker so restarting stays one key away.
    const selection =
      movieHistory &&
      !isFinished(movieHistory) &&
      movieHistory.positionSeconds > 0 &&
      !title.forceStartingMenu
        ? resolveMovieStartingChoice("resume", movieHistory)
        : await chooseMovieStartingPoint({ history: movieHistory, container });
    if (!selection) {
      logger.info("Movie starting point cancelled before playback", { titleId: title.id });
      return {
        kind: "exit",
        result: {
          status: "success",
          value: title.launchSource === "history" ? "back_to_history" : "back_to_results",
        },
      };
    }
    episode = { season: 1, episode: 1 };
    run.pendingStart = startFromEpisodeSelection(selection);
    run.pendingStart = sharedStartOverride(bootstrapStartSeconds) ?? run.pendingStart;
  }

  stateManager.dispatch({ type: "SELECT_EPISODE", episode });
  run.playbackSession = transitionPlaybackSession(
    context,
    run.playbackSession,
    "episode-selected",
    {
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
    },
  );

  return {
    kind: "ready",
    title,
    historyTitleLookup,
    startNavigationToEpisode,
    providerSwitchSeqBeforeEpisodePicker,
  };
}
