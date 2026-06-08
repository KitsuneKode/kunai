import { getKnownCatalogForProvider, mergeKnownCatalogForResult } from "@kunai/providers";
import type {
  ProviderFailure,
  ProviderArtworkInfo,
  ProviderLanguageEvidence,
  ProviderResolveResult,
  ProviderSourceCandidate,
  ProviderSourceEvidence,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import type {
  PlaybackInventoryOptionState,
  PlaybackInventoryWarningView,
  PlaybackLanguageOptionView,
  PlaybackQualityOptionView,
  PlaybackRecoveryActionView,
  PlaybackSourceGroupView,
  PlaybackSourceInventoryView,
  PlaybackSourceSelectionView,
  PlaybackSubtitleOptionView,
  PlaybackTraceSummaryView,
} from "./PlaybackSourceInventoryView";

export type PlaybackSourceInventoryProjectionOptions = {
  readonly selectedStreamId?: string;
  readonly selectedSourceId?: string;
  readonly selectedSubtitleUrl?: string;
};

export type PlaybackSourceInventoryDiagnosticsSummary = {
  readonly providerId: string;
  readonly status: PlaybackSourceInventoryView["status"];
  readonly selected?: Pick<
    NonNullable<PlaybackSourceInventoryView["selected"]>,
    "sourceId" | "streamId" | "variantId" | "qualityLabel" | "presentation"
  > & {
    readonly audioLanguageCount: number;
    readonly subtitleLanguageCount: number;
    readonly hasArtwork: boolean;
    readonly hasSeekBarThumbnails: boolean;
  };
  readonly sourceGroups: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: string;
    readonly hints: readonly string[];
    readonly nativeLabelCount: number;
    readonly hasArtwork: boolean;
    readonly hasSeekBarThumbnails: boolean;
    readonly audioLanguageCount: number;
    readonly subtitleLanguageCount: number;
    readonly candidateCount: number;
  }[];
  readonly languageOptions: readonly {
    readonly id: string;
    readonly role: string;
    readonly state: string;
    readonly candidateCount: number;
  }[];
  readonly qualityOptions: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: string;
    readonly hints: readonly string[];
    readonly qualityRank?: number;
    readonly candidateCount: number;
  }[];
  readonly subtitleOptions: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: string;
    readonly delivery: string;
    readonly language?: string;
    readonly candidateCount: number;
  }[];
  readonly recoveryActions: readonly {
    readonly id: string;
    readonly disabled: boolean;
    readonly preservesTimestamp: boolean;
    readonly changesCacheIdentity: boolean;
  }[];
  readonly warnings: readonly {
    readonly id: string;
    readonly tone: string;
    readonly code?: string;
    readonly message: string;
  }[];
  readonly traceSummary?: PlaybackSourceInventoryView["traceSummary"];
};

export function projectPlaybackSourceInventory(
  result: ProviderResolveResult,
  options: PlaybackSourceInventoryProjectionOptions = {},
): PlaybackSourceInventoryView {
  const selectedStream = selectStream(result, options.selectedStreamId);
  const selectedSourceId =
    options.selectedSourceId ??
    selectedStream?.sourceId ??
    result.sources?.find((source) => source.status === "selected")?.id;

  return {
    providerId: result.providerId,
    status: result.status,
    artwork: result.artwork,
    selected: selectedStream ? projectSelectedStream(result, selectedStream) : undefined,
    sourceGroups: projectSourceGroups(result, selectedSourceId),
    languageOptions: projectLanguageOptions(result, selectedStream),
    qualityOptions: projectQualityOptions(result, selectedStream),
    subtitleOptions: projectSubtitleOptions(result, selectedStream, options.selectedSubtitleUrl),
    recoveryActions: projectRecoveryActions(result, selectedSourceId),
    warnings: projectWarnings(result),
    traceSummary: projectTraceSummary(result),
  };
}

export const buildPlaybackSourceInventoryView = projectPlaybackSourceInventory;

export function buildPlaybackSourceInventoryDiagnosticsSummary(
  result: ProviderResolveResult,
  options: PlaybackSourceInventoryProjectionOptions = {},
): PlaybackSourceInventoryDiagnosticsSummary {
  const view = projectPlaybackSourceInventory(result, options);
  return {
    providerId: view.providerId,
    status: view.status,
    selected: view.selected
      ? {
          sourceId: view.selected.sourceId,
          streamId: view.selected.streamId,
          variantId: view.selected.variantId,
          qualityLabel: view.selected.qualityLabel,
          presentation: view.selected.presentation,
          audioLanguageCount: view.selected.audioLanguages.length,
          subtitleLanguageCount: view.selected.subtitleLanguages.length,
          hasArtwork: Boolean(view.selected.artwork),
          hasSeekBarThumbnails: Boolean(view.selected.artwork?.seekBarVttUrl),
        }
      : undefined,
    sourceGroups: view.sourceGroups.map((group) => ({
      id: group.id,
      label: group.label,
      state: group.state,
      hints: group.hints,
      nativeLabelCount: group.nativeLabels.length,
      hasArtwork: Boolean(group.artwork),
      hasSeekBarThumbnails: Boolean(group.artwork?.seekBarVttUrl),
      audioLanguageCount: group.audioLanguages.length,
      subtitleLanguageCount: group.subtitleLanguages.length,
      candidateCount: group.candidateCount,
    })),
    languageOptions: view.languageOptions.map((option) => ({
      id: option.id,
      role: option.role,
      state: option.state,
      candidateCount: option.candidateCount,
    })),
    qualityOptions: view.qualityOptions.map((option) => ({
      id: option.id,
      label: option.label,
      state: option.state,
      hints: option.hints,
      qualityRank: option.qualityRank,
      candidateCount: option.candidateCount,
    })),
    subtitleOptions: view.subtitleOptions.map((option) => ({
      id: option.id,
      label: option.label,
      state: option.state,
      delivery: option.delivery,
      language: option.language,
      candidateCount: option.candidateCount,
    })),
    recoveryActions: view.recoveryActions.map((action) => ({
      id: action.id,
      disabled: Boolean(action.disabled),
      preservesTimestamp: action.preservesTimestamp,
      changesCacheIdentity: action.changesCacheIdentity,
    })),
    warnings: view.warnings.map((warning) => ({
      id: warning.id,
      tone: warning.tone,
      code: warning.code,
      message: warning.message,
    })),
    traceSummary: view.traceSummary,
  };
}

function selectStream(
  result: ProviderResolveResult,
  preferredStreamId?: string,
): StreamCandidate | undefined {
  return (
    result.streams.find((stream) => stream.id === preferredStreamId) ??
    result.streams.find((stream) => stream.id === result.selectedStreamId) ??
    result.streams[0]
  );
}

function projectSelectedStream(
  result: ProviderResolveResult,
  stream: StreamCandidate,
): PlaybackSourceSelectionView {
  return {
    providerId: result.providerId,
    sourceId: stream.sourceId,
    streamId: stream.id,
    variantId: stream.variantId,
    qualityLabel: stream.qualityLabel,
    artwork: mergeArtwork(stream.artwork, result.artwork),
    presentation: stream.presentation,
    audioLanguages: uniqueStrings([
      ...(stream.audioLanguages ?? []),
      ...languagesFromEvidence(stream.languageEvidence, "audio"),
    ]),
    subtitleLanguages: uniqueStrings([
      ...(stream.subtitleLanguages ?? []),
      stream.hardSubLanguage,
      ...languagesFromEvidence(stream.languageEvidence, "subtitle"),
      ...languagesFromEvidence(stream.languageEvidence, "hardsub"),
      ...subtitlesForStream(stream, result.subtitles).map((subtitle) => subtitle.language),
    ]),
    subtitleDelivery: stream.subtitleDelivery,
  };
}

function projectSourceGroups(
  result: ProviderResolveResult,
  selectedSourceId?: string,
): readonly PlaybackSourceGroupView[] {
  const sourceCandidates = buildSourceCandidates(result);
  return sourceCandidates.map((source) => {
    const sourceIds = [source.id];
    const streams = result.streams.filter((stream) => stream.sourceId === source.id);
    const subtitles = result.subtitles.filter((subtitle) => subtitle.sourceId === source.id);
    const nativeLabels = uniqueStrings([
      source.label,
      source.host,
      ...nativeSourceLabels(source.sourceEvidence),
      ...streams.flatMap((stream) => [
        stream.flavorLabel,
        stream.serverName,
        ...nativeSourceLabels(stream.sourceEvidence),
      ]),
    ]);
    const sourceArtwork = mergeArtwork(
      firstDefined(streams.map((stream) => stream.artwork)),
      source.artwork,
      result.artwork,
    );
    const state =
      source.id === selectedSourceId
        ? "selected"
        : mapSourceStateForStreams(source.status, streams);
    return {
      id: source.id,
      label: source.label ?? source.host ?? nativeLabels[0] ?? source.id,
      state,
      providerId: result.providerId,
      sourceIds,
      streamIds: streams.map((stream) => stream.id),
      nativeLabels,
      artwork: sourceArtwork,
      presentation: firstDefined(streams.map((stream) => stream.presentation)),
      audioLanguages: uniqueStrings([
        ...sourceLanguages(source.languageEvidence, "audio"),
        ...streams.flatMap((stream) => [
          ...(stream.audioLanguages ?? []),
          ...languagesFromEvidence(stream.languageEvidence, "audio"),
        ]),
      ]),
      subtitleLanguages: uniqueStrings([
        ...sourceLanguages(source.languageEvidence, "subtitle"),
        ...sourceLanguages(source.languageEvidence, "hardsub"),
        ...streams.flatMap((stream) => [
          ...(stream.subtitleLanguages ?? []),
          stream.hardSubLanguage,
          ...languagesFromEvidence(stream.languageEvidence, "subtitle"),
          ...languagesFromEvidence(stream.languageEvidence, "hardsub"),
        ]),
        ...subtitles.map((subtitle) => subtitle.language),
      ]),
      subtitleDelivery: firstDefined(streams.map((stream) => stream.subtitleDelivery)),
      candidateCount: streams.length,
      providerStatus: source.status,
      hints: uniqueStrings([
        typeof source.metadata?.flavorArchetype === "string"
          ? source.metadata.flavorArchetype
          : undefined,
        ...buildPlaybackInventoryEvidenceHints({
          state,
          providerStatus: source.status,
          host: source.host ?? firstDefined(source.sourceEvidence?.map((item) => item.host) ?? []),
          streams,
          subtitles,
          artwork: sourceArtwork,
        }),
      ]),
      disabledReason: describeSourceSelectionReason(source, streams),
    };
  });
}

function describeSourceSelectionReason(
  source: ProviderSourceCandidate,
  streams: readonly StreamCandidate[],
): string | undefined {
  if (streams.length > 0) return undefined;
  if (typeof source.metadata?.failureReason === "string") {
    return source.metadata.failureReason;
  }
  if (typeof source.metadata?.pickerHint === "string") {
    return "Fresh resolve required to try this source.";
  }
  return "No playable stream was exposed for this source.";
}

function buildSourceCandidates(result: ProviderResolveResult): readonly ProviderSourceCandidate[] {
  const catalog = getKnownCatalogForProvider(result.providerId, {
    mediaKind: result.trace.title.kind,
    audioMode: resolveAudioModeFromResult(result),
    rivestreamServices: rivestreamServicesFromResult(result),
  });
  if (catalog.length === 0) {
    return result.sources && result.sources.length > 0
      ? result.sources
      : buildFallbackSourceCandidatesFromStreams(result);
  }
  return mergeKnownCatalogForResult(result, catalog);
}

function resolveAudioModeFromResult(result: ProviderResolveResult): "sub" | "dub" | undefined {
  const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
  if (selected?.presentation === "dub") return "dub";
  if (selected?.presentation === "sub") return "sub";
  const modes = availableAudioModesFromTrace(result);
  return modes.length === 1 ? modes[0] : undefined;
}

export function availableAudioModesFromTrace(
  result: ProviderResolveResult,
): readonly ("sub" | "dub")[] {
  const event = result.trace.events?.find((entry) => entry.type === "inventory:audio-modes");
  const raw = event?.attributes?.modes;
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode): mode is "sub" | "dub" => mode === "sub" || mode === "dub");
}

function rivestreamServicesFromResult(result: ProviderResolveResult): readonly string[] {
  const fromSources = (result.sources ?? [])
    .map((source) => source.metadata?.provider)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (fromSources.length > 0) return [...new Set(fromSources)];
  const fromStreams = result.streams
    .flatMap((stream) => stream.sourceEvidence ?? [])
    .map((evidence) => evidence.serverId ?? evidence.nativeLabel)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set(fromStreams)];
}

function buildFallbackSourceCandidatesFromStreams(
  result: ProviderResolveResult,
): readonly ProviderSourceCandidate[] {
  const sourceIds = uniqueStrings(result.streams.map((stream) => stream.sourceId));
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

function mapSourceStateForStreams(
  status: ProviderSourceCandidate["status"],
  streams: readonly StreamCandidate[],
): PlaybackInventoryOptionState {
  if (streams.some((stream) => typeof stream.url === "string" && stream.url.length > 0)) {
    return "available";
  }
  return mapSourceState(status);
}

function projectLanguageOptions(
  result: ProviderResolveResult,
  selectedStream?: StreamCandidate,
): readonly PlaybackLanguageOptionView[] {
  const groups = new Map<string, MutableLanguageOption>();

  for (const stream of result.streams) {
    for (const language of stream.audioLanguages ?? []) {
      addLanguageOption(groups, stream, "audio", language);
    }
    for (const language of languagesFromEvidence(stream.languageEvidence, "audio")) {
      addLanguageOption(
        groups,
        stream,
        "audio",
        language,
        nativeLanguageLabels(stream.languageEvidence, "audio"),
      );
    }
    if (stream.hardSubLanguage) {
      addLanguageOption(groups, stream, "hardsub", stream.hardSubLanguage);
    }
    for (const language of stream.subtitleLanguages ?? []) {
      addLanguageOption(groups, stream, "subtitle", language);
    }
    for (const role of ["subtitle", "hardsub"] as const) {
      for (const language of languagesFromEvidence(stream.languageEvidence, role)) {
        addLanguageOption(
          groups,
          stream,
          role,
          language,
          nativeLanguageLabels(stream.languageEvidence, role),
        );
      }
    }
  }

  for (const subtitle of result.subtitles) {
    if (!subtitle.language) continue;
    const pseudoStream = result.streams.find((stream) => stream.sourceId === subtitle.sourceId);
    addLanguageOption(groups, pseudoStream, "subtitle", subtitle.language, [subtitle.label]);
  }

  return [...groups.values()]
    .map((option) => freezeLanguageOption(option, selectedStream))
    .sort(sortByStateThenLabel);
}

type MutableLanguageOption = {
  id: string;
  label: string;
  state: PlaybackInventoryOptionState;
  role: PlaybackLanguageOptionView["role"];
  language?: string;
  presentation?: PlaybackLanguageOptionView["presentation"];
  nativeLabels: Set<string>;
  sourceIds: Set<string>;
  streamIds: Set<string>;
  candidateCount: number;
  restartRequired: boolean;
  disabledReason?: string;
};

function addLanguageOption(
  groups: Map<string, MutableLanguageOption>,
  stream: StreamCandidate | undefined,
  role: PlaybackLanguageOptionView["role"],
  language: string,
  nativeLabels: readonly (string | undefined)[] = [],
): void {
  const id = `${role}:${language}`;
  const option = groups.get(id) ?? {
    id,
    label: `${roleLabel(role)} ${formatLanguageLabel(language)}`,
    state: "available",
    role,
    language,
    presentation: stream?.presentation,
    nativeLabels: new Set<string>(),
    sourceIds: new Set<string>(),
    streamIds: new Set<string>(),
    candidateCount: 0,
    restartRequired: true,
  };
  if (stream?.sourceId) option.sourceIds.add(stream.sourceId);
  if (stream?.id) option.streamIds.add(stream.id);
  for (const label of nativeLabels) {
    if (label) option.nativeLabels.add(label);
  }
  option.candidateCount += 1;
  groups.set(id, option);
}

function freezeLanguageOption(
  option: MutableLanguageOption,
  selectedStream?: StreamCandidate,
): PlaybackLanguageOptionView {
  const selected =
    selectedStream &&
    ((option.role === "audio" && selectedStream.audioLanguages?.includes(option.language ?? "")) ||
      (option.role === "hardsub" && selectedStream.hardSubLanguage === option.language) ||
      (option.role === "subtitle" &&
        selectedStream.subtitleLanguages?.includes(option.language ?? "")));
  return {
    ...option,
    state: selected ? "selected" : option.state,
    nativeLabels: [...option.nativeLabels],
    sourceIds: [...option.sourceIds],
    streamIds: [...option.streamIds],
    restartRequired: option.streamIds.size > 0 && !selected,
  };
}

function projectQualityOptions(
  result: ProviderResolveResult,
  selectedStream?: StreamCandidate,
): readonly PlaybackQualityOptionView[] {
  const groups = new Map<string, MutableQualityOption>();
  for (const stream of result.streams) {
    const label = stream.qualityLabel ?? stream.container ?? stream.protocol ?? stream.id;
    const id = `quality:${label}`;
    const option = groups.get(id) ?? {
      id,
      label,
      state: "available" as PlaybackInventoryOptionState,
      qualityRank: stream.qualityRank,
      sourceIds: new Set<string>(),
      streamIds: new Set<string>(),
      streams: [],
      candidateCount: 0,
      restartRequired: true,
    };
    if ((stream.qualityRank ?? 0) > (option.qualityRank ?? 0)) {
      option.qualityRank = stream.qualityRank;
    }
    if (stream.sourceId) option.sourceIds.add(stream.sourceId);
    option.streamIds.add(stream.id);
    option.streams.push(stream);
    option.candidateCount += 1;
    groups.set(id, option);
  }

  return [...groups.values()]
    .map((option) => {
      const { streams, ...publicOption } = option;
      const state =
        selectedStream && option.streamIds.has(selectedStream.id) ? "selected" : option.state;
      const sourceIds = [...option.sourceIds];
      const subtitles = uniqueSubtitles(
        streams.flatMap((stream) => subtitlesForStream(stream, result.subtitles)),
      );
      return {
        ...publicOption,
        state,
        sourceIds,
        streamIds: [...option.streamIds],
        restartRequired: selectedStream ? !option.streamIds.has(selectedStream.id) : true,
        hints: buildPlaybackInventoryEvidenceHints({
          state,
          streams,
          subtitles,
          artwork: mergeArtwork(
            firstDefined(streams.map((stream) => stream.artwork)),
            result.artwork,
          ),
        }),
      };
    })
    .sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0));
}

type MutableQualityOption = {
  id: string;
  label: string;
  state: PlaybackInventoryOptionState;
  qualityRank?: number;
  sourceIds: Set<string>;
  streamIds: Set<string>;
  streams: StreamCandidate[];
  candidateCount: number;
  restartRequired: boolean;
};

function projectSubtitleOptions(
  result: ProviderResolveResult,
  selectedStream: StreamCandidate | undefined,
  selectedSubtitleUrl?: string,
): readonly PlaybackSubtitleOptionView[] {
  const options: PlaybackSubtitleOptionView[] = [
    {
      id: "subtitle:off",
      label: "Subtitles off",
      state: selectedSubtitleUrl ? "available" : "selected",
      delivery: "off",
      nativeLabels: [],
      sourceIds: [],
      streamIds: selectedStream ? [selectedStream.id] : [],
      subtitleIds: [],
      candidateCount: 1,
      restartRequired: false,
    },
  ];

  const hardSubOptions = result.streams
    .filter((stream) => stream.hardSubLanguage)
    .map((stream) =>
      subtitleOptionFromStream(
        stream,
        "hardcoded",
        stream.hardSubLanguage,
        selectedStream?.id === stream.id,
      ),
    );

  const streamSubtitleOptions = result.streams
    .filter((stream) => stream.subtitleDelivery && stream.subtitleLanguages?.length)
    .flatMap((stream) =>
      (stream.subtitleLanguages ?? []).map((language) =>
        subtitleOptionFromStream(
          stream,
          stream.subtitleDelivery ?? "unknown",
          language,
          selectedStream?.id === stream.id && selectedSubtitleUrl === undefined,
        ),
      ),
    );

  const externalOptions: PlaybackSubtitleOptionView[] = result.subtitles.map((subtitle) => ({
    id: `subtitle:${subtitle.id}`,
    label: subtitle.label ?? `Subtitle ${formatLanguageLabel(subtitle.language)}`,
    state: subtitle.url === selectedSubtitleUrl ? "selected" : "available",
    delivery: "external" as const,
    subtitleUrl: subtitle.url,
    language: subtitle.language,
    nativeLabels: uniqueStrings([subtitle.label]),
    sourceIds: uniqueStrings([subtitle.sourceId]),
    streamIds: result.streams
      .filter(
        (stream) =>
          stream.sourceId === subtitle.sourceId || stream.variantId === subtitle.variantId,
      )
      .map((stream) => stream.id),
    subtitleIds: [subtitle.id],
    candidateCount: 1,
    restartRequired: false,
  }));

  return [...options, ...hardSubOptions, ...streamSubtitleOptions, ...externalOptions].sort(
    sortByStateThenLabel,
  );
}

function subtitleOptionFromStream(
  stream: StreamCandidate,
  delivery: PlaybackSubtitleOptionView["delivery"],
  language: string | undefined,
  selected: boolean,
): PlaybackSubtitleOptionView {
  return {
    id: `subtitle:${delivery}:${language ?? stream.id}:${stream.id}`,
    label: `${subtitleDeliveryLabel(delivery)} ${formatLanguageLabel(language)}`,
    state: selected ? "selected" : "available",
    delivery,
    language,
    nativeLabels: uniqueStrings([
      stream.flavorLabel,
      ...nativeLanguageLabels(
        stream.languageEvidence,
        delivery === "hardcoded" ? "hardsub" : "subtitle",
      ),
    ]),
    sourceIds: uniqueStrings([stream.sourceId]),
    streamIds: [stream.id],
    subtitleIds: [],
    candidateCount: 1,
    restartRequired: !selected,
  };
}

function projectRecoveryActions(
  result: ProviderResolveResult,
  selectedSourceId?: string,
): readonly PlaybackRecoveryActionView[] {
  const sourceCount = buildSourceCandidates(result).length;
  const selectedSourceIndex = selectedSourceId
    ? buildSourceCandidates(result).findIndex((source) => source.id === selectedSourceId)
    : -1;
  const hasNextSource = selectedSourceIndex >= 0 && selectedSourceIndex < sourceCount - 1;

  return [
    {
      id: "retry-current",
      label: "Retry current stream",
      disabled: result.streams.length === 0,
      disabledReason:
        result.streams.length === 0 ? "No current stream is available to retry." : undefined,
      preservesTimestamp: true,
      changesCacheIdentity: false,
    },
    {
      id: "next-source",
      label: "Try next source",
      disabled: sourceCount <= 1 || !hasNextSource,
      disabledReason:
        sourceCount <= 1
          ? "Only one source was exposed by this provider."
          : !hasNextSource
            ? "Already on the last exposed source."
            : undefined,
      preservesTimestamp: true,
      changesCacheIdentity: true,
    },
    {
      id: "fallback-provider",
      label: "Try fallback provider",
      disabled: false,
      preservesTimestamp: true,
      changesCacheIdentity: true,
    },
    {
      id: "refresh-stream",
      label: "Refresh stream inventory",
      disabled: false,
      preservesTimestamp: true,
      changesCacheIdentity: false,
    },
    {
      id: "cancel",
      label: "Cancel",
      disabled: false,
      preservesTimestamp: false,
      changesCacheIdentity: false,
    },
  ];
}

function projectWarnings(result: ProviderResolveResult): readonly PlaybackInventoryWarningView[] {
  const warnings: PlaybackInventoryWarningView[] = [];
  if (result.status === "exhausted") {
    warnings.push({
      id: "resolve-exhausted",
      tone: "danger",
      message: "The provider exhausted its available sources.",
      code: result.failures[0]?.code,
      developerDetail: firstFailureDetail(result.failures),
    });
  }
  if (result.streams.length === 0) {
    warnings.push({
      id: "no-playable-streams",
      tone: "danger",
      message: "No playable stream was exposed.",
      code: result.failures[0]?.code,
      developerDetail: firstFailureDetail(result.failures),
    });
  }
  if (result.failures.length > 0 && result.streams.length > 0) {
    warnings.push({
      id: "partial-provider-failures",
      tone: "warning",
      message: "Some provider sources failed, but playable options remain.",
      code: result.failures[0]?.code,
      developerDetail: firstFailureDetail(result.failures),
    });
  }
  return warnings;
}

function projectTraceSummary(result: ProviderResolveResult): PlaybackTraceSummaryView {
  return {
    providerId: result.providerId,
    selectedStreamId: result.selectedStreamId,
    sourceCount: buildSourceCandidates(result).length,
    streamCount: result.streams.length,
    subtitleCount: result.subtitles.length,
    failureCount: result.failures.length,
    eventCount: result.trace.events?.length ?? 0,
    cacheHit: result.trace.cacheHit,
  };
}

export function buildPlaybackInventoryEvidenceHints({
  state,
  providerStatus,
  host,
  streams,
  subtitles,
  artwork,
}: {
  readonly state: PlaybackInventoryOptionState;
  readonly providerStatus?: ProviderSourceCandidate["status"];
  readonly host?: string;
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly artwork?: ProviderArtworkInfo;
}): readonly string[] {
  return uniqueStrings([
    stateHint(state, providerStatus),
    host && !isGenericProviderApiHost(host) ? `host ${host}` : streamHostHint(streams),
    streams.some((stream) => hasProviderTimingHint(stream.metadata)) ? "has timing" : undefined,
    artwork?.seekBarVttUrl ? "seek thumbnails" : undefined,
    subtitles.length > 0
      ? `${subtitles.length} subtitle${subtitles.length === 1 ? "" : "s"}`
      : undefined,
  ]);
}

function hasProviderTimingHint(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return (
    Boolean(metadata.intro) ||
    Boolean(metadata.outro) ||
    Boolean(metadata.introStart) ||
    Boolean(metadata.introEnd) ||
    Boolean(metadata.outroStart) ||
    Boolean(metadata.outroEnd)
  );
}

function stateHint(
  state: PlaybackInventoryOptionState,
  providerStatus?: ProviderSourceCandidate["status"],
): string | undefined {
  if (state === "selected") return "selected";
  if (providerStatus === "failed" || state === "failed") return "failed";
  if (providerStatus === "exhausted") return "exhausted";
  if (providerStatus === "skipped" || state === "skipped") return "not tried";
  if (state === "disabled") return "disabled";
  return undefined;
}

function isGenericProviderApiHost(host: string): boolean {
  return host === "api.videasy.to" || host === "api.vidking.net";
}

function streamHostHint(streams: readonly StreamCandidate[]): string | undefined {
  const host = firstDefined(streams.map((stream) => hostFromUrl(stream.url)));
  return host ? `host ${host}` : undefined;
}

function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function mapSourceState(status: ProviderSourceCandidate["status"]): PlaybackInventoryOptionState {
  if (status === "selected") return "selected";
  if (status === "failed" || status === "exhausted") return "failed";
  if (status === "skipped") return "skipped";
  return "available";
}

function subtitlesForStream(
  stream: StreamCandidate,
  subtitles: readonly SubtitleCandidate[],
): readonly SubtitleCandidate[] {
  if (stream.variantId) {
    const variantSubtitles = subtitles.filter(
      (subtitle) => subtitle.variantId === stream.variantId,
    );
    if (variantSubtitles.length > 0) return variantSubtitles;
  }
  if (!stream.sourceId) return [];
  return subtitles.filter((subtitle) => subtitle.sourceId === stream.sourceId);
}

function uniqueSubtitles(subtitles: readonly SubtitleCandidate[]): readonly SubtitleCandidate[] {
  const seen = new Set<string>();
  const unique: SubtitleCandidate[] = [];
  for (const subtitle of subtitles) {
    const key = subtitle.id || subtitle.url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(subtitle);
  }
  return unique;
}

function sourceLanguages(
  evidence: readonly ProviderLanguageEvidence[] | undefined,
  role: ProviderLanguageEvidence["role"],
): readonly string[] {
  return languagesFromEvidence(evidence, role);
}

function languagesFromEvidence(
  evidence: readonly ProviderLanguageEvidence[] | undefined,
  role: ProviderLanguageEvidence["role"],
): readonly string[] {
  return uniqueStrings(
    evidence?.filter((item) => item.role === role).map((item) => item.normalizedLanguage) ?? [],
  );
}

function nativeLanguageLabels(
  evidence: readonly ProviderLanguageEvidence[] | undefined,
  role: ProviderLanguageEvidence["role"],
): readonly string[] {
  return uniqueStrings(
    evidence?.filter((item) => item.role === role).map((item) => item.nativeLabel) ?? [],
  );
}

function nativeSourceLabels(
  evidence: readonly ProviderSourceEvidence[] | undefined,
): readonly string[] {
  return uniqueStrings(evidence?.map((item) => item.nativeLabel ?? item.host) ?? []);
}

function firstFailureDetail(failures: readonly ProviderFailure[]): string | undefined {
  const failure = failures[0];
  if (!failure) return undefined;
  return `${failure.code}: ${failure.message}`;
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function mergeArtwork(
  ...artworks: readonly (ProviderArtworkInfo | undefined)[]
): ProviderArtworkInfo | undefined {
  const merged: {
    posterUrl?: string;
    backdropUrl?: string;
    thumbnailUrl?: string;
    seekBarVttUrl?: string;
  } = {};
  for (const artwork of artworks) {
    if (!artwork) continue;
    if (!merged.posterUrl && artwork.posterUrl) merged.posterUrl = artwork.posterUrl;
    if (!merged.backdropUrl && artwork.backdropUrl) merged.backdropUrl = artwork.backdropUrl;
    if (!merged.thumbnailUrl && artwork.thumbnailUrl) merged.thumbnailUrl = artwork.thumbnailUrl;
    if (!merged.seekBarVttUrl && artwork.seekBarVttUrl) {
      merged.seekBarVttUrl = artwork.seekBarVttUrl;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function uniqueStrings(values: readonly (string | undefined | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function roleLabel(role: PlaybackLanguageOptionView["role"]): string {
  if (role === "audio") return "Audio";
  if (role === "hardsub") return "Hardsub";
  return "Subtitle";
}

function subtitleDeliveryLabel(delivery: PlaybackSubtitleOptionView["delivery"]): string {
  if (delivery === "hardcoded") return "Hardsub";
  if (delivery === "embedded") return "Embedded subtitle";
  if (delivery === "external") return "External subtitle";
  if (delivery === "off") return "Subtitles off";
  return "Subtitle";
}

function formatLanguageLabel(language: string | undefined): string {
  if (!language) return "unknown";
  const displayName = new Intl.DisplayNames(["en"], { type: "language" }).of(language);
  return displayName ?? language.toUpperCase();
}

function sortByStateThenLabel<T extends { state: PlaybackInventoryOptionState; label: string }>(
  left: T,
  right: T,
): number {
  return stateRank(left.state) - stateRank(right.state) || left.label.localeCompare(right.label);
}

function stateRank(state: PlaybackInventoryOptionState): number {
  if (state === "selected") return 0;
  if (state === "available") return 1;
  if (state === "skipped") return 2;
  if (state === "failed") return 3;
  return 4;
}
