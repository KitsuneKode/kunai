import type { Container } from "@/container";
import { isTitleLevelContent, mediaLanguageProfileFor } from "@/domain/media/content-kind";
import { formatMediaItemCount } from "@/domain/media/media-presentation";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { buildDownloadDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import type { MediaKind } from "@kunai/types";

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

/**
 * One thing to download. A movie or a video is the title itself; a series or
 * anime download names an episode. Modelling this as a union is what stops a
 * movie from carrying a synthetic season 1 / episode 1 into storage.
 */
export type DownloadIntentItem =
  | { readonly kind: "title" }
  | { readonly kind: "episode"; readonly episode: EpisodeInfo };

export type DownloadIntentCommitInput = {
  readonly title: TitleInfo;
  /** Authoritative content kind. Never re-derived from `title.type`. */
  readonly mediaKind: MediaKind;
  readonly items: readonly DownloadIntentItem[];
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
  const language = mediaLanguageProfileFor({
    mode: state.mode,
    currentTitle: state.currentTitle,
    animeLanguageProfile: state.animeLanguageProfile,
    seriesLanguageProfile: state.seriesLanguageProfile,
    movieLanguageProfile: state.movieLanguageProfile,
    youtubeLanguageProfile: container.config.youtubeLanguageProfile,
  });
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
 * Resolve what to queue for a non-interactive download intent.
 *
 * Title-level structure (and videos) has no episode slot. Series and anime use
 * the carried season/episode when present (e.g. a new-episode notification),
 * and only they fall back to the first episode. An anime film therefore keeps
 * its anime identity while using its movie structure.
 */
export function resolveDownloadIntentItems(input: {
  readonly title: TitleInfo;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
}): readonly DownloadIntentItem[] {
  if (isTitleLevelContent(input.mediaKind, input.title.type)) return [{ kind: "title" }];
  if (typeof input.season === "number" && typeof input.episode === "number") {
    return [{ kind: "episode", episode: { season: input.season, episode: input.episode } }];
  }
  return [{ kind: "episode", episode: { season: 1, episode: 1 } }];
}

/** The enqueue playback mode implied by an authoritative content kind. */
function enqueueModeForMediaKind(mediaKind: MediaKind): "youtube" | "anime" | "series" {
  if (mediaKind === "video") return "youtube";
  if (mediaKind === "anime") return "anime";
  return "series";
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
    container.diagnosticsService.record(
      buildDownloadDiagnosticEvent({
        operation: "download.intent.blocked",
        status: "skipped",
        severity: "blocked",
        message: "Download intent enqueue blocked",
        recommendedAction: "check-dependency",
        context: { code: eligibility.code, reason: eligibility.reason },
      }),
    );
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    return { status: "blocked", queuedCount: 0 };
  }

  const { title, mediaKind, items, profile } = input;
  if (items.length === 0) return { status: "none", queuedCount: 0 };
  const mode = enqueueModeForMediaKind(mediaKind);
  const isTitleLevel = isTitleLevelContent(mediaKind, title.type);

  const state = container.stateManager.getState();
  const existingPolicy = isTitleLevel ? undefined : container.offlineTitlePolicies.get(title.id);

  const persistSeriesPolicy = () => {
    if (isTitleLevel) return;
    const enrolled = profile.enrollKeepWatchingOffline || existingPolicy?.enrolled === true;
    container.offlineTitlePolicies.upsert({
      titleId: title.id,
      titleName: title.name,
      mediaKind: mediaKind === "anime" ? "anime" : "series",
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
    for (const item of items) {
      const job = await container.downloadService.enqueue({
        title,
        episode: item.kind === "episode" ? item.episode : undefined,
        providerId: state.provider,
        mode,
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
    container.diagnosticsService.record(
      buildDownloadDiagnosticEvent({
        operation: "download.intent.enqueue.failed",
        status: "failed",
        severity: queuedCount > 0 ? "recoverable" : "blocked",
        failureClass: "storage",
        message: "Download intent batch enqueue stopped",
        titleId: title.id,
        context: { queuedCount, error: message, titleId: title.id },
      }),
    );
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

  container.diagnosticsService.record(
    buildDownloadDiagnosticEvent({
      operation: "download.profile.confirmed",
      status: "succeeded",
      severity: "healthy",
      recommendedAction: "none",
      message: "Download intent job(s) queued",
      titleId: title.id,
      correlation: lastJobId ? { downloadJobId: lastJobId } : undefined,
      context: {
        jobId: lastJobId,
        count: queuedCount,
        titleId: title.id,
        titleName: title.name,
        cacheArtwork: profile.cacheArtwork,
        keepWatchingOffline: profile.enrollKeepWatchingOffline,
        runwayTarget: profile.runwayTarget ?? null,
      },
    }),
  );
  persistSeriesPolicy();
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note:
      queuedCount === 1
        ? `Download queued: ${title.name}`
        : `Downloads queued: ${formatMediaItemCount({
            mediaKind,
            contentType: title.type,
            count: queuedCount,
          })} · ${title.name}`,
  });
  void container.downloadService.processQueue();
  return { status: "queued", queuedCount };
}
