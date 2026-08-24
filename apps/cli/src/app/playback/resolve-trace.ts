import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { ProviderFailure, ProviderId, ProviderTraceEvent, ResolveTrace } from "@kunai/types";

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

/**
 * A human-facing note for an audio downgrade, or null when the requested audio
 * was honoured.
 *
 * Providers emit an `audio:fallback` trace event when they resolve a different
 * audio presentation than the one requested (e.g. a dub was asked for but only a
 * sub server answered). Without surfacing it the user just gets the wrong
 * language with no explanation — the silent no-op the project treats as its
 * house failure mode.
 */
export function audioFallbackNoticeFromTrace(
  events: readonly ProviderTraceEvent[] | undefined,
): string | null {
  const event = events?.find((entry) => entry.type === "audio:fallback");
  if (!event) return null;
  const requested = presentationLabel(event.attributes?.requested);
  const resolved = presentationLabel(event.attributes?.resolved);
  if (!requested || !resolved) return null;
  return `${requested} unavailable — playing ${resolved}`;
}

function presentationLabel(value: unknown): string | null {
  if (value === "dub") return "Dub";
  if (value === "sub") return "Sub";
  return null;
}
