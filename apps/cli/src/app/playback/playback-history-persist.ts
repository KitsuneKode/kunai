// =============================================================================
// Playback history persistence at episode end
//
// Records what the episode actually achieved: resume position, completion
// (only a clean natural EOF marks it complete), last-watched bump, the tracker
// outbox mirror and release reconciliation, soft-fallback promotion once the
// user really engaged, the title-scoped provider suggestion, and the offline
// runway re-evaluation after a downloaded episode completes. A playback that
// did not earn a history write discards the ledger instead.
// =============================================================================

import { resolveTitleHistoryLookupId } from "@/app/bootstrap/title-info";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import { episodeIdentityForHistory } from "@/app/playback/playback-history-identity";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import type { PlaybackLoopState } from "@/app/playback/playback-phase-session";
import { promoteSoftFallbackAfterEngage } from "@/app/playback/playback-provider-switch";
import type { AcquiredStream, ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  shouldMarkEpisodeCompleted,
} from "@/domain/playback/playback-policy";
import {
  evaluateProgressEngage,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";
import type { PlaybackResult } from "@/domain/types";
import { queueHistoryMirror } from "@/services/media-actions/create-container-media-action-router";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";

export async function persistEpisodeHistory(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  acquired: AcquiredStream,
  ready: ReadyEpisodeStream,
  result: PlaybackResult,
): Promise<void> {
  const { context, host, title, run } = loop;
  const { container } = context;
  const { stateManager, config, diagnosticsService } = container;
  const { currentEpisode, sourceAuthority, sourceProviderId } = attempt;
  const { playbackNetworkAllowed } = episodeContext;
  const { streamProvenance } = acquired;
  const { effectiveTiming } = ready;
  // Save history — use effectiveTiming.current so that a background retry
  // that completed during playback is reflected in completion status.
  const quitThresholdMode = config.quitNearEndThresholdMode;
  if (
    container.player.capabilities.completion &&
    shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode)
  ) {
    const didComplete = didPlaybackReachCompletionThreshold(
      result,
      effectiveTiming.current,
      quitThresholdMode,
    );
    // History durability: completed:true is forever — it clears the
    // resume point. Only a clean natural EOF sets it; voluntary quit,
    // kill, crash, timeout, or keep-open no-end-file stays resumable
    // even past the threshold.
    const shouldMarkCompleted = shouldMarkEpisodeCompleted(
      result,
      effectiveTiming.current,
      quitThresholdMode,
    );
    const evidence = trustedProgressFromPlaybackResult(result);
    const decision = evaluateProgressEngage(evidence, {
      reachedCompletionThreshold: didComplete,
    });
    let historyTimestamp = toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode);
    const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
      providerId: attempt.resolvedProviderId,
    });
    const historyTitleId = resolveTitleHistoryLookupId(title, stateManager.getState().mode);
    const episodeIdentity = episodeIdentityForHistory(title, currentEpisode);
    const titleIdentity = {
      id: title.id,
      kind: persistedKind,
      title: title.name,
      externalIds: enrichExternalIdsWithVideoMeta(
        title.externalIds,
        stateManager.getState().videoMeta,
      ),
    };
    // One read serves both the did-not-start resume check and the
    // last-watched bump below: this teardown used to issue the same
    // identity lookup twice (~8 sequential queries each) per episode end.
    const existingProgress = container.historyRepository.getProgressForTitleIdentity(
      titleIdentity,
      episodeIdentity,
    );
    if (decision.isDidNotStart) {
      if (existingProgress && existingProgress.positionSeconds > 0) {
        historyTimestamp = existingProgress.positionSeconds;
      }
    }
    const lastWatchedAt = decision.shouldBumpLastWatched
      ? new Date().toISOString()
      : (existingProgress?.lastWatchedAt ?? existingProgress?.updatedAt ?? null);
    const activeLedger = host.ledger.current;
    if (activeLedger) {
      activeLedger.finalize({
        positionSeconds: historyTimestamp,
        durationSeconds: result.duration,
        completed: shouldMarkCompleted,
        providerId: attempt.resolvedProviderId,
        posterUrl: title.posterUrl,
        bumpLastWatched: decision.shouldBumpLastWatched,
      });
      host.ledger.release();
    } else {
      container.historyRepository.upsertProgress({
        title: titleIdentity,
        episode: episodeIdentity,
        positionSeconds: historyTimestamp,
        durationSeconds: result.duration,
        completed: shouldMarkCompleted,
        watchedSeconds: didComplete ? result.duration : historyTimestamp,
        lastWatchedAt,
        completedAt: shouldMarkCompleted ? new Date().toISOString() : null,
        providerId: attempt.resolvedProviderId,
        posterUrl: title.posterUrl,
        updatedAt: new Date().toISOString(),
      });
    }
    if (sourceAuthority.kind === "provider")
      await promoteSoftFallbackAfterEngage(container, {
        title,
        mode: stateManager.getState().mode,
        sessionSoftProviderId: run.sessionSoftProviderId,
        configuredProviderId: sourceProviderId,
        engaged: decision.isEngaged,
      });
    const savedHistoryRow = container.historyRepository.getLatestForTitle(historyTitleId);
    if (savedHistoryRow) {
      // Enqueued from the row that was actually persisted, not from the
      // in-flight result: the outbox must never describe progress the
      // local history does not have. This only writes SQLite — remote
      // delivery is the drain's job, so playback never waits on a
      // tracker, and repeated updates coalesce instead of stacking up.
      // Admission reads the live opt-in before it writes the outbox.
      // Keep that asynchronous check outside the playback teardown:
      // persistence is already complete and tracker work is optional.
      queueHistoryMirror(container, historyTitleId, savedHistoryRow);
    }
    if (playbackNetworkAllowed) {
      enqueueReleaseReconciliation(
        container,
        savedHistoryRow ? [savedHistoryRow] : [],
        "post-playback",
        context.signal,
      );
    }
    const providerSuggestion =
      sourceAuthority.kind === "provider"
        ? container.titleProviderHealth.getSwitchSuggestion(title.id, sourceProviderId)
        : null;
    if (providerSuggestion) {
      updatePlaybackFeedback(context, {
        note: `${providerSuggestion.providerId} struggled with this title. ${providerSuggestion.suggestedProviderId} worked; choose it from providers for this title.`,
      });
      diagnosticsService.record({
        category: "provider",
        operation: "provider.title-health.suggestion",
        message: "Title-scoped provider switch suggestion available at episode boundary",
        context: {
          titleId: title.id,
          providerId: providerSuggestion.providerId,
          suggestedProviderId: providerSuggestion.suggestedProviderId,
        },
      });
    }
    if (shouldMarkCompleted) {
      const epStr =
        title.type === "series"
          ? ` S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`
          : "";
      updatePlaybackFeedback(context, {
        note: `✓ ${title.name}${epStr} · episode complete`,
      });
      if (streamProvenance === "local" && run.localPlaybackJobId) {
        container.offlineRunwayService.enqueueEvaluation(title.id, "offline-playback-complete");
      }
    }
  } else {
    host.ledger.discard();
    diagnosticsService.record({
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
}
