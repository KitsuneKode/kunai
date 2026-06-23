import type { Container } from "@/container";
import { mediaLanguageProfileFor } from "@/domain/media/content-kind";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

import { DownloadEnqueueRejectedError } from "./DownloadService";

export type OfflineCleanupPolicy =
  | { readonly mode: "keep-last-watched"; readonly count: number }
  | { readonly mode: "cleanup-watched"; readonly graceDays: number };

export type DownloadConfirmationProfile = {
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly cacheArtwork: boolean;
  readonly outputDirectory?: string;
  readonly enrollKeepWatchingOffline: boolean;
  readonly runwayTarget?: number;
  readonly cleanupPolicy: OfflineCleanupPolicy;
};

export type DownloadIntentCommitInput = {
  readonly title: TitleInfo;
  readonly episodes: readonly EpisodeInfo[];
  readonly profile: DownloadConfirmationProfile;
};

export type DownloadIntentCommitResult = {
  readonly status: "queued" | "none" | "blocked";
  readonly queuedCount: number;
};

/**
 * Default confirmation profile derived from the active session language profile
 * and offline config. Interactive surfaces start from this and let the user edit
 * it; non-interactive callers (the media-action router) commit it as-is.
 */
export function buildDefaultDownloadProfile(
  container: Container,
  options: { readonly outputDirectory?: string } = {},
): DownloadConfirmationProfile {
  const state = container.stateManager.getState();
  const language = mediaLanguageProfileFor(state);
  return {
    audioPreference: language.audio,
    subtitlePreference: language.subtitle,
    qualityPreference: language.quality,
    cacheArtwork: container.config.offlineArtworkCacheEnabled,
    outputDirectory: options.outputDirectory || container.config.downloadPath || undefined,
    enrollKeepWatchingOffline: false,
    runwayTarget: container.config.offlineDefaultRunwayTarget,
    cleanupPolicy: { mode: "keep-last-watched", count: 1 },
  };
}

/**
 * Resolve the episodes to queue for a non-interactive download intent. Movies are
 * a single slot; series fall back to the carried season/episode when present
 * (e.g. a new-episode notification), otherwise the first episode.
 */
export function resolveDownloadIntentEpisodes(input: {
  readonly title: TitleInfo;
  readonly season?: number;
  readonly episode?: number;
}): readonly EpisodeInfo[] {
  if (input.title.type === "movie") return [{ season: 1, episode: 1 }];
  if (typeof input.season === "number" && typeof input.episode === "number") {
    return [{ season: input.season, episode: input.episode }];
  }
  return [{ season: 1, episode: 1 }];
}

/**
 * Single source of truth for committing a confirmed download intent: re-checks
 * eligibility, enqueues each episode, persists the offline title policy, and
 * surfaces feedback. Both `DownloadOnlyPhase` (after interactive confirmation)
 * and the media-action router call this so download behaviour is identical.
 */
export async function commitDownloadIntent(
  container: Container,
  input: DownloadIntentCommitInput,
): Promise<DownloadIntentCommitResult> {
  const eligibility = container.downloadService.getEnqueueEligibility();
  if (!eligibility.allowed) {
    container.diagnosticsService.record({
      category: "download",
      message: "Download intent enqueue blocked",
      context: { code: eligibility.code, reason: eligibility.reason },
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    return { status: "blocked", queuedCount: 0 };
  }

  const { title, episodes, profile } = input;
  if (episodes.length === 0) return { status: "none", queuedCount: 0 };

  const state = container.stateManager.getState();
  const existingPolicy =
    title.type !== "movie" ? container.offlineTitlePolicies.get(title.id) : undefined;

  const persistSeriesPolicy = () => {
    if (title.type === "movie") return;
    const enrolled = profile.enrollKeepWatchingOffline || existingPolicy?.enrolled === true;
    container.offlineTitlePolicies.upsert({
      titleId: title.id,
      titleName: title.name,
      mediaKind: state.mode === "anime" ? "anime" : "series",
      enrolled,
      runwayTarget: profile.enrollKeepWatchingOffline
        ? (profile.runwayTarget ?? container.config.offlineDefaultRunwayTarget)
        : (existingPolicy?.runwayTarget ??
          profile.runwayTarget ??
          container.config.offlineDefaultRunwayTarget),
      profileJson: JSON.stringify({
        audio: profile.audioPreference,
        subtitle: profile.subtitlePreference,
        quality: profile.qualityPreference,
        cacheArtwork: profile.cacheArtwork,
      }),
      cleanupJson: JSON.stringify(profile.cleanupPolicy),
      pausedReason: profile.enrollKeepWatchingOffline ? undefined : existingPolicy?.pausedReason,
      updatedAt: new Date().toISOString(),
    });
    if (profile.enrollKeepWatchingOffline) {
      container.offlineRunwayService.enqueueEvaluation(title.id, "policy-change");
    }
  };

  let queuedCount = 0;
  let lastJobId: string | undefined;
  try {
    for (const episode of episodes) {
      const job = await container.downloadService.enqueue({
        title,
        episode,
        providerId: state.provider,
        mode: state.mode,
        audioPreference: profile.audioPreference,
        subtitlePreference: profile.subtitlePreference,
        qualityPreference: profile.qualityPreference,
        outputDirectory: profile.outputDirectory,
        posterUrl: profile.cacheArtwork ? title.posterUrl : undefined,
      });
      lastJobId = job.id;
      queuedCount += 1;
    }
  } catch (error) {
    const message =
      error instanceof DownloadEnqueueRejectedError
        ? error.reason
        : error instanceof Error
          ? error.message
          : String(error);
    container.diagnosticsService.record({
      category: "download",
      message: "Download intent batch enqueue stopped",
      context: { queuedCount, error: message, titleId: title.id },
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        queuedCount > 0
          ? `Queued ${queuedCount} download(s), then stopped: ${message}`
          : `Download failed: ${message}`,
    });
    if (queuedCount > 0) persistSeriesPolicy();
    void container.downloadService.processQueue();
    return { status: queuedCount > 0 ? "queued" : "none", queuedCount };
  }

  container.diagnosticsService.record({
    category: "download",
    operation: "download.profile.confirmed",
    message: "Download intent job(s) queued",
    context: {
      jobId: lastJobId,
      count: queuedCount,
      titleId: title.id,
      titleName: title.name,
      cacheArtwork: profile.cacheArtwork,
      keepWatchingOffline: profile.enrollKeepWatchingOffline,
      runwayTarget: profile.runwayTarget ?? null,
    },
  });
  persistSeriesPolicy();
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note:
      queuedCount === 1
        ? `Download queued: ${title.name}`
        : `Downloads queued: ${queuedCount} episodes · ${title.name}`,
  });
  void container.downloadService.processQueue();
  return { status: "queued", queuedCount };
}
