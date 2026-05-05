import type { StreamInfo } from "@/domain/types";
import type { StreamCandidate } from "@kunai/types";

type SourceOption = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

type QualityOption = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

type StreamOption = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

export function buildStreamPickerOptions(stream: StreamInfo): readonly StreamOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  const sourcesById = new Map((result.sources ?? []).map((source) => [source.id, source]));

  const options = result.streams
    .filter((candidate) => typeof candidate.url === "string" && candidate.url.length > 0)
    .map((candidate) => {
      const source = candidate.sourceId ? sourcesById.get(candidate.sourceId) : undefined;
      const sourceLabel = source?.label ?? source?.host ?? candidate.sourceId ?? result.providerId;
      const qualityLabel = candidate.qualityLabel ?? candidate.container ?? candidate.id;
      const selected = candidate.id === result.selectedStreamId;
      return {
        value: candidate.id,
        label: selected
          ? `${sourceLabel}  ·  ${qualityLabel}  ·  current`
          : `${sourceLabel}  ·  ${qualityLabel}`,
        detail: describeStreamCandidateDetail(candidate),
        selected,
        rank: candidate.qualityRank ?? 0,
      };
    })
    .sort((left, right) => Number(right.selected) - Number(left.selected) || right.rank - left.rank);

  return options.map(({ selected: _selected, rank: _rank, ...option }) => option);
}

export function buildSourcePickerOptions(stream: StreamInfo): readonly SourceOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  if (result.sources && result.sources.length > 0) {
    return result.sources.map((source) => ({
      value: source.id,
      label:
        source.status === "selected"
          ? `${source.label ?? source.host ?? source.id}  ·  current`
          : (source.label ?? source.host ?? source.id),
      detail: describeSourceDetail(
        [source.kind, source.status, source.host],
        result.streams.filter((candidate) => candidate.sourceId === source.id),
      ),
    }));
  }

  const sourceIds = new Set<string>();
  const options: SourceOption[] = [];
  for (const candidate of result.streams) {
    const sourceId = candidate.sourceId;
    if (!sourceId || sourceIds.has(sourceId)) continue;
    sourceIds.add(sourceId);
    const selected = candidate.id === result.selectedStreamId;
    options.push({
      value: sourceId,
      label: selected ? `${sourceId}  ·  current` : sourceId,
      detail: describeSourceDetail(
        [candidate.protocol],
        result.streams.filter((streamCandidate) => streamCandidate.sourceId === sourceId),
      ),
    });
  }
  return options;
}

export function buildQualityPickerOptions(stream: StreamInfo): readonly QualityOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  const options = result.streams
    .filter((candidate) => typeof candidate.url === "string" && candidate.url.length > 0)
    .map((candidate) => ({
      value: candidate.id,
      label:
        candidate.id === result.selectedStreamId
          ? `${candidate.qualityLabel ?? candidate.container ?? candidate.id}  ·  current`
          : (candidate.qualityLabel ?? candidate.container ?? candidate.id),
      detail: describeStreamCandidateDetail(candidate),
      rank: candidate.qualityRank ?? 0,
    }))
    .sort((left, right) => right.rank - left.rank);

  return options.map(({ rank: _rank, ...option }) => option);
}

export function applyPreferredStreamSelection(
  stream: StreamInfo,
  preferences: {
    readonly preferredSourceId?: string | null;
    readonly preferredStreamId?: string | null;
  },
): StreamInfo {
  const result = stream.providerResolveResult;
  if (!result || result.streams.length === 0) return stream;

  let selected =
    (preferences.preferredStreamId
      ? result.streams.find((candidate) => candidate.id === preferences.preferredStreamId)
      : null) ?? null;

  if (!selected && preferences.preferredSourceId) {
    selected =
      [...result.streams]
        .filter((candidate) => candidate.sourceId === preferences.preferredSourceId)
        .sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0))[0] ?? null;
  }

  if (!selected?.url) return stream;
  if (selected.id === result.selectedStreamId && selected.url === stream.url) return stream;

  return {
    ...stream,
    url: selected.url,
    headers: selected.headers ?? {},
    providerResolveResult: {
      ...result,
      selectedStreamId: selected.id,
      selectedSourceId: selected.sourceId ?? result.selectedSourceId,
    },
  };
}

function describeSourceDetail(
  parts: readonly unknown[],
  streams: readonly StreamCandidate[],
): string {
  return [
    ...parts.filter((part): part is string => typeof part === "string" && part.length > 0),
    describeQualities(streams),
    describeLanguages(
      "audio",
      streams.map((candidate) => candidate.audioLanguage),
    ),
    describeLanguages(
      "hardsub",
      streams.map((candidate) => candidate.hardSubLanguage),
    ),
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function describeStreamCandidateDetail(candidate: StreamCandidate): string {
  return [
    candidate.protocol,
    candidate.container,
    candidate.audioLanguage ? `audio ${candidate.audioLanguage}` : null,
    candidate.hardSubLanguage ? `hardsub ${candidate.hardSubLanguage}` : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("  ·  ");
}

function describeQualities(streams: readonly StreamCandidate[]): string | null {
  const qualities = uniqueStrings(streams.map((candidate) => candidate.qualityLabel));
  if (qualities.length === 0) return null;
  return `quality ${qualities.slice(0, 3).join("/")}${qualities.length > 3 ? "+" : ""}`;
}

function describeLanguages(label: string, values: readonly (string | undefined)[]): string | null {
  const languages = uniqueStrings(values);
  if (languages.length === 0) return null;
  return `${label} ${languages.slice(0, 3).join("/")}${languages.length > 3 ? "+" : ""}`;
}

function uniqueStrings(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
