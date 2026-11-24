// =============================================================================
// Playback episode context
//
// The per-episode metadata an iteration needs before (and while) it resolves:
// title-detail warmup, the timing fetch kicked off in parallel, watch history,
// the provider-native episode list, the playback episode picker, episode
// availability (catalog or offline library) pushed to the shell and mpv, and
// the profile used to describe prefetch targets.
// =============================================================================

import type { EpisodePrefetchTarget } from "@/app/playback/episode-prefetch";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import { getAnimeEpisodeOptions } from "@/app/playback/playback-episode-catalog";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import type { PlaybackLoopState } from "@/app/playback/playback-phase-session";
import {
  playbackAudioPreference,
  playbackEpisodeCatalogLanguages,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import { shouldFetchPlaybackTiming } from "@/app/playback/playback-timing-fetch-policy";
import { getPlaybackTimingMetadata } from "@/app/playback/playback-timing-lookup";
import {
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/domain/playback/playback-policy";
import type { EpisodePickerOption, PlaybackTimingMetadata, EpisodeInfo } from "@/domain/types";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { listReadyEpisodes, findNextReadyEpisode } from "@/services/offline/offline-episode-index";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";

export type EpisodeContext = {
  /** Remote metadata/timing lookups are allowed (online, not a local file). */
  readonly playbackNetworkAllowed: boolean;
  /** The provider the early timing fetch was keyed on (undefined for local files). */
  readonly configuredTimingProviderId: string | undefined;
  readonly timingFetch: Promise<PlaybackTimingMetadata | null>;
  readonly watchedEntries: ReturnType<
    PlaybackLoopState["context"]["container"]["historyRepository"]["listByTitleIdentity"]
  >;
  readonly isAnimePlayback: boolean;
  readonly offlineTitleId: string;
  readonly currentAnimeEpisodes: readonly EpisodePickerOption[] | undefined;
  readonly shellEpisodePicker: Awaited<ReturnType<typeof buildPlaybackEpisodePickerOptions>>;
  readonly episodeAvailability: Awaited<ReturnType<typeof resolveEpisodeAvailability>>;
  readonly profileContext: Parameters<typeof playbackAudioPreference>[0];
  readonly buildPrefetchTarget: (
    nextEpisodeIntent: EpisodeInfo,
    providerId: string,
  ) => EpisodePrefetchTarget;
};

export async function loadEpisodeContext(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
): Promise<EpisodeContext> {
  const {
    context,
    title,
    animeEpisodeCatalogByProvider,
    playbackTimingByEpisode,
    getPreferredStreamSelection,
    historyTitleLookup,
  } = loop;
  const { container } = context;
  const { stateManager, historyRepository, config, diagnosticsService, playerControl } = container;
  const { currentEpisode, sourceAuthority, sourceProviderId, localPlayback, recordStartupMark } =
    attempt;
  const { controller: resolveController } = attempt.resolve;
  const playbackNetworkAllowed = !localPlayback && container.connectivity.isOnline();

  // Warm the catalog-detail cache early so the playback/post-play panels
  // can read it. On resolve we dispatch SET_TITLE_DETAIL so the UI reacts
  // (the rail reads SessionState.titleDetail). Errors are swallowed; the
  // panels fall back to honest placeholders if it never resolves.
  if (!localPlayback) {
    void fetchTitleDetail(title.id, title.type, undefined, {
      externalIds: title.externalIds,
      isAnime: stateManager.getState().mode === "anime" || title.isAnime === true,
    })
      .then((detail) => {
        stateManager.dispatch({
          type: "SET_TITLE_DETAIL",
          titleId: title.id,
          titleType: detail.type,
          detail,
        });
        return undefined;
      })
      .catch(() => undefined);
  }

  // Kick off timing fetch in parallel with everything else — IntroDB is a
  // lightweight API call and should resolve well before stream resolution.
  // Uses the configured provider for the warm path; after resolve we re-key
  // on the successful provider when they differ.
  recordStartupMark("timing-fetch-started");
  const configuredTimingProviderId = localPlayback ? undefined : sourceProviderId;
  const timingFetch = shouldFetchPlaybackTiming({
    networkAllowed: playbackNetworkAllowed,
    hasTiming: false,
  })
    ? getPlaybackTimingMetadata(
        title,
        currentEpisode,
        playbackTimingByEpisode,
        resolveController.signal,
        stateManager.getState().mode === "anime",
        configuredTimingProviderId,
        container.diagnosticsService,
      )
    : Promise.resolve(null);

  const watchedEntries = historyRepository.listByTitleIdentity(historyTitleLookup);
  const playbackMode = stateManager.getState().mode;
  const isAnimePlayback = playbackMode === "anime";
  const episodeLoadCache = new Map<string, Promise<Awaited<ReturnType<typeof fetchEpisodes>>>>();
  const loadEpisodesOnce = (tmdbId: string, season: number) => {
    const cacheKey = `${tmdbId}:${season}`;
    const cached = episodeLoadCache.get(cacheKey);
    if (cached) return cached;
    const task = fetchEpisodes(tmdbId, season);
    episodeLoadCache.set(cacheKey, task);
    return task;
  };

  stateManager.dispatch({
    type: "SET_PLAYBACK_STATUS",
    status: "loading",
  });
  stateManager.dispatch({ type: "SET_RESOLVE_RETRY_COUNT", count: 0 });
  updatePlaybackFeedback(context, {
    detail: localPlayback ? "Preparing downloaded episode" : "Preparing episode metadata",
    note: localPlayback
      ? "Reading local files and episode navigation"
      : "Warming episode names, navigation, and artwork",
  });

  const currentAnimeEpisodesPromise =
    sourceAuthority.kind === "local"
      ? Promise.resolve(undefined)
      : getAnimeEpisodeOptions({
          title,
          mode: playbackMode,
          provider: sourceAuthority.provider,
          cache: animeEpisodeCatalogByProvider,
          languages: playbackEpisodeCatalogLanguages({ mode: playbackMode, title, config }),
          signal: resolveController.signal,
        });
  // The picker's downloaded marks and the autoplay cursor below must ask
  // for the same id an asset is filed under; canonicalising here on its
  // own left an enriched title looking up an id no asset row holds.
  const offlineTitleId = container.offlineTitleIdentity.resolveForTitle(title, playbackMode);
  const downloadedEpisodes = new Set(
    container.offlineAssetService
      .listTitleAssets(offlineTitleId)
      .filter((asset) => asset.state === "ready")
      .map((asset) => `${asset.season ?? 1}:${asset.episode ?? 1}`),
  );
  // Continue-path titles rebuilt from history often lack episodeCount;
  // the cached catalog detail knows it, so the picker never collapses
  // to a single "Episode N" entry when the provider list is missing.
  const knownEpisodeCount =
    title.episodeCount ?? peekTitleDetail(title.id, title.type)?.episodeCount;
  const shellEpisodePickerPromise = currentAnimeEpisodesPromise.then((currentAnimeEpisodes) =>
    buildPlaybackEpisodePickerOptions({
      title,
      currentEpisode,
      isAnime: isAnimePlayback,
      networkAllowed: playbackNetworkAllowed,
      animeEpisodeCount: knownEpisodeCount,
      animeEpisodes: currentAnimeEpisodes,
      watchedEntries,
      downloadedEpisodes,
      localEpisodes: localPlayback
        ? listReadyEpisodes(container.offlineAssetService, offlineTitleId)
        : undefined,
      loadEpisodes: loadEpisodesOnce,
    }),
  );
  const episodeAvailabilityPromise = localPlayback
    ? // Availability comes from the offline library, not the catalog. An
      // all-null answer here reads as "series finished" to
      // playback-result-policy, so downloaded E1 would never advance to
      // downloaded E2 and `n` would be dead. This keeps the launch free
      // of TMDB/anime-catalog calls while still answering truthfully.
      Promise.resolve({
        previousEpisode: null,
        nextEpisode: findNextReadyEpisode(
          container.offlineAssetService,
          offlineTitleId,
          currentEpisode,
        ),
        nextSeasonEpisode: null,
        upcomingNext: null,
        animeNextReleaseUnknown: false,
        tmdbUnavailable: false,
      })
    : currentAnimeEpisodesPromise.then((currentAnimeEpisodes) =>
        resolveEpisodeAvailability({
          title,
          currentEpisode,
          isAnime: isAnimePlayback,
          animeEpisodeCount: knownEpisodeCount,
          animeEpisodes: currentAnimeEpisodes,
          loaders: {
            loadSeasons: fetchSeasons,
            loadEpisodes: loadEpisodesOnce,
          },
        }),
      );
  const [currentAnimeEpisodes, shellEpisodePicker, episodeAvailability] = await Promise.all([
    currentAnimeEpisodesPromise,
    shellEpisodePickerPromise,
    episodeAvailabilityPromise,
  ]);
  stateManager.dispatch({
    type: "SET_CURRENT_ANIME_EPISODES",
    episodes: currentAnimeEpisodes ?? null,
  });
  recordStartupMark("episode-context-ready");

  const navigationState = toEpisodeNavigationState(title.type, episodeAvailability, {
    isAnime: stateManager.getState().mode === "anime",
  });
  stateManager.dispatch({
    type: "SET_EPISODE_NAVIGATION",
    navigation: navigationState,
  });
  playerControl.setEpisodeNavigationAvailability(navigationState);

  if (episodeAvailability.tmdbUnavailable) {
    diagnosticsService.record({
      category: "provider",
      message: "TMDB metadata unavailable — episode navigation disabled",
      context: {
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
      },
    });
  }

  const profileContext = {
    overrides: stateManager.getState().playbackTrackPreferences,
    mode: stateManager.getState().mode,
    title,
    config,
  };

  const buildPrefetchTarget = (
    nextEpisodeIntent: EpisodeInfo,
    providerId: string,
  ): EpisodePrefetchTarget => {
    const targetSelection = getPreferredStreamSelection(providerId, nextEpisodeIntent);
    return {
      titleId: title.id,
      episode: nextEpisodeIntent,
      providerId,
      sourceId: targetSelection.sourceId ?? undefined,
      streamId: targetSelection.streamId ?? undefined,
      audioPreference: playbackAudioPreference(profileContext),
      qualityPreference: playbackQualityPreference(profileContext),
      startupPriority: config.startupPriority,
      subtitlePreference: playbackSubtitlePreference(profileContext),
    };
  };
  return {
    playbackNetworkAllowed,
    configuredTimingProviderId,
    timingFetch,
    watchedEntries,
    isAnimePlayback,
    offlineTitleId,
    currentAnimeEpisodes,
    shellEpisodePicker,
    episodeAvailability,
    profileContext,
    buildPrefetchTarget,
  };
}
