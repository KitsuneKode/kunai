import type { ProviderMetadata, ShellMode, TitleInfo } from "@/domain/types";
import type { CoreProviderManifest, ProviderEngine } from "@kunai/core";

import { createProviderFromModule, type Provider } from "./Provider";

export interface ProviderRegistry {
  get(id: string): Provider | undefined;
  getManifest(id: string): CoreProviderManifest | undefined;
  getAll(): Provider[];
  getAllIds(): string[];
  getCompatible(title: TitleInfo, mode?: ShellMode): Provider[];
  getDefault(isAnime: boolean): Provider;
  getMetadata(id: string): ProviderMetadata | undefined;
}

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providersById = new Map<string, Provider>();

  constructor(private readonly engine: ProviderEngine) {
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
    return [...this.providersById.values()];
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
    const preferred = isAnime
      ? this.providersById.get("allanime")
      : this.providersById.get("vidking");

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
}

export function createProviderRegistry(engine: ProviderEngine): ProviderRegistry {
  return new ProviderRegistryImpl(engine);
}
