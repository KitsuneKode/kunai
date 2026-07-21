import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import { selectAutomaticSubtitle } from "@/subtitle";
import {
  looksLikeHiSubtitle,
  normalizeIsoLanguageCode,
  subtitleLanguageDisplayName,
} from "@kunai/providers";
import type { ProviderResolveResult, SubtitleCandidate } from "@kunai/types";

import {
  resolveYtdlFormatFromCandidate,
  resolveYoutubeYtdlRawOptions,
} from "./youtube-playback-options";

export interface ProviderResultAdapterInput {
  readonly result: ProviderResolveResult;
  readonly title: string;
  readonly subtitlePreference: string;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly blockedStreamUrls?: readonly string[];
}

export function providerResolveResultToStreamInfo(
  input: ProviderResultAdapterInput,
): StreamInfo | null {
  const { result, title, subtitlePreference } = input;

  if (!result.streams.length) {
    return null;
  }

  const selected = selectPreferredStream(result, {
    selectedSourceId: input.selectedSourceId,
    selectedStreamId: input.selectedStreamId,
    blockedStreamUrls: input.blockedStreamUrls,
  });
  if (!selected) {
    return null;
  }
  const playableUrl = selected.url ?? selected.deferredLocator;
  if (!playableUrl) {
    return null;
  }
  const effectiveResult =
    selected.id === result.selectedStreamId ? result : { ...result, selectedStreamId: selected.id };

  const subtitleList = result.subtitles.map(subtitleCandidateToTrack);
  const pickedSubtitle =
    subtitlePreference === "none"
      ? null
      : selectAutomaticSubtitle(subtitleList as never, subtitlePreference);

  const subtitleSource = resolveSubtitleSource(result.subtitles, subtitleList);

  return {
    url: playableUrl,
    deferredLocator: selected.deferredLocator,
    headers: selected.headers ?? {},
    audioLanguages: selected.audioLanguages ? [...selected.audioLanguages] : undefined,
    hardSubLanguage: selected.hardSubLanguage,
    requiresYtdl: selected.requiresYtdl,
    ytdlFormat: selected.requiresYtdl ? resolveYtdlFormatFromCandidate(selected) : undefined,
    ytdlRawOptions: selected.requiresYtdl
      ? resolveYoutubeYtdlRawOptions(selected, subtitlePreference)
      : undefined,
    subtitle: pickedSubtitle?.url,
    subtitleList,
    subtitleSource,
    subtitleEvidence: {
      directSubtitleObserved: subtitleList.length > 0,
      wyzieSearchObserved: false,
      reason: subtitleList.length > 0 ? "provider-default" : "not-observed",
    },
    title,
    timestamp: Date.now(),
    providerResolveResult: effectiveResult,
  };
}

function selectPreferredStream(
  result: ProviderResolveResult,
  selection: {
    readonly selectedSourceId?: string;
    readonly selectedStreamId?: string;
    readonly blockedStreamUrls?: readonly string[];
  },
) {
  const blockedUrls = new Set(selection.blockedStreamUrls ?? []);
  const streams = result.streams.filter((stream) => {
    const playableUrl = stream.url ?? stream.deferredLocator;
    return !playableUrl || !blockedUrls.has(playableUrl);
  });

  const exact = selection.selectedStreamId
    ? streams.find((stream) => stream.id === selection.selectedStreamId)
    : undefined;
  if (exact) return exact;

  const fromSource = selection.selectedSourceId
    ? [...streams]
        .filter((stream) => stream.sourceId === selection.selectedSourceId)
        .sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0))[0]
    : undefined;
  if (fromSource) return fromSource;

  return streams.find((stream) => stream.id === result.selectedStreamId) ?? streams[0];
}

export function subtitleCandidateToTrack(candidate: SubtitleCandidate): SubtitleTrack {
  const normalizedLang = normalizeIsoLanguageCode(candidate.language);
  const displayName = normalizedLang
    ? subtitleLanguageDisplayName(normalizedLang)
    : candidate.label;

  return {
    url: candidate.url,
    display: displayName ?? candidate.label,
    language: normalizedLang,
    release: candidate.syncEvidence,
    sourceKind: candidate.source === "provider" ? "external" : "embedded",
    sourceName: candidate.source,
    isHearingImpaired: looksLikeHiSubtitle(
      candidate.label,
      candidate.syncEvidence,
      candidate.language,
    ),
  };
}

function resolveSubtitleSource(
  candidates: readonly SubtitleCandidate[],
  tracks: readonly SubtitleTrack[],
): "direct" | "wyzie" | "provider" | "none" {
  if (tracks.length === 0) return "none";
  const hasEmbedded = candidates.some((c) => c.source === "embedded");
  return hasEmbedded ? "direct" : "provider";
}
