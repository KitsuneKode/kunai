// =============================================================================
// VidKing Provider Adapter
// =============================================================================

import type {
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";
import { buildVidkingEmbedUrl, createProviderRuntimeContext, vidkingManifest } from "@kunai/core";
import { resolveVidkingDirect } from "@kunai/providers";
import type { ProviderResolveInput, ProviderResolveResult, SubtitleCandidate } from "@kunai/types";

import {
  attachProviderResolveResult,
  episodeToCoreIdentity,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
  titleToCoreIdentity,
} from "../core-manifest-adapter";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class VidKingProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(vidkingManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(vidkingManifest);

  constructor(
    private deps: ProviderDeps,
    private internals: {
      resolveDirect?: typeof resolveVidkingDirect;
      resolveWyzie?: typeof resolveSubtitlesByTmdbId;
    } = {},
  ) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const resolveDirect = this.internals.resolveDirect ?? resolveVidkingDirect;
    const resolveWyzie = this.internals.resolveWyzie ?? resolveSubtitlesByTmdbId;
    const url = buildVidkingEmbedUrl({
      id: request.title.id,
      mediaKind: request.title.type,
      season: request.episode?.season,
      episode: request.episode?.episode,
    });

    let stream = providerResolveResultToStream(
      await resolveDirect(
        createVidkingResolveInput(request),
        createProviderRuntimeContext({ signal }),
      ),
      request,
    );
    const resolvedDirect = Boolean(stream);

    if (
      stream &&
      request.subLang !== "none" &&
      (!stream.subtitleList?.length || !stream.subtitle)
    ) {
      const wyzie = await resolveWyzie({
        tmdbId: request.title.id,
        type: request.title.type,
        season: request.episode?.season,
        episode: request.episode?.episode,
        preferredLang: request.subLang,
      });

      if (wyzie.list.length > 0) {
        const mergedSubtitleList = mergeSubtitleTracks(stream.subtitleList, wyzie.list);
        const mergedPick = selectSubtitle(mergedSubtitleList, request.subLang);
        stream = {
          ...stream,
          subtitle: mergedPick?.url ?? wyzie.selected ?? stream.subtitle,
          subtitleList: mergedSubtitleList,
          subtitleSource: stream.subtitleList?.length ? "provider" : "wyzie",
          subtitleEvidence: {
            directSubtitleObserved: Boolean(stream.subtitleList?.length),
            wyzieSearchObserved: true,
            reason: mergedPick?.url ? "wyzie-selected" : "wyzie-empty",
          },
        };
      }
    }

    if (!stream) {
      stream = await this.deps.browser.scrape({
        url,
        needsClick: false, // autoPlay=true handles it
        subLang: request.subLang,
        signal,
        tmdbId: request.title.id,
        titleType: request.title.type,
        season: request.episode?.season,
        episode: request.episode?.episode,
        playerDomains: this.deps.playerDomains,
      });
    }

    if (!stream) {
      return null;
    }

    if (resolvedDirect) {
      return stream;
    }

    return attachProviderResolveResult({
      manifest: vidkingManifest,
      request,
      stream,
      mode: "series",
      runtime: "playwright-lease",
    });
  }
}

// Factory for registry
export function createVidKingProvider(
  deps: ProviderDeps,
  internals?: ConstructorParameters<typeof VidKingProvider>[1],
): Provider {
  return new VidKingProvider(deps, internals);
}

function createVidkingResolveInput(request: StreamRequest): ProviderResolveInput {
  return {
    title: titleToCoreIdentity(request.title, "series"),
    episode: episodeToCoreIdentity(request.episode),
    mediaKind: request.title.type,
    preferredSubtitleLanguage: request.subLang,
    intent: "play",
    allowedRuntimes: ["node-fetch"],
  };
}

function providerResolveResultToStream(
  result: ProviderResolveResult | null,
  request: StreamRequest,
): StreamInfo | null {
  if (!result?.streams.length) {
    return null;
  }

  const selected =
    result.streams.find((stream) => stream.id === result.selectedStreamId) ?? result.streams[0];
  if (!selected?.url) {
    return null;
  }

  const subtitleList = result.subtitles.map(subtitleCandidateToTrack);
  const pickedSubtitle =
    request.subLang === "none" ? null : selectSubtitle(subtitleList, request.subLang);

  return {
    url: selected.url,
    headers: selected.headers ?? {},
    subtitle: pickedSubtitle?.url,
    subtitleList,
    subtitleSource: subtitleList.length > 0 ? "provider" : "none",
    subtitleEvidence: {
      directSubtitleObserved: subtitleList.length > 0,
      wyzieSearchObserved: false,
      reason: subtitleList.length > 0 ? "provider-default" : "not-observed",
    },
    title: request.title.name,
    timestamp: Date.now(),
    providerResolveResult: result,
  };
}

function subtitleCandidateToTrack(candidate: SubtitleCandidate): SubtitleTrack {
  return {
    url: candidate.url,
    display: candidate.label,
    language: candidate.language,
    release: candidate.syncEvidence,
    sourceKind:
      candidate.source === "provider" || candidate.source === "embedded" ? "embedded" : "external",
    sourceName: candidate.source,
    isHearingImpaired: looksLikeHiSubtitle(candidate),
  };
}

function looksLikeHiSubtitle(candidate: SubtitleCandidate): boolean {
  const raw = `${candidate.label ?? ""} ${candidate.syncEvidence ?? ""}`.toLowerCase();
  return raw.includes("sdh") || /\bhi\b/.test(raw) || raw.includes("hearing");
}
