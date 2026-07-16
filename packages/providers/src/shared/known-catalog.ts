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
  const discoveredById = new Map(sources.map((source) => [source.id, source]));
  const ordered: ProviderSourceCandidate[] = [];
  const seen = new Set<string>();

  // Emit discovered real sources in discovery order first so the picker reflects
  // what the provider actually returned — with their real labels, hosts and
  // statuses — rather than collapsing everything onto static catalog rows.
  for (const source of discoveredById.values()) {
    ordered.push(source);
    seen.add(source.id);
  }

  // Then append known-but-undiscovered catalog entries as "skipped" placeholders
  // (Fresh resolve required) so the user can still manually try a known mirror
  // that the live response didn't surface.
  for (const entry of catalog) {
    if (mediaKind === "series" && entry.moviesOnly) continue;
    if (seen.has(entry.sourceId)) continue;
    const placeholder: ProviderSourceCandidate = {
      id: entry.sourceId,
      providerId,
      kind: entry.kind ?? "provider-api",
      label: entry.label,
      host: entry.host,
      status: "skipped" as const,
      confidence: entry.confidence ?? 0.4,
      cachePolicy,
      metadata: {
        flavorLabel: entry.label,
        flavorArchetype: entry.subtitle,
        phase: "known",
        pickerHint: "Fresh resolve required to try this source.",
        ...entry.metadata,
      },
      languageEvidence: entry.audioLanguage
        ? [
            {
              role: "audio" as const,
              normalizedLanguage: entry.audioLanguage,
              nativeLabel: entry.subtitle ?? entry.label,
              sourceId: entry.sourceId,
              confidence: 0.55,
            },
          ]
        : undefined,
    };
    ordered.push(placeholder);
    seen.add(entry.sourceId);
  }

  return ordered;
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
