import type { ProviderMetadata, ShellMode, TitleInfo } from "@/domain/types";
import { buildFirstSeenRank, type CoreProviderManifest, type ProviderEngine } from "@kunai/core";

import { createProviderFromModule, type Provider } from "./Provider";

export interface ProviderRegistry {
  get(id: string): Provider | undefined;
  getManifest(id: string): CoreProviderManifest | undefined;
  getAll(): Provider[];
  getAllIds(): string[];
  getCompatible(title: TitleInfo, mode?: ShellMode): Provider[];
  getDefault(isAnime: boolean): Provider;
  getMetadata(id: string): ProviderMetadata | undefined;
  setPriority(options: ProviderRegistryOptions): void;
}

export interface ProviderRegistryOptions {
  readonly providerPriority?: readonly string[];
  readonly animeProviderPriority?: readonly string[];
}

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providersById = new Map<string, Provider>();
  private seriesRank = new Map<string, number>();
  private animeRank = new Map<string, number>();

  constructor(
    private readonly engine: ProviderEngine,
    private options: ProviderRegistryOptions = {},
  ) {
    this.rebuildPriorityRanks();
    for (const module of engine.modules) {
      const provider = createProviderFromModule(module, {
        mode: module.manifest.mediaKinds.includes("anime") ? "anime" : "series",
        search: module.search
          ? async (query, opts, signal?) => {
              const results = await module.search?.(
                {
                  query,
                  preferredAudioLanguage: opts.audioPreference,
                  preferredSubtitleLanguage: opts.subtitlePreference,
                },
                { now: () => new Date().toISOString(), signal },
              );
              if (!results) return null;
              return results.map((r): import("@/domain/types").SearchResult => ({
                id: r.id,
                type: r.type,
                title: r.title,
                titleAliases: [
                  ...(r.englishTitle ? [{ kind: "english" as const, value: r.englishTitle }] : []),
                  ...(r.nativeTitle ? [{ kind: "native" as const, value: r.nativeTitle }] : []),
                  ...(r.altNames ?? [])
                    .slice(0, 3)
                    .map((v) => ({ kind: "synonym" as const, value: v })),
                ],
                year: r.year ?? "",
                overview: r.overview ?? "",
                posterPath: r.posterPath ?? null,
                posterSource: r.posterPath ? ("provider" as const) : undefined,
                metadataSource: r.metadataSource,
                rating: r.rating ?? null,
                popularity: r.popularity ?? null,
                episodeCount: r.episodeCount,
                availableAudioModes: r.availableAudioModes,
                subtitleAvailability: r.subtitleAvailability,
                externalIds: r.externalIds,
                release: r.release,
                artwork: r.artwork,
                languageEvidence: r.languageEvidence,
              }));
            }
          : undefined,
        listEpisodes: module.listEpisodes
          ? async (request, signal?) => {
              const episodes = await module.listEpisodes?.(
                {
                  title: {
                    id: request.title.id,
                    kind: module.manifest.mediaKinds.includes("anime")
                      ? "anime"
                      : request.title.type,
                    title: request.title.name,
                  },
                },
                { now: () => new Date().toISOString(), signal },
              );
              return episodes ? [...episodes] : null;
            }
          : undefined,
      });
      this.providersById.set(module.manifest.id, provider);
    }
  }

  get(id: string): Provider | undefined {
    return this.providersById.get(id);
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
      if (mode && provider.metadata.isAnimeProvider !== (mode === "anime")) {
        return false;
      }
      return provider.canHandle(title);
    });
  }

  getDefault(isAnime: boolean): Provider {
    const preferred = this.getPriority(isAnime)
      .map((providerId) => this.providersById.get(providerId))
      .find((provider) => provider && provider.metadata.isAnimeProvider === isAnime);

    if (preferred) return preferred;

    const fallback = this.getAll().find((p) =>
      isAnime ? p.metadata.isAnimeProvider : !p.metadata.isAnimeProvider,
    );

    if (!fallback) {
      throw new Error(`No providers available for mode: ${isAnime ? "anime" : "series"}`);
    }

    return fallback;
  }

  getMetadata(id: string): ProviderMetadata | undefined {
    return this.providersById.get(id)?.metadata;
  }

  setPriority(options: ProviderRegistryOptions): void {
    this.options = {
      providerPriority: options.providerPriority ?? this.options.providerPriority,
      animeProviderPriority: options.animeProviderPriority ?? this.options.animeProviderPriority,
    };
    this.rebuildPriorityRanks();
  }

  private sortByPriority(providers: readonly Provider[]): Provider[] {
    return [...providers].sort((a, b) => {
      const aRank = a.metadata.isAnimeProvider
        ? this.animeRank.get(a.metadata.id)
        : this.seriesRank.get(a.metadata.id);
      const bRank = b.metadata.isAnimeProvider
        ? this.animeRank.get(b.metadata.id)
        : this.seriesRank.get(b.metadata.id);
      return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
    });
  }

  private getPriority(isAnime: boolean): readonly string[] {
    return isAnime
      ? (this.options.animeProviderPriority ?? [])
      : (this.options.providerPriority ?? []);
  }

  private rebuildPriorityRanks(): void {
    this.seriesRank = buildFirstSeenRank(this.options.providerPriority);
    this.animeRank = buildFirstSeenRank(this.options.animeProviderPriority);
  }
}

export function createProviderRegistry(
  engine: ProviderEngine,
  options?: ProviderRegistryOptions,
): ProviderRegistry {
  return new ProviderRegistryImpl(engine, options);
}
