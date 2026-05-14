import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import type { StreamCandidate, SubtitleCandidate } from "@kunai/types";

export type ProviderMediaInventory = {
  readonly sourceCount: number;
  readonly streamCount: number;
  readonly audioLanguages: readonly string[];
  readonly hardSubLanguages: readonly string[];
  readonly softSubtitleLanguages: readonly string[];
};

export type SelectedMediaTrackState = {
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly qualityLabel?: string;
  readonly audioLanguages: readonly string[];
  readonly hardSubLanguage?: string;
  readonly subtitleLanguage?: string;
  readonly subtitleUrl?: string;
};

export type ActiveMediaTrackState = {
  readonly audioLanguage?: string;
  readonly subtitleLanguage?: string;
  readonly subtitleUrl?: string;
  readonly sourceId?: string;
  readonly streamId?: string;
};

export type MediaSwitchingCapability = {
  readonly source: boolean;
  readonly quality: boolean;
  readonly subtitle: boolean;
  readonly audio: boolean;
};

export type MediaTrackModel = {
  readonly provider: ProviderMediaInventory;
  readonly selected: SelectedMediaTrackState;
  readonly active?: ActiveMediaTrackState;
  readonly switching: MediaSwitchingCapability;
};

export function buildMediaTrackModel(
  stream: StreamInfo,
  active?: ActiveMediaTrackState,
): MediaTrackModel {
  const result = stream.providerResolveResult;
  const selected = result
    ? result.streams.find((candidate) => candidate.id === result.selectedStreamId)
    : undefined;
  const softSubtitles = result?.subtitles ?? stream.subtitleList ?? [];
  const inventory = {
    sourceCount:
      result?.sources?.length ?? uniqueStrings(result?.streams.map((s) => s.sourceId)).length,
    streamCount: result?.streams.length ?? 1,
    audioLanguages: uniqueStrings(
      result?.streams.flatMap((candidate) => candidate.audioLanguages ?? []),
    ),
    hardSubLanguages: uniqueStrings(result?.streams.map((candidate) => candidate.hardSubLanguage)),
    softSubtitleLanguages: uniqueStrings(softSubtitles.map((subtitle) => subtitle.language)),
  };
  return {
    provider: inventory,
    selected: {
      sourceId: selected?.sourceId,
      streamId: selected?.id ?? result?.selectedStreamId,
      qualityLabel: selected?.qualityLabel,
      audioLanguages: selected?.audioLanguages ?? stream.audioLanguages ?? [],
      hardSubLanguage: selected?.hardSubLanguage ?? stream.hardSubLanguage,
      subtitleLanguage: selectedSubtitleLanguage(stream, softSubtitles),
      subtitleUrl: stream.subtitle,
    },
    active,
    switching: {
      source: inventory.sourceCount > 1,
      quality: inventory.streamCount > 1,
      subtitle: inventory.softSubtitleLanguages.length > 1,
      audio: inventory.audioLanguages.length > 1,
    },
  };
}

export function describeStreamCandidateMediaDetail(
  candidate: StreamCandidate,
  subtitles: readonly SubtitleCandidate[],
): string {
  return [
    candidate.protocol,
    candidate.container,
    candidate.audioLanguages?.length ? `audio ${candidate.audioLanguages.join(",")}` : null,
    candidate.hardSubLanguage ? `hardsub ${candidate.hardSubLanguage}` : null,
    describeLanguages(
      "soft subs",
      subtitlesForStreamCandidate(candidate, subtitles).map((subtitle) => subtitle.language),
    ),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("  ·  ");
}

export function subtitlesForStreamCandidate(
  candidate: StreamCandidate,
  subtitles: readonly SubtitleCandidate[],
): readonly SubtitleCandidate[] {
  if (candidate.variantId) {
    const variantSubtitles = subtitles.filter(
      (subtitle) => subtitle.variantId === candidate.variantId,
    );
    if (variantSubtitles.length > 0) return variantSubtitles;
  }

  if (!candidate.sourceId) return [];
  return subtitles.filter(
    (subtitle) => !subtitle.variantId && subtitle.sourceId === candidate.sourceId,
  );
}

function selectedSubtitleLanguage(
  stream: StreamInfo,
  subtitles: readonly (SubtitleCandidate | SubtitleTrack)[],
): string | undefined {
  if (!stream.subtitle) return undefined;
  return subtitles.find((subtitle) => subtitle.url === stream.subtitle)?.language;
}

function describeLanguages(label: string, values: readonly (string | undefined)[]): string | null {
  const languages = uniqueStrings(values);
  if (languages.length === 0) return null;
  return `${label} ${languages.slice(0, 3).join("/")}${languages.length > 3 ? "+" : ""}`;
}

function uniqueStrings(values: readonly (string | undefined)[] | undefined): readonly string[] {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))];
}
