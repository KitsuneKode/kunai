import { formatLanguageBadge, formatSourceEvidence } from "@/app/track-format";
import { describeStreamCandidateMediaDetail } from "@/domain/media/media-track-model";
import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import { buildPlaybackSourceInventoryView } from "@/services/playback/PlaybackSourceInventoryProjection";
import type {
  PlaybackLanguageOptionView,
  PlaybackSourceGroupView,
} from "@/services/playback/PlaybackSourceInventoryView";
import type { StreamCandidate, SubtitleCandidate } from "@kunai/types";

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

export type PlaybackControlSummary = {
  readonly hasInventory: boolean;
  readonly sourceCount: number;
  readonly streamCount: number;
  readonly qualityCount: number;
  readonly audioLanguages: readonly string[];
  readonly hardSubLanguages: readonly string[];
  readonly softSubtitleLanguages: readonly string[];
  readonly showSourceControl: boolean;
  readonly showQualityControl: boolean;
  readonly showMediaTrackControl: boolean;
  readonly summary: string;
  readonly detail?: string;
};

export type MediaTrackPickerOption = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

export type MediaTrackPickerSelection =
  | { readonly kind: "stream"; readonly streamId: string }
  | { readonly kind: "audio"; readonly language: string; readonly streamId: string }
  | { readonly kind: "hardsub"; readonly language: string; readonly streamId: string }
  | { readonly kind: "subtitle"; readonly subtitleUrl: string }
  | { readonly kind: "subtitle-off" };

export type StreamSelectionIntent = {
  readonly sourceId: string | null;
  readonly streamId: string | null;
};

export function emptyStreamSelectionIntent(): StreamSelectionIntent {
  return { sourceId: null, streamId: null };
}

export function streamSelectionFromSource(sourceId: string): StreamSelectionIntent {
  return { sourceId, streamId: null };
}

export function streamSelectionFromStream(streamId: string): StreamSelectionIntent {
  return { sourceId: null, streamId };
}

export function isCurrentStreamSelection(
  stream: StreamInfo | null,
  selection: StreamSelectionIntent,
): boolean {
  const result = stream?.providerResolveResult;
  if (!result) return false;
  const selectedStream = result.streams.find(
    (candidate) => candidate.id === result.selectedStreamId,
  );
  if (selection.streamId) return selection.streamId === result.selectedStreamId;
  if (selection.sourceId) return selection.sourceId === selectedStream?.sourceId;
  return false;
}

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
        detail: describeStreamCandidateMediaDetail(candidate, result.subtitles),
        selected,
        rank: candidate.qualityRank ?? 0,
      };
    })
    .sort(
      (left, right) => Number(right.selected) - Number(left.selected) || right.rank - left.rank,
    );

  return options.map(({ selected: _selected, rank: _rank, ...option }) => option);
}

export function buildMediaTrackPickerOptions(
  stream: StreamInfo,
): readonly MediaTrackPickerOption[] {
  const streamOptions = buildStreamPickerOptions(stream).map((option) => ({
    value: `stream:${option.value}`,
    label: `Stream  ·  ${option.label}`,
    detail: option.detail,
  }));
  const languageOptions = buildLanguageTrackPickerOptions(stream);
  const subtitleOptions = buildSubtitleTrackPickerOptions(stream);
  const offOption =
    stream.subtitle && stream.subtitle.length > 0
      ? [
          {
            value: "subtitle:none",
            label: "Subtitles off",
            detail: "Disable the selected external subtitle track",
          },
        ]
      : [];

  return [...streamOptions, ...languageOptions, ...subtitleOptions, ...offOption];
}

export function decodeMediaTrackPickerSelection(value: string): MediaTrackPickerSelection | null {
  if (value.startsWith("stream:")) {
    const streamId = value.slice("stream:".length);
    return streamId ? { kind: "stream", streamId } : null;
  }
  const audio = decodeLanguageTrackSelection(value, "audio");
  if (audio) return audio;
  const hardsub = decodeLanguageTrackSelection(value, "hardsub");
  if (hardsub) return hardsub;
  if (value === "subtitle:none") return { kind: "subtitle-off" };
  if (value.startsWith("subtitle:")) {
    const encoded = value.slice("subtitle:".length);
    if (!encoded) return null;
    try {
      const subtitleUrl = decodeURIComponent(encoded);
      return subtitleUrl ? { kind: "subtitle", subtitleUrl } : null;
    } catch {
      return null;
    }
  }
  return null;
}

function decodeLanguageTrackSelection(
  value: string,
  kind: "audio" | "hardsub",
): Extract<MediaTrackPickerSelection, { kind: "audio" | "hardsub" }> | null {
  const prefix = `${kind}:`;
  if (!value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return null;
  try {
    const language = decodeURIComponent(rest.slice(0, separator));
    const streamId = decodeURIComponent(rest.slice(separator + 1));
    if (!language || !streamId) return null;
    return { kind, language, streamId };
  } catch {
    return null;
  }
}

export function buildSourcePickerOptions(stream: StreamInfo): readonly SourceOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  const projection = buildPlaybackSourceInventoryView(result);
  return projection.sourceGroups.map((group) => ({
    value: group.id,
    label: group.state === "selected" ? `${group.label}  ·  current` : group.label,
    detail: describeProjectedSourceDetail(group, result),
  }));
}

export function buildQualityPickerOptions(stream: StreamInfo): readonly QualityOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  const projection = buildPlaybackSourceInventoryView(result);
  return result.streams
    .filter((candidate) => typeof candidate.url === "string" && candidate.url.length > 0)
    .map((candidate) => {
      const option = projection.qualityOptions.find((qualityOption) =>
        qualityOption.streamIds.includes(candidate.id),
      );
      const label = candidate.qualityLabel ?? candidate.container ?? candidate.id;
      return {
        value: candidate.id,
        label: candidate.id === result.selectedStreamId ? `${label}  ·  current` : label,
        detail: describeStreamCandidateMediaDetail(candidate, result.subtitles),
        rank: option?.qualityRank ?? candidate.qualityRank ?? 0,
      };
    })
    .sort((left, right) => right.rank - left.rank)
    .map(({ rank: _rank, ...option }) => option);
}

export function buildPlaybackControlSummary(stream: StreamInfo | null): PlaybackControlSummary {
  const result = stream?.providerResolveResult;
  if (!stream || !result) {
    return {
      hasInventory: false,
      sourceCount: 0,
      streamCount: 0,
      qualityCount: 0,
      audioLanguages: [],
      hardSubLanguages: [],
      softSubtitleLanguages: [],
      showSourceControl: false,
      showQualityControl: false,
      showMediaTrackControl: false,
      summary: "direct stream",
    };
  }

  const projection = buildPlaybackSourceInventoryView(result, {
    selectedSubtitleUrl: stream.subtitle,
  });
  const playableStreams = result.streams.filter(
    (candidate) => typeof candidate.url === "string" && candidate.url.length > 0,
  );
  const qualityLabels = uniqueStrings(
    playableStreams.map((candidate) => candidate.qualityLabel ?? candidate.container),
  );
  const audioLanguages = uniqueStrings(
    playableStreams.flatMap((candidate) => candidate.audioLanguages ?? []),
  );
  const hardSubLanguages = uniqueStrings(
    playableStreams.map((candidate) => candidate.hardSubLanguage),
  );
  const softSubtitleLanguages = uniqueStrings(
    collectSubtitleTracks(stream).map((subtitle) => subtitle.language),
  );
  const sourceCount = projection.sourceGroups.length;
  const languageChoiceCount =
    audioLanguages.length + hardSubLanguages.length + softSubtitleLanguages.length;

  const detail = [
    sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : null,
    qualityLabels.length > 0 ? `quality ${formatList(qualityLabels)}` : null,
    audioLanguages.length > 0 ? `audio ${formatList(audioLanguages)}` : null,
    hardSubLanguages.length > 0 ? `hardsub ${formatList(hardSubLanguages)}` : null,
    softSubtitleLanguages.length > 0 ? `soft subs ${formatList(softSubtitleLanguages)}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("  ·  ");

  return {
    hasInventory: true,
    sourceCount,
    streamCount: playableStreams.length,
    qualityCount: qualityLabels.length,
    audioLanguages,
    hardSubLanguages,
    softSubtitleLanguages,
    showSourceControl: sourceCount > 1,
    showQualityControl: qualityLabels.length > 1 || playableStreams.length > 1,
    showMediaTrackControl:
      languageChoiceCount > 1 || softSubtitleLanguages.length > 0 || Boolean(stream.subtitle),
    summary: result.providerId,
    detail: detail || undefined,
  };
}

export type PlaybackSessionControlInput = {
  readonly stream: StreamInfo | null;
  readonly autoplayPaused: boolean;
  readonly autoskipPaused: boolean;
  readonly canToggleAutoplay: boolean;
  readonly stopAfterCurrent?: boolean;
  readonly isSeries?: boolean;
};

/** Stream inventory for the playback context strip (session toggles live on the keys line). */
export function formatPlaybackSessionFactsStrip(input: PlaybackSessionControlInput): string {
  const control = buildPlaybackControlSummary(input.stream);
  if (control.detail) return control.detail;
  return control.summary;
}

export type PlaybackSessionKeysInput = PlaybackSessionControlInput & {
  readonly hasNextEpisode: boolean;
  readonly hasPreviousEpisode: boolean;
};

function appendPlaybackSessionStatusChips(
  parts: string[],
  input: Pick<
    PlaybackSessionKeysInput,
    "autoplayPaused" | "autoskipPaused" | "canToggleAutoplay" | "stopAfterCurrent" | "isSeries"
  >,
): void {
  if (input.canToggleAutoplay) {
    parts.push(input.autoplayPaused ? "autoplay paused" : "autoplay on");
  }
  parts.push(input.autoskipPaused ? "autoskip paused" : "autoskip on");
  if (input.isSeries && input.stopAfterCurrent) {
    parts.push("stops after ep");
  }
}

/** Session state + live-key legend (one line; omit nav keys when unavailable). */
export function formatPlaybackSessionKeysHint(input: PlaybackSessionKeysInput): string {
  const control = buildPlaybackControlSummary(input.stream);
  const parts: string[] = [];

  appendPlaybackSessionStatusChips(parts, input);
  parts.push("q stop");

  if (input.isSeries) {
    if (input.hasNextEpisode) parts.push("n next");
    if (input.hasPreviousEpisode) parts.push("p prev");
    parts.push(input.stopAfterCurrent ? "x resume chain" : "x stop after");
  }

  if (input.canToggleAutoplay) {
    parts.push("a autoplay");
  }
  parts.push("u autoskip");

  if (control.showMediaTrackControl) {
    parts.push("k tracks");
  }
  if (control.showSourceControl) {
    parts.push("o source");
  }
  if (control.showQualityControl) {
    parts.push("v quality");
  }
  if (input.isSeries) {
    parts.push("e episodes");
  }

  parts.push("/ commands");
  return parts.join(" · ");
}

export function applyPreferredStreamSelection(
  stream: StreamInfo,
  selection: StreamSelectionIntent,
): StreamInfo {
  const result = stream.providerResolveResult;
  if (!result || result.streams.length === 0) return stream;

  let selected =
    (selection.streamId
      ? result.streams.find((candidate) => candidate.id === selection.streamId)
      : null) ?? null;

  if (!selected && selection.sourceId) {
    selected =
      [...result.streams]
        .filter((candidate) => candidate.sourceId === selection.sourceId)
        .sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0))[0] ?? null;
  }

  if (!selected?.url) return stream;
  if (selected.id === result.selectedStreamId && selected.url === stream.url) return stream;

  return {
    ...stream,
    url: selected.url,
    headers: selected.headers ?? {},
    audioLanguages: selected.audioLanguages ? [...selected.audioLanguages] : undefined,
    hardSubLanguage: selected.hardSubLanguage,
    providerResolveResult: {
      ...result,
      selectedStreamId: selected.id,
    },
  };
}

function describeSourceDetail(
  parts: readonly unknown[],
  streams: readonly StreamCandidate[],
  subtitles: readonly SubtitleCandidate[],
): string {
  return [
    ...parts.filter((part): part is string => typeof part === "string" && part.length > 0),
    describeQualities(streams),
    describeLanguages(
      "audio",
      streams.flatMap((candidate) => candidate.audioLanguages ?? []),
    ),
    describeLanguages(
      "hardsub",
      streams.map((candidate) => candidate.hardSubLanguage),
    ),
    describeLanguages(
      "soft subs",
      subtitles.map((subtitle) => subtitle.language),
    ),
  ]
    .filter(Boolean)
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

function buildSubtitleTrackPickerOptions(stream: StreamInfo): readonly MediaTrackPickerOption[] {
  const projection = stream.providerResolveResult
    ? buildPlaybackSourceInventoryView(stream.providerResolveResult, {
        selectedSubtitleUrl: stream.subtitle,
      })
    : null;
  const tracks = collectSubtitleTracks(stream);
  const seen = new Set<string>();
  const options: MediaTrackPickerOption[] = [];

  for (const track of tracks) {
    if (!track.url || seen.has(track.url)) continue;
    seen.add(track.url);
    const current = stream.subtitle === track.url;
    const subtitleBadge = track.language
      ? formatLanguageBadge({ language: track.language, role: "subtitle" })
      : "Subtitle";
    const source = track.sourceName ?? track.sourceKind ?? stream.subtitleSource;
    options.push({
      value: `subtitle:${encodeURIComponent(track.url)}`,
      label: current ? `${subtitleBadge}  ·  current` : subtitleBadge,
      detail:
        [track.display, track.release, formatSourceEvidence({ nativeLabel: source ?? undefined })]
          .filter(Boolean)
          .join("  ·  ") || undefined,
    });
  }

  for (const option of projection?.subtitleOptions ?? []) {
    if (option.delivery !== "external" || !option.subtitleUrl || seen.has(option.subtitleUrl)) {
      continue;
    }
    seen.add(option.subtitleUrl);
    const subtitleBadge = option.language
      ? formatLanguageBadge({ language: option.language, role: "subtitle" })
      : "Subtitle";
    options.push({
      value: `subtitle:${encodeURIComponent(option.subtitleUrl)}`,
      label: option.state === "selected" ? `${subtitleBadge}  ·  current` : subtitleBadge,
      detail:
        [option.label, formatSourceEvidence({ nativeLabel: option.nativeLabels.join(", ") })]
          .filter(Boolean)
          .join("  ·  ") || undefined,
    });
  }

  return options;
}

function buildLanguageTrackPickerOptions(stream: StreamInfo): readonly MediaTrackPickerOption[] {
  const result = stream.providerResolveResult;
  if (!result) return [];

  const projection = buildPlaybackSourceInventoryView(result);
  return projection.languageOptions
    .filter((option) => option.role === "audio" || option.role === "hardsub")
    .sort((left, right) => mediaTrackRoleRank(left.role) - mediaTrackRoleRank(right.role))
    .flatMap((option) => buildLanguageTrackOptionFromProjection(option, result));
}

function buildLanguageTrackOptionFromProjection(
  option: PlaybackLanguageOptionView,
  result: NonNullable<StreamInfo["providerResolveResult"]>,
): readonly MediaTrackPickerOption[] {
  const candidate = result.streams.find((streamCandidate) =>
    option.streamIds.includes(streamCandidate.id),
  );
  if (!candidate?.url || !option.language) return [];
  const sourceLabel = describeProjectedSourceLabel(candidate, result);
  const quality = candidate.qualityLabel ?? candidate.container ?? candidate.id;
  // Language badge comes only from the normalized ISO code via the typed seam;
  // the native source label stays as dim evidence in the detail line.
  const languageBadge = formatLanguageBadge({ language: option.language, role: option.role });
  return [
    {
      value: `${option.role}:${encodeURIComponent(option.language)}:${encodeURIComponent(
        candidate.id,
      )}`,
      label: option.state === "selected" ? `${languageBadge}  ·  current` : languageBadge,
      detail: [
        "Switches to cached stream inventory",
        formatSourceEvidence({ nativeLabel: sourceLabel }),
        quality,
      ]
        .filter(Boolean)
        .join("  ·  "),
    },
  ];
}

function describeProjectedSourceLabel(
  candidate: StreamCandidate,
  result: NonNullable<StreamInfo["providerResolveResult"]>,
): string {
  const projection = buildPlaybackSourceInventoryView(result);
  const group = projection.sourceGroups.find((sourceGroup) =>
    candidate.sourceId ? sourceGroup.sourceIds.includes(candidate.sourceId) : false,
  );
  if (group) return group.label;
  const sourcesById = new Map((result.sources ?? []).map((source) => [source.id, source]));
  const source = candidate.sourceId ? sourcesById.get(candidate.sourceId) : undefined;
  return source?.label ?? source?.host ?? candidate.sourceId ?? result.providerId;
}

function collectSubtitleTracks(stream: StreamInfo): readonly SubtitleTrack[] {
  const fromStream = stream.subtitleList ?? [];
  const fromProvider =
    stream.providerResolveResult?.subtitles.map((subtitle) => ({
      url: subtitle.url,
      language: subtitle.language,
      display: subtitle.label,
      sourceName: subtitle.providerId,
      sourceKind: "external" as const,
    })) ?? [];
  return [...fromStream, ...fromProvider];
}

function uniqueStrings(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function formatList(values: readonly string[]): string {
  return `${values.slice(0, 3).join("/")}${values.length > 3 ? "+" : ""}`;
}

function describeProjectedSourceDetail(
  group: PlaybackSourceGroupView,
  result: NonNullable<StreamInfo["providerResolveResult"]>,
): string {
  return describeSourceDetail(
    [group.providerStatus, group.nativeLabels.join("/")],
    result.streams.filter((candidate) =>
      candidate.sourceId ? group.sourceIds.includes(candidate.sourceId) : false,
    ),
    result.subtitles.filter((subtitle) =>
      subtitle.sourceId ? group.sourceIds.includes(subtitle.sourceId) : false,
    ),
  );
}

function mediaTrackRoleRank(role: PlaybackLanguageOptionView["role"]): number {
  return role === "audio" ? 0 : 1;
}
