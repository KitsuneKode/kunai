import type { ProviderMetadata, ShellMode, TitleInfo } from "@/domain/types";
import type { CoreProviderManifest, ProviderEngine } from "@kunai/core";
import { fetchAllMangaEpisodeCatalog, searchAllManga } from "@kunai/providers";

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

const ALLMANGA_API_URL = "https://api.allanime.day/api";
const ALLMANGA_REFERER = "https://allmanga.to";
const ALLMANGA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export class ProviderRegistryImpl implements ProviderRegistry {
  private readonly providersById = new Map<string, Provider>();

  constructor(private readonly engine: ProviderEngine) {
    for (const module of engine.modules) {
      const isAllManga = module.providerId === "allanime";

      const provider = createProviderFromModule(module, {
        mode: module.manifest.mediaKinds.includes("anime") ? "anime" : "series",
        search: isAllManga
          ? async (query, opts, _signal?) => {
              const animeLang =
                opts.audioPreference === "ja" || opts.audioPreference === "original"
                  ? ("sub" as const)
                  : ("dub" as const);
              const results = await searchAllManga(
                ALLMANGA_API_URL,
                ALLMANGA_REFERER,
                ALLMANGA_UA,
                query,
                animeLang,
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
                overview: r.description ?? "",
                posterPath: r.posterUrl ?? null,
                posterSource: r.posterUrl ? ("AniList" as const) : undefined,
                metadataSource: r.aniListId ? "AniList" : "AllManga",
                rating: r.averageScore ?? r.score ?? null,
                popularity: r.popularity ?? null,
                episodeCount: r.epCount,
                availableAudioModes: r.availableAudioModes,
                subtitleAvailability: r.availableAudioModes?.includes("sub")
                  ? ("hardsub" as const)
                  : ("unknown" as const),
              }));
            }
          : undefined,
        listEpisodes: isAllManga
          ? async (request, _signal?) => {
              return fetchAllMangaEpisodeCatalog({
                apiUrl: ALLMANGA_API_URL,
                referer: ALLMANGA_REFERER,
                ua: ALLMANGA_UA,
                showId: request.title.id,
                mode: "sub",
              });
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
