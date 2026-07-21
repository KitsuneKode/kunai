import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

import { mergeTimingMetadata } from "./merge-timing";
import {
  classifyTimingThrownError,
  type PlaybackTimingAggregatorOptions,
  type PlaybackTimingFetchContext,
  type PlaybackTimingSource,
  type PlaybackTimingSourceFetchResult,
  type PlaybackTimingSourceOutcome,
  type TimingContentMode,
} from "./PlaybackTimingSource";

const DEFAULT_SOURCE_DEADLINE_MS = 4_000;
const DEFAULT_AGGREGATE_DEADLINE_MS = 5_000;

export class PlaybackTimingAggregator {
  private readonly sourceDeadlineMs: number;
  private readonly aggregateDeadlineMs: number;
  private readonly now: () => number;

  constructor(
    private readonly sources: readonly PlaybackTimingSource[],
    options: PlaybackTimingAggregatorOptions = {},
  ) {
    this.sourceDeadlineMs = options.sourceDeadlineMs ?? DEFAULT_SOURCE_DEADLINE_MS;
    this.aggregateDeadlineMs = options.aggregateDeadlineMs ?? DEFAULT_AGGREGATE_DEADLINE_MS;
    this.now = options.now ?? Date.now;
  }

  async resolve(
    title: TitleInfo,
    episode: EpisodeInfo,
    mode: TimingContentMode,
    signal?: AbortSignal,
    context?: PlaybackTimingFetchContext,
  ): Promise<PlaybackTimingMetadata | null> {
    const applicable = this.sources.filter((s) => s.canHandle(title, mode));
    if (applicable.length === 0) return null;

    const sourceDeadlineMs = context?.sourceDeadlineMs ?? this.sourceDeadlineMs;
    const aggregateDeadlineMs = context?.aggregateDeadlineMs ?? this.aggregateDeadlineMs;
    const aggregateSignal = withTimeoutSignal(signal, aggregateDeadlineMs);

    const resolveContext: PlaybackTimingFetchContext = {
      ...context,
      parentSignal: signal,
    };

    const settled = await Promise.allSettled(
      applicable.map((source) =>
        this.runSource(
          source,
          title,
          episode,
          aggregateSignal,
          signal,
          sourceDeadlineMs,
          resolveContext,
        ),
      ),
    );

    let merged: PlaybackTimingMetadata | null = null;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      merged = mergeTimingMetadata(merged, result.value.metadata);
    }
    return merged;
  }

  private async runSource(
    source: PlaybackTimingSource,
    title: TitleInfo,
    episode: EpisodeInfo,
    aggregateSignal: AbortSignal,
    parentSignal: AbortSignal | undefined,
    sourceDeadlineMs: number,
    context: PlaybackTimingFetchContext | undefined,
  ): Promise<PlaybackTimingSourceFetchResult> {
    const startedAt = this.now();
    const sourceSignal = withTimeoutSignal(aggregateSignal, sourceDeadlineMs);

    try {
      const result = source.fetchDetailed
        ? await source.fetchDetailed({
            title,
            episode,
            signal: sourceSignal,
            context,
          })
        : {
            metadata: await source.fetch({
              title,
              episode,
              signal: sourceSignal,
              context,
            }),
            failureClass: null as PlaybackTimingSourceFetchResult["failureClass"],
          };

      // Compatibility fetch() returns null for every failure — reclassify aborts here.
      let failureClass = result.failureClass;
      let metadata = result.metadata;
      if (!metadata && failureClass === null && sourceSignal.aborted) {
        failureClass = classifyTimingThrownError(
          new DOMException("The operation was aborted.", "AbortError"),
          { parentSignal },
        );
      } else if (metadata) {
        failureClass = null;
      } else if (failureClass === null) {
        failureClass = "not-found";
      }

      this.emitOutcome(context, {
        source: source.name,
        failureClass,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return { metadata, failureClass };
    } catch (error) {
      const failureClass = classifyTimingThrownError(error, { parentSignal });
      this.emitOutcome(context, {
        source: source.name,
        failureClass,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return { metadata: null, failureClass };
    }
  }

  private emitOutcome(
    context: PlaybackTimingFetchContext | undefined,
    outcome: PlaybackTimingSourceOutcome,
  ): void {
    context?.onSourceOutcome?.(outcome);
  }
}
