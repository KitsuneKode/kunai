import { sanitizeProviderArtworkRef } from "@/domain/catalog/resolve-catalog-poster-url";
import type { ProviderMetadata, ShellMode, TitleInfo } from "@/domain/types";
import {
  buildFirstSeenRank,
  resolveProviderCatalogIdentity,
  resolveProviderId,
  resolveProviderLaneFromModule,
  type CoreProviderManifest,
  type ProviderEngine,
} from "@kunai/core";
import { stripControlCharacters } from "@kunai/providers";
import type { MediaKind, ProviderArtworkInfo } from "@kunai/types";

import { createProviderFromModule, type Provider } from "./Provider";
import { providerLaneMatchesMode, shellModeToProviderLane } from "./provider-lane";
import { titleToCoreIdentity } from "./stream-request-adapter";

/**
 * Every URL on a provider-supplied {@link ProviderArtworkInfo} is untrusted:
 * each field feeds a poster/thumbnail fetch or mpv surface, so local-shaped
 * refs and private literals are dropped at admission.
 */
function sanitizeProviderArtwork(
  artwork: ProviderArtworkInfo | undefined,
): ProviderArtworkInfo | undefined {
  if (!artwork) return artwork;
  return {
    posterUrl: sanitizeProviderArtworkRef(artwork.posterUrl),
    backdropUrl: sanitizeProviderArtworkRef(artwork.backdropUrl),
    thumbnailUrl: sanitizeProviderArtworkRef(artwork.thumbnailUrl),
    seekBarVttUrl: sanitizeProviderArtworkRef(artwork.seekBarVttUrl),
  };
}

export interface ProviderRegistry {
  get(id: string): Provider | undefined;
  getManifest(id: string): CoreProviderManifest | undefined;
  getAll(): Provider[];
  getAllIds(): string[];
  getCompatible(title: TitleInfo, mode?: ShellMode): Provider[];
  getDefault(isAnime: boolean): Provider;
  getDefaultForMode(mode: ShellMode): Provider;
  getMetadata(id: string): ProviderMetadata | undefined;
  setPriority(options: ProviderRegistryOptions): void;
}

export interface ProviderRegistryOptions {
  readonly providerPriority?: readonly string[];
  readonly animeProviderPriority?: readonly string[];
  readonly youtubeProviderPriority?: readonly string[];
}

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providersById = new Map<string, Provider>();
  private seriesRank = new Map<string, number>();
  private animeRank = new Map<string, number>();
  private youtubeRank = new Map<string, number>();

  constructor(
    private readonly engine: ProviderEngine,
    private options: ProviderRegistryOptions = {},
  ) {
    this.rebuildPriorityRanks();
    for (const module of engine.modules) {
      const lane = resolveProviderLaneFromModule(module);
      const shellMode: ShellMode =
        lane === "youtube" ? "youtube" : lane === "anime" ? "anime" : "series";
      const provider = createProviderFromModule(module, {
        mode: shellMode,
        search: module.search
          ? async (query, opts, signal?) => {
              const results = await module.search?.(
                {
                  query,
                  preferredAudioLanguage: opts.audioPreference,
                  preferredSubtitleLanguage: opts.subtitlePreference,
                  preferredResultKind: opts.resultKind,
                },
                this.engine.createRuntimeContext(module.providerId, signal),
              );
              if (!results) return null;
              // Provider JSON is attacker-influenceable text: titles, aliases,
              // overviews, and channel names all render into the terminal, so
              // control characters (ESC/OSC/BEL) are stripped at this boundary —
              // otherwise a hostile response could write clipboard escapes or
              // spoof UI lines, and the bytes would persist via history/SQLite.
              return results.map((r): import("@/domain/types").SearchResult => {
                // Provider-supplied poster refs must be remote http(s) URLs on
                // public literal hosts — a local-shaped or private target would
                // turn the poster pipeline into a file-read/SSRF oracle.
                const posterPath = sanitizeProviderArtworkRef(r.posterPath) ?? null;
                return {
                  id: r.id,
                  type: r.type,
                  title: stripControlCharacters(r.title),
                  titleAliases: [
                    ...(r.englishTitle
                      ? [
                          {
                            kind: "english" as const,
                            value: stripControlCharacters(r.englishTitle),
                          },
                        ]
                      : []),
                    ...(r.nativeTitle
                      ? [{ kind: "native" as const, value: stripControlCharacters(r.nativeTitle) }]
                      : []),
                    ...(r.altNames ?? [])
                      .slice(0, 3)
                      .map((v) => ({ kind: "synonym" as const, value: stripControlCharacters(v) })),
                  ],
                  year: r.year ?? "",
                  overview: stripControlCharacters(r.overview ?? ""),
                  posterPath,
                  posterSource: posterPath ? ("provider" as const) : undefined,
                  metadataSource: r.metadataSource,
                  rating: r.rating ?? null,
                  popularity: r.popularity ?? null,
                  episodeCount: r.episodeCount,
                  availableAudioModes: r.availableAudioModes,
                  subtitleAvailability: r.subtitleAvailability,
                  externalIds: r.externalIds,
                  release: r.release,
                  artwork: sanitizeProviderArtwork(r.artwork),
                  languageEvidence: r.languageEvidence,
                  durationSeconds: r.durationSeconds,
                  channelTitle: r.channelTitle
                    ? stripControlCharacters(r.channelTitle)
                    : r.channelTitle,
                  channelId: r.channelId,
                  viewCount: r.viewCount,
                  publishedAt: r.publishedAt,
                  liveStatus: r.liveStatus,
                  premium: r.premium,
                  paid: r.paid,
                  resultKind: r.resultKind,
                };
              });
            }
          : undefined,
        listEpisodes: module.listEpisodes
          ? async (request, signal?) => {
              // Build the title exactly as `resolve` does. Hand-rolling
              // `{id, kind, title}` here dropped externalIds/anilistId/tmdbId, so
              // AllAnime's AniList->native bridge and Miruro's numeric-id lookup
              // had nothing to read and episode listing only worked when the raw
              // session id happened to already be native.
              const kindOverride: MediaKind = module.manifest.mediaKinds.includes("anime")
                ? "anime"
                : module.manifest.mediaKinds.includes("video")
                  ? "video"
                  : request.title.type;
              const episodes = await module.listEpisodes?.(
                {
                  title: titleToCoreIdentity(
                    request.title,
                    shellMode,
                    resolveProviderCatalogIdentity(module.manifest),
                    module.providerId,
                    kindOverride,
                  ),
                  ...(request.audioPreference !== undefined
                    ? { preferredAudioLanguage: request.audioPreference }
                    : {}),
                  ...(request.subtitlePreference !== undefined
                    ? { preferredSubtitleLanguage: request.subtitlePreference }
                    : {}),
                },
                this.engine.createRuntimeContext(module.providerId, signal),
              );
              if (!episodes) return null;
              return episodes.map((ep) => {
                const detail = ep.detail ? stripControlCharacters(ep.detail) : ep.detail;
                return {
                  index: ep.index,
                  label: ep.label ? stripControlCharacters(ep.label) : ep.label,
                  providerEpisodeIdentity: ep.providerEpisodeIdentity,
                  name: ep.name ? stripControlCharacters(ep.name) : ep.name,
                  detail,
                  previewImageUrl: ep.artwork?.thumbnailUrl,
                  airDate: ep.release?.airDate,
                  overview: detail,
                  externalIds: ep.externalIds,
                  release: ep.release,
                  artwork: sanitizeProviderArtwork(ep.artwork),
                  totalEpisodeCount: ep.totalEpisodeCount,
                };
              });
            }
          : undefined,
      });
      this.providersById.set(module.manifest.id, provider);
    }
  }

  get(id: string): Provider | undefined {
    return this.providersById.get(resolveProviderId(id));
  }

  getManifest(id: string): CoreProviderManifest | undefined {
    return this.engine.getManifest(id);
  }

  getAll(): Provider[] {
    return this.sortByPriority([...this.providersById.values()]);
  }

  getAllIds(): string[] {
    return this.engine.getProviderIds();
  }

  getCompatible(title: TitleInfo, mode?: ShellMode): Provider[] {
    return this.getAll().filter((provider) => {
      if (mode && !providerLaneMatchesMode(provider.metadata.providerLane, mode)) {
        return false;
      }
      return provider.canHandle(title);
    });
  }

  getDefault(isAnime: boolean): Provider {
    return this.getDefaultForMode(isAnime ? "anime" : "series");
  }

  getDefaultForMode(mode: ShellMode): Provider {
    const lane = shellModeToProviderLane(mode);
    const preferred = this.getPriorityForLane(lane)
      .map((providerId) => this.providersById.get(resolveProviderId(providerId)))
      .find((provider) => provider && provider.metadata.providerLane === lane);

    if (preferred) return preferred;

    const fallback = this.getAll().find((provider) => provider.metadata.providerLane === lane);
    if (!fallback) {
      throw new Error(`No providers available for mode: ${mode}`);
    }
    return fallback;
  }

  getMetadata(id: string): ProviderMetadata | undefined {
    return this.providersById.get(resolveProviderId(id))?.metadata;
  }

  setPriority(options: ProviderRegistryOptions): void {
    this.options = {
      providerPriority: options.providerPriority ?? this.options.providerPriority,
      animeProviderPriority: options.animeProviderPriority ?? this.options.animeProviderPriority,
      youtubeProviderPriority:
        options.youtubeProviderPriority ?? this.options.youtubeProviderPriority,
    };
    this.rebuildPriorityRanks();
  }

  private sortByPriority(providers: readonly Provider[]): Provider[] {
    return [...providers].sort((a, b) => {
      const aRank = this.rankForProvider(a);
      const bRank = this.rankForProvider(b);
      return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
    });
  }

  private rankForProvider(provider: Provider): number | undefined {
    const lane = provider.metadata.providerLane;
    if (lane === "anime") return this.animeRank.get(provider.metadata.id);
    if (lane === "youtube") return this.youtubeRank.get(provider.metadata.id);
    return this.seriesRank.get(provider.metadata.id);
  }

  private getPriorityForLane(lane: ReturnType<typeof shellModeToProviderLane>): readonly string[] {
    if (lane === "anime") return this.options.animeProviderPriority ?? [];
    if (lane === "youtube") return this.options.youtubeProviderPriority ?? [];
    return this.options.providerPriority ?? [];
  }

  private rebuildPriorityRanks(): void {
    this.seriesRank = buildFirstSeenRank(this.options.providerPriority);
    this.animeRank = buildFirstSeenRank(this.options.animeProviderPriority);
    this.youtubeRank = buildFirstSeenRank(this.options.youtubeProviderPriority);
  }
}

export function createProviderRegistry(
  engine: ProviderEngine,
  options?: ProviderRegistryOptions,
): ProviderRegistry {
  return new ProviderRegistryImpl(engine, options);
}
