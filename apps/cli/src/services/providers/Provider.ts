import type {
  EpisodeInfo,
  EpisodePickerOption,
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";
import type { CoreProviderManifest, CoreProviderModule } from "@kunai/core";

export interface StreamRequest {
  title: TitleInfo;
  episode?: EpisodeInfo;
  audioPreference: string;
  subtitlePreference: string;
}

export interface EpisodeListRequest {
  title: TitleInfo;
}

export interface Provider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;
  canHandle(title: TitleInfo): boolean;
  resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null>;
  listEpisodes?(
    request: EpisodeListRequest,
    signal?: AbortSignal,
  ): Promise<EpisodePickerOption[] | null>;
  search?(
    query: string,
    opts: { audioPreference: string; subtitlePreference: string },
    signal?: AbortSignal,
  ): Promise<import("@/domain/types").SearchResult[] | null>;
}

export type ProviderResolveFn = (
  request: StreamRequest,
  signal?: AbortSignal,
) => Promise<StreamInfo | null>;

export function createProviderFromModule(
  module: CoreProviderModule,
  opts: {
    readonly mode: "series" | "anime";
    readonly resolveStream?: ProviderResolveFn;
    readonly search?: Provider["search"];
    readonly listEpisodes?: Provider["listEpisodes"];
    readonly canHandle?: (title: TitleInfo) => boolean;
  },
): Provider {
  const manifest = module.manifest;

  const metadata: ProviderMetadata = {
    id: manifest.id,
    name: manifest.displayName,
    aliases: manifest.aliases,
    description: manifest.description,
    recommended: manifest.recommended,
    isAnimeProvider: manifest.mediaKinds.includes("anime"),
    status: manifest.status,
    domain: manifest.domain,
  };

  const capabilities: ProviderCapabilities = {
    contentTypes: manifest.mediaKinds.filter(
      (k): k is "movie" | "series" => k === "movie" || k === "series",
    ),
  };

  return {
    metadata,
    capabilities,
    canHandle: opts.canHandle ?? defaultCanHandle(manifest),
    resolveStream: opts.resolveStream ?? defaultResolveStream(module, opts.mode),
    search: opts.search,
    listEpisodes: opts.listEpisodes,
  };
}

function defaultCanHandle(manifest: CoreProviderManifest) {
  return (title: TitleInfo): boolean => {
    return manifest.mediaKinds.includes(title.type) || manifest.mediaKinds.includes("anime");
  };
}

function defaultResolveStream(
  module: CoreProviderModule,
  mode: "series" | "anime",
): ProviderResolveFn {
  return async (request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> => {
    const { streamRequestToResolveInput } =
      await import("./stream-request-adapter");
    const { providerResolveResultToStreamInfo } =
      await import("./provider-result-adapter");

    const input = streamRequestToResolveInput(request, mode);
    const result = await module.resolve(input, {
      now: () => new Date().toISOString(),
      signal,
    });

    if (!result.streams.length) return null;

    return providerResolveResultToStreamInfo({
      result,
      title: request.title.name,
      subtitlePreference: request.subtitlePreference,
    });
  };
}
