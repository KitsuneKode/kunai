import type {
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";
import { selectSubtitle } from "@/subtitle";
import {
  createProviderResolveFailureError,
  createProviderRuntimeContext,
  type CoreProviderManifest,
} from "@kunai/core";
import type { CoreProviderModule } from "@kunai/core";
import type { ProviderResolveResult, SubtitleCandidate } from "@kunai/types";

import {
  episodeToCoreIdentity,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
  titleToCoreIdentity,
} from "../core-manifest-adapter";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export interface DirectModuleProviderOptions {
  readonly mode: "series" | "anime";
  readonly metadata?: Partial<ProviderMetadata>;
  readonly canHandle?: (title: TitleInfo) => boolean;
}

export class DirectModuleProvider implements Provider {
  readonly metadata: ProviderMetadata;

  readonly capabilities: ProviderCapabilities;

  constructor(
    private deps: ProviderDeps,
    private module: CoreProviderModule,
    private manifest: CoreProviderManifest,
    private options: DirectModuleProviderOptions,
  ) {
    this.metadata = manifestToProviderMetadata(manifest, options.metadata);
    this.capabilities = manifestToProviderCapabilities(manifest);
  }

  canHandle(title: TitleInfo): boolean {
    return this.options.canHandle?.(title) ?? this.capabilities.contentTypes.includes(title.type);
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const result = await this.module.resolve(
      {
        title: titleToCoreIdentity(request.title, this.options.mode),
        episode: episodeToCoreIdentity(request.episode),
        mediaKind: this.options.mode === "anime" ? "anime" : request.title.type,
        preferredAudioLanguage:
          this.options.mode === "anime"
            ? (request.animeLang ?? this.deps.config.animeLang)
            : undefined,
        preferredSubtitleLanguage: request.subLang,
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      createProviderRuntimeContext({ signal }),
    );

    const stream = providerResolveResultToStream(result, request);
    if (!stream) {
      throw createProviderResolveFailureError(result);
    }

    return stream;
  }
}

export function providerResolveResultToStream(
  result: ProviderResolveResult,
  request: StreamRequest,
): StreamInfo | null {
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
