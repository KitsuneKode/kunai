import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import { selectSubtitle } from "@/subtitle";
import {
  looksLikeHiSubtitle,
  normalizeIsoLanguageCode,
  subtitleLanguageDisplayName,
} from "@kunai/providers";
import type { ProviderResolveResult, SubtitleCandidate } from "@kunai/types";

export interface ProviderResultAdapterInput {
  readonly result: ProviderResolveResult;
  readonly title: string;
  readonly subtitlePreference: string;
}

export function providerResolveResultToStreamInfo(
  input: ProviderResultAdapterInput,
): StreamInfo | null {
  const { result, title, subtitlePreference } = input;

  if (!result.streams.length) {
    return null;
  }

  const selected =
    result.streams.find((stream) => stream.id === result.selectedStreamId) ?? result.streams[0];
  if (!selected?.url) {
    return null;
  }

  const subtitleList = result.subtitles.map(subtitleCandidateToTrack);
  const pickedSubtitle =
    subtitlePreference === "none" ? null : selectSubtitle(subtitleList, subtitlePreference);

  const subtitleSource = resolveSubtitleSource(result.subtitles, subtitleList);

  return {
    url: selected.url,
    headers: selected.headers ?? {},
    audioLanguages: selected.audioLanguages ? [...selected.audioLanguages] : undefined,
    hardSubLanguage: selected.hardSubLanguage,
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
    providerResolveResult: result,
  };
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
