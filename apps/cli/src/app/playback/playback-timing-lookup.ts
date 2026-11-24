// =============================================================================
// Playback timing (intro/recap/credits) lookups
//
// IntroDB + AniSkip through the shared aggregator, a per-phase cache keyed by
// title/episode/provider, per-source diagnostics, and the background retry that
// injects late timing into the running player.
// =============================================================================
import type { PhaseContext } from "@/app/session/Phase";
import type { TitleInfo, EpisodeInfo, PlaybackTimingMetadata } from "@/domain/types";
import {
  AniSkipTimingSource,
  IntroDbTimingSource,
  PlaybackTimingAggregator,
  type PlaybackTimingOutcomeClass,
  type PlaybackTimingSourceOutcome,
} from "@/infra/timing";
import {
  buildPlaybackDiagnosticEvent,
  type DiagnosticFailureClass,
} from "@/services/diagnostics/diagnostic-event-helpers";

const timingAggregator = new PlaybackTimingAggregator([IntroDbTimingSource, AniSkipTimingSource]);

export function playbackTimingCacheKey(
  title: TitleInfo,
  episode: EpisodeInfo,
  providerId?: string,
): string {
  const providerPart = providerId ?? "";
  if (title.type === "movie") return `movie:${title.id}:${providerPart}`;
  return `series:${title.id}:${episode.season}:${episode.episode}:${providerPart}`;
}

function mapTimingOutcomeToDiagnosticFailure(
  failureClass: PlaybackTimingOutcomeClass,
): DiagnosticFailureClass | undefined {
  switch (failureClass) {
    case "timeout":
      return "timeout";
    case "offline":
      return "offline";
    case "http-error":
      return "http";
    case "not-found":
    case "identity-missing":
      return "not-found";
    case "cancelled":
      return "cancelled";
    case "not-applicable":
      return undefined;
  }
}

function recordTimingSourceDiagnostic(
  diagnostics: PhaseContext["container"]["diagnosticsService"],
  input: {
    readonly outcome: PlaybackTimingSourceOutcome;
    readonly titleId: string;
    readonly season?: number;
    readonly episode?: number;
    readonly providerId?: string;
  },
): void {
  const { outcome } = input;
  const failureClass = outcome.failureClass
    ? mapTimingOutcomeToDiagnosticFailure(outcome.failureClass)
    : undefined;
  diagnostics.record(
    buildPlaybackDiagnosticEvent({
      operation: "playback.timing.source",
      stage: outcome.source,
      status: outcome.failureClass
        ? outcome.failureClass === "cancelled"
          ? "cancelled"
          : outcome.failureClass === "timeout"
            ? "timed-out"
            : outcome.failureClass === "not-applicable"
              ? "skipped"
              : "failed"
        : "succeeded",
      severity: outcome.failureClass ? "recoverable" : "healthy",
      durationMs: outcome.durationMs,
      failureClass,
      message: outcome.failureClass
        ? `Timing source ${outcome.source}: ${outcome.failureClass}`
        : `Timing source ${outcome.source}: ok`,
      providerId: input.providerId,
      titleId: input.titleId,
      season: input.season,
      episode: input.episode,
      subject: {
        source: outcome.source,
        outcomeClass: outcome.failureClass,
      },
    }),
  );
}

export function retryTimingInBackground(
  title: TitleInfo,
  episode: EpisodeInfo,
  container: PhaseContext["container"],
  timingRef?: { current: PlaybackTimingMetadata | null },
  cache?: Map<string, PlaybackTimingMetadata | null>,
  isAnime?: boolean,
  providerIdOverride?: string,
): Promise<void> {
  return (async () => {
    const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
    const providerId = providerIdOverride ?? container.stateManager.getState().provider;
    const timing = await timingAggregator.resolve(
      title,
      episode,
      mode,
      AbortSignal.timeout(10_000),
      {
        providerId,
        onSourceOutcome: (outcome) =>
          recordTimingSourceDiagnostic(container.diagnosticsService, {
            outcome,
            titleId: title.id,
            season: episode.season,
            episode: episode.episode,
            providerId,
          }),
      },
    );
    if (timing) {
      if (timingRef) timingRef.current = timing;
      if (cache) {
        cache.set(playbackTimingCacheKey(title, episode, providerId), timing);
      }
      container.playerControl.updateCurrentPlaybackTiming(timing, "background-retry");
    }
  })();
}

export async function getPlaybackTimingMetadata(
  title: TitleInfo,
  episode: EpisodeInfo,
  cache: Map<string, PlaybackTimingMetadata | null>,
  signal?: AbortSignal,
  isAnime?: boolean,
  providerId?: string,
  diagnostics?: PhaseContext["container"]["diagnosticsService"],
) {
  const cacheKey = playbackTimingCacheKey(title, episode, providerId);

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
  const timing = await timingAggregator.resolve(title, episode, mode, signal, {
    providerId,
    onSourceOutcome: diagnostics
      ? (outcome) =>
          recordTimingSourceDiagnostic(diagnostics, {
            outcome,
            titleId: title.id,
            season: episode.season,
            episode: episode.episode,
            providerId,
          })
      : undefined,
  });
  cache.set(cacheKey, timing);
  return timing;
}
