import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { ProviderFailure, ProviderId, ResolveTrace } from "@kunai/types";

export function createResolveTraceStub({
  title,
  episode,
  providerId,
  mode,
  startedAt = new Date(),
}: {
  title: TitleInfo;
  episode?: EpisodeInfo;
  providerId: string;
  mode: ShellMode;
  startedAt?: Date;
}): ResolveTrace {
  const sharedTitleKind = mode === "anime" ? "anime" : title.type;
  const startedAtIso = startedAt.toISOString();

  return {
    id: `resolve-${startedAt.getTime()}-${providerId}-${title.id}`,
    startedAt: startedAtIso,
    title: {
      id: title.id,
      kind: sharedTitleKind,
      title: title.name,
      year: title.year ? Number.parseInt(title.year, 10) || undefined : undefined,
      tmdbId: sharedTitleKind === "anime" ? undefined : title.id,
      anilistId: sharedTitleKind === "anime" ? title.id : undefined,
    },
    episode: episode
      ? {
          season: episode.season,
          episode: episode.episode,
          title: episode.name,
          airDate: episode.airDate,
        }
      : undefined,
    selectedProviderId: providerId as ProviderId,
    cacheHit: false,
    steps: [
      {
        at: startedAtIso,
        stage: "provider",
        message: "Provider resolution started",
        providerId: providerId as ProviderId,
      },
    ],
    failures: [],
  };
}

/**
 * Stamp the outcome onto a trace started by `createResolveTraceStub`.
 *
 * Returns a new object; the input is never mutated, so a caller holding the
 * started trace for its id keeps a stable value.
 */
export function finalizeResolveTrace(
  trace: ResolveTrace,
  outcome: {
    readonly endedAt: string;
    readonly selectedProviderId?: string;
    readonly selectedStreamId?: string;
    readonly cacheHit: boolean;
    readonly failures: readonly ProviderFailure[];
  },
): ResolveTrace {
  return {
    ...trace,
    endedAt: outcome.endedAt,
    selectedProviderId: (outcome.selectedProviderId ?? trace.selectedProviderId) as
      | ProviderId
      | undefined,
    selectedStreamId: outcome.selectedStreamId ?? trace.selectedStreamId,
    cacheHit: outcome.cacheHit,
    failures: outcome.failures,
  };
}
