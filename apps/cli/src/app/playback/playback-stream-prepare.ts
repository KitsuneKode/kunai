// =============================================================================
// Playback stream preparation
//
// Readies a resolved stream for the player (subtitle choice, including the
// interactive picker) and builds the next-episode prefetch bundle — resolve
// plus the same preparation — on the near-need lane.
// =============================================================================

import { buildPickerActionContext, openSubtitlePicker } from "@/app-shell/workflows";
import {
  type EpisodePrefetchBundle,
  type EpisodePrefetchProgress,
  type EpisodePrefetchTarget,
} from "@/app/playback/episode-prefetch";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import { shouldSkipExternalSubtitleLookup } from "@/app/playback/source-quality";
import { choosePlaybackSubtitle } from "@/app/playback/subtitle-selection";
import type { PhaseContext } from "@/app/session/Phase";
import type { TitleInfo, EpisodeInfo, StreamInfo } from "@/domain/types";

export async function preparePlaybackStream(
  stream: StreamInfo,
  title: TitleInfo,
  episode: EpisodeInfo,
  context: PhaseContext,
): Promise<StreamInfo> {
  const { stateManager, logger, config } = context.container;
  const subLang = playbackSubtitlePreference({
    overrides: stateManager.getState().playbackTrackPreferences,
    mode: stateManager.getState().mode,
    title,
    config,
  });

  if (shouldSkipExternalSubtitleLookup(stream, subLang)) {
    logger.info("Subtitle resolution skipped", {
      provider: stateManager.getState().provider,
      titleId: title.id,
      requestedSubLang: subLang,
      reason: "hardsub-satisfied-or-disabled",
    });
    return subLang === "none" ? { ...stream, subtitle: undefined } : stream;
  }

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
  context.container.diagnosticsService.record({
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

export async function resolveEpisodePrefetchBundle(
  context: PhaseContext,
  input: {
    readonly title: TitleInfo;
    readonly nextEpisode: EpisodeInfo;
    readonly providerId: string;
    readonly target?: EpisodePrefetchTarget;
    readonly onProgress?: (progress: EpisodePrefetchProgress) => void;
    readonly signal: AbortSignal;
  },
): Promise<EpisodePrefetchBundle | null> {
  const { config, stateManager, playbackResolveWork } = context.container;
  const mode = stateManager.getState().mode;
  const profileCtx = {
    mode,
    title: input.title,
    config: config.getRaw(),
    overrides: stateManager.getState().playbackTrackPreferences,
  };
  const subLang = playbackSubtitlePreference(profileCtx);
  const isInteractiveSubtitle = subLang === "interactive" || subLang === "fzf";

  const stream = await playbackResolveWork.prefetch(
    {
      title: input.title,
      episode: input.nextEpisode,
      mode,
      providerId: input.providerId,
      audioPreference: playbackAudioPreference(profileCtx),
      subtitlePreference: playbackSubtitlePreference(profileCtx),
      qualityPreference: playbackQualityPreference(profileCtx),
      startupPriority: config.startupPriority,
      selectedSourceId: input.target?.sourceId,
      selectedStreamId: input.target?.streamId,
      recoveryMode: config.recoveryMode,
      signal: input.signal,
      onEvent: (event) => {
        if (event.type === "cache-hit" || event.type === "cache-hit-validated") {
          input.onProgress?.({ exactStreamCacheHit: true });
        } else if (event.type === "source-inventory-hit") {
          input.onProgress?.({ sourceInventoryHit: true, streamValidationActive: true });
        } else if (event.type === "provider-resolve-started") {
          input.onProgress?.({ providerResolveActive: true });
        } else if (event.type === "attempt" && event.attempt > 1) {
          input.onProgress?.({ fallbackAttemptStarted: true });
        }
      },
    },
    { intentKind: "prefetch", budgetLane: "near-need" },
  );

  if (!stream) return null;
  input.onProgress?.({ videoReady: true, candidateStreamsReturned: true });

  const target: EpisodePrefetchTarget = input.target ?? {
    titleId: input.title.id,
    episode: input.nextEpisode,
    providerId: input.providerId,
    audioPreference: playbackAudioPreference(profileCtx),
    qualityPreference: playbackQualityPreference(profileCtx),
    startupPriority: config.startupPriority,
    subtitlePreference: playbackSubtitlePreference(profileCtx),
  };
  const resolvedProviderId = stream.providerId;

  if (isInteractiveSubtitle) {
    return { target, stream: stream.stream, prepared: false, resolvedProviderId };
  }

  const preparedStream = await preparePlaybackStream(
    stream.stream,
    input.title,
    input.nextEpisode,
    context,
  );

  return { target, stream: preparedStream, prepared: true, resolvedProviderId };
}
