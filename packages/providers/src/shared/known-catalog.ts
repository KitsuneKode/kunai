import type {
  CachePolicy,
  ProviderId,
  ProviderSourceCandidate,
  ProviderResolveResult,
} from "@kunai/types";

export type KnownCatalogEntry = {
  readonly sourceId: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly audioLanguage?: string;
  readonly host?: string;
  readonly kind?: ProviderSourceCandidate["kind"];
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
  readonly moviesOnly?: boolean;
};

export type MergeKnownCatalogSourcesInput = {
  readonly providerId: ProviderId | string;
  readonly mediaKind?: string;
  readonly sources: readonly ProviderSourceCandidate[];
  readonly catalog: readonly KnownCatalogEntry[];
  readonly cachePolicy?: CachePolicy;
  readonly selectedSourceId?: string;
};

export function mergeKnownCatalogSources({
  providerId,
  mediaKind,
  sources,
  catalog,
  cachePolicy,
}: MergeKnownCatalogSourcesInput): readonly ProviderSourceCandidate[] {
  const byId = new Map(sources.map((source) => [source.id, source]));

  for (const entry of catalog) {
    if (mediaKind === "series" && entry.moviesOnly) continue;
    if (byId.has(entry.sourceId)) continue;
    byId.set(entry.sourceId, {
      id: entry.sourceId,
      providerId,
      kind: entry.kind ?? "provider-api",
      label: entry.label,
      host: entry.host,
      status: "available",
      confidence: entry.confidence ?? 0.4,
      cachePolicy,
      languageEvidence: entry.audioLanguage
        ? [
            {
              role: "audio",
              normalizedLanguage: entry.audioLanguage,
              nativeLabel: entry.subtitle ?? entry.label,
              sourceId: entry.sourceId,
              confidence: 0.55,
            },
          ]
        : undefined,
      metadata: {
        flavorLabel: entry.label,
        flavorArchetype: entry.subtitle,
        phase: "known",
        pickerHint: "fresh resolve required",
        ...entry.metadata,
      },
    });
  }

  return [...byId.values()];
}

export function mergeKnownCatalogForResult(
  result: ProviderResolveResult,
  catalog: readonly KnownCatalogEntry[],
): readonly ProviderSourceCandidate[] {
  const sourceCandidates =
    result.sources && result.sources.length > 0
      ? result.sources
      : buildFallbackSourceCandidatesFromStreams(result);

  return mergeKnownCatalogSources({
    providerId: result.providerId,
    mediaKind: result.trace.title.kind,
    sources: sourceCandidates,
    catalog,
    cachePolicy: result.cachePolicy,
    selectedSourceId: result.streams.find((stream) => stream.id === result.selectedStreamId)
      ?.sourceId,
  });
}

function buildFallbackSourceCandidatesFromStreams(
  result: ProviderResolveResult,
): readonly ProviderSourceCandidate[] {
  const sourceIds = [
    ...new Set(
      result.streams
        .map((stream) => stream.sourceId)
        .filter(
          (sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0,
        ),
    ),
  ];
  return sourceIds.map((sourceId) => {
    const streams = result.streams.filter((stream) => stream.sourceId === sourceId);
    const primary = streams[0];
    const displayLabel = primary?.flavorLabel ?? primary?.serverName ?? sourceId;
    const subtitle = primary?.flavorArchetype;
    return {
      id: sourceId,
      providerId: result.providerId,
      kind: "unknown",
      label: displayLabel,
      status: streams.some((stream) => stream.id === result.selectedStreamId)
        ? "selected"
        : "available",
      confidence: Math.max(...streams.map((stream) => stream.confidence), 0),
      metadata: subtitle
        ? { flavorArchetype: subtitle, flavorLabel: displayLabel }
        : { flavorLabel: displayLabel },
    };
  });
}
