// =============================================================================
// Next-episode prefetch for one playback iteration
//
// While an episode plays, near EOF the next episode's stream is resolved (and
// prepared) in the background on the near-need lane, and the post-play
// recommendation rail is warmed. Episode navigation then adopts the bundle,
// waiting a short grace window if it is still in flight.
// =============================================================================

import {
  type EpisodePrefetchTarget,
  adoptEpisodePrefetchBundle,
  isEpisodePrefetchEligible,
  type EpisodePrefetchProgress,
} from "@/app/playback/episode-prefetch";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import type { PlaybackLoopState } from "@/app/playback/playback-phase-session";
import { resolveEpisodePrefetchBundle } from "@/app/playback/playback-stream-prepare";
import type { ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import type { SearchResult } from "@/domain/types";

export type NextEpisodePrefetch = {
  /** The prefetch target for the following episode, or null when there is none to prefetch. */
  readonly buildNextPrefetchTarget: () => EpisodePrefetchTarget | null;
  /** Adopt the target's prefetch for an episode handoff, waiting out a short grace window. */
  readonly handoffNextEpisodePrefetch: (
    target: EpisodePrefetchTarget,
    operation: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
  ) => Promise<void>;
  /** Near-EOF hook: schedule the next episode's prefetch and warm recommendations. */
  readonly maybePrefetchNext: () => Promise<void>;
  /** Recommendations warmed in the background; null until they land. */
  readonly prefetchedRecommendationItems: readonly SearchResult[] | null;
};

export function createNextEpisodePrefetch(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  ready: ReadyEpisodeStream,
): NextEpisodePrefetch {
  const { context, title, run, selectionCoordinator, episodePrefetch } = loop;
  const { container } = context;
  const { providerRegistry, stateManager, diagnosticsService } = container;
  const { sourceAuthority } = attempt;
  const { playbackNetworkAllowed, episodeAvailability, buildPrefetchTarget } = episodeContext;
  const { providerHandoff } = ready;
  let prefetchedRecommendationItems: readonly SearchResult[] | null = null;
  let nextPrefetchProgress: EpisodePrefetchProgress = {};
  const buildNextPrefetchTarget = (): EpisodePrefetchTarget | null => {
    if (sourceAuthority.kind !== "provider") return null;
    const nextEp = episodeAvailability.nextEpisode;
    if (!nextEp) return null;
    const prefetchProviderId = providerHandoff.nextEpisodeProviderId;
    if (!providerRegistry.get(prefetchProviderId)) return null;
    return buildPrefetchTarget(nextEp, prefetchProviderId);
  };
  const handoffNextEpisodePrefetch = async (
    target: EpisodePrefetchTarget,
    operation: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
  ) => {
    if (sourceAuthority.kind !== "provider") return;
    await adoptEpisodePrefetchBundle({
      handle: episodePrefetch,
      target,
      run: (signal) => runNextEpisodePrefetch(signal, target),
      getProgress: () => nextPrefetchProgress,
      onWaiting: () =>
        updatePlaybackFeedback(context, {
          detail: "Preparing next episode",
          note: "Still preparing a source in the background",
        }),
      recordWait: (wait) => {
        diagnosticsService.record({
          category: "playback",
          operation,
          message: wait.bundle
            ? "Prefetch completed during episode handoff wait"
            : "Prefetch grace window elapsed during episode handoff",
          context: {
            titleId: title.id,
            nextSeason: target.episode.season,
            nextEpisode: target.episode.episode,
            completed: wait.bundle !== null,
            waitResult: wait.outcome,
            waitedMs: wait.waitedMs,
            prepared: wait.bundle?.prepared ?? false,
          },
        });
      },
    });
  };
  const runNextEpisodePrefetch = (signal: AbortSignal, target: EpisodePrefetchTarget) => {
    if (sourceAuthority.kind !== "provider") return Promise.resolve(null);
    const nextEp = target.episode;
    const prefetchMetadata = providerRegistry.get(target.providerId);
    if (!prefetchMetadata) {
      return Promise.resolve(null);
    }
    return resolveEpisodePrefetchBundle(context, {
      title,
      nextEpisode: nextEp,
      providerId: prefetchMetadata.metadata.id,
      target,
      onProgress: (progress) => {
        nextPrefetchProgress = { ...nextPrefetchProgress, ...progress };
      },
      signal,
    })
      .then((bundle) => {
        if (bundle) {
          diagnosticsService.record({
            category: "playback",
            message: "Prefetch resolved successfully",
            context: {
              titleId: title.id,
              nextSeason: nextEp.season,
              nextEpisode: nextEp.episode,
              providerId: prefetchMetadata.metadata.id,
              resolvedProviderId: bundle.resolvedProviderId,
              prepared: bundle.prepared,
            },
          });
        }
        return bundle;
      })
      .catch((err) => {
        diagnosticsService.record({
          category: "playback",
          level: "warn",
          message: "Prefetch resolve failed",
          context: {
            titleId: title.id,
            nextSeason: nextEp.season,
            nextEpisode: nextEp.episode,
            providerId: prefetchMetadata.metadata.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return null;
      });
  };
  const maybePrefetchNext = async () => {
    if (sourceAuthority.kind !== "provider" || container.config.powerSaverMode) {
      return;
    }
    if (
      !isEpisodePrefetchEligible({
        titleType: title.type,
        hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
        stopAfterCurrent: run.playbackSession.stopAfterCurrent,
        sessionMode: run.playbackSession.mode,
        autoplayPaused: run.playbackSession.autoplayPaused,
        networkAllowed: playbackNetworkAllowed,
      })
    ) {
      return;
    }
    const nextEp = episodeAvailability.nextEpisode;
    const prefetchProviderId = providerHandoff.nextEpisodeProviderId;
    const prefetchMetadata = providerRegistry.get(prefetchProviderId);
    if (nextEp && prefetchMetadata) {
      await selectionCoordinator.hydrate(prefetchMetadata.metadata.id, nextEp);
    }
    const target = buildNextPrefetchTarget();
    if (!target) return;
    nextPrefetchProgress = {};
    episodePrefetch.schedule(target, (signal) => runNextEpisodePrefetch(signal, target));

    if (
      container.config.recommendationRailEnabled &&
      prefetchedRecommendationItems === null &&
      stateManager.getState().mode !== "youtube" &&
      !title.id.startsWith("youtube") &&
      // TMDB recommendations need a TMDB id. Anime titles carry AniList
      // ids (often bare numbers), which TMDB would read as an unrelated
      // show; anime post-play uses the AniList recommendations path.
      stateManager.getState().mode !== "anime" &&
      title.isAnime !== true
    ) {
      container.backgroundWorkScheduler.enqueue({
        id: `recommendation-prefetch:${title.type}:${title.id}`,
        lane: "recommendation-warm",
        signal: context.signal,
        run: async () => {
          const section = await container.recommendationService.getForTitle(title.id, title.type);
          prefetchedRecommendationItems = section.items.filter(
            (item) => item.title.trim().length > 0,
          );
        },
      });
      void container.backgroundWorkScheduler.drain();
    }
  };
  return {
    buildNextPrefetchTarget,
    handoffNextEpisodePrefetch,
    maybePrefetchNext,
    get prefetchedRecommendationItems() {
      return prefetchedRecommendationItems;
    },
  };
}
