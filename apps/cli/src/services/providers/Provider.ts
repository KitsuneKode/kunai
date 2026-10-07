import type {
  EpisodeInfo,
  EpisodePickerOption,
  ProviderMetadata,
  ShellMode,
  TitleInfo,
  YouTubeResultKind,
} from "@/domain/types";
import type { CoreProviderManifest, CoreProviderModule } from "@kunai/core";
import { resolveProviderCatalogIdentity, resolveProviderLaneFromModule } from "@kunai/core";
import type { StartupPriority } from "@kunai/types";

export interface StreamRequest {
  title: TitleInfo;
  episode?: EpisodeInfo;
  audioPreference: string;
  subtitlePreference: string;
  qualityPreference?: string;
  startupPriority?: StartupPriority;
}

export interface EpisodeListRequest {
  title: TitleInfo;
  /**
   * Same language context `resolve` receives. Without it AllAnime's
   * `resolveAnimeAudioIntent` always falls back to the sub catalog, so dub users
   * were shown sub episode counts and labels.
   */
  audioPreference?: string;
  subtitlePreference?: string;
}

export interface Provider {
  readonly metadata: ProviderMetadata;
  canHandle(title: TitleInfo): boolean;
  listEpisodes?(
    request: EpisodeListRequest,
    signal?: AbortSignal,
  ): Promise<EpisodePickerOption[] | null>;
  search?(
    query: string,
    opts: {
      audioPreference: string;
      subtitlePreference: string;
      resultKind?: YouTubeResultKind;
    },
    signal?: AbortSignal,
  ): Promise<import("@/domain/types").SearchResult[] | null>;
}

export function createProviderFromModule(
  module: CoreProviderModule,
  opts: {
    readonly mode: ShellMode;
    readonly search?: Provider["search"];
    readonly listEpisodes?: Provider["listEpisodes"];
    readonly canHandle?: (title: TitleInfo) => boolean;
  },
): Provider {
  const manifest = module.manifest;
  const lane = resolveProviderLaneFromModule(module);

  const metadata: ProviderMetadata = {
    id: manifest.id,
    name: manifest.displayName,
    aliases: manifest.aliases,
    description: manifest.description,
    isAnimeProvider: lane === "anime",
    isYoutubeProvider: lane === "youtube",
    providerLane: lane,
    catalogIdentity: resolveProviderCatalogIdentity(manifest),
    domain: manifest.domain,
  };

  return {
    metadata,
    canHandle: opts.canHandle ?? defaultCanHandle(manifest),
    search: opts.search,
    listEpisodes: opts.listEpisodes,
  };
}

function defaultCanHandle(manifest: CoreProviderManifest) {
  return (title: TitleInfo): boolean => {
    if (manifest.mediaKinds.includes("video")) {
      return title.id.startsWith("youtube:") || Boolean(title.externalIds?.youtubeId);
    }
    return manifest.mediaKinds.includes(title.type) || manifest.mediaKinds.includes("anime");
  };
}
