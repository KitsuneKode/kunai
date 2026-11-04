import type { EpisodeInfo, SearchResult, ShellMode, TitleInfo } from "@/domain/types";

export type CompanionLane = "anime" | "series" | "movies" | "youtube";

export type CompanionCatalogEntry = {
  readonly title: TitleInfo;
  readonly providerId: string;
  readonly mode: ShellMode;
  readonly lane: CompanionLane;
  readonly result: SearchResult;
};

export class CompanionCatalogStore {
  private readonly entries = new Map<string, CompanionCatalogEntry>();
  private readonly episodes = new Map<string, readonly EpisodeInfo[]>();

  put(entry: CompanionCatalogEntry): string {
    if (this.entries.size >= 200) {
      const oldest = this.entries.keys().next().value;
      if (oldest) {
        this.entries.delete(oldest);
        this.episodes.delete(oldest);
      }
    }
    const id = crypto.randomUUID().replaceAll("-", "");
    this.entries.set(id, Object.freeze({ ...entry }));
    return id;
  }

  get(id: string): CompanionCatalogEntry | undefined {
    return this.entries.get(id);
  }

  setEpisodes(id: string, episodes: readonly EpisodeInfo[]): void {
    if (this.entries.has(id)) this.episodes.set(id, episodes);
  }

  getEpisode(id: string, season: number, episode: number): EpisodeInfo | undefined {
    return this.episodes
      .get(id)
      ?.find((item) => item.season === season && item.episode === episode);
  }

  clear(): void {
    this.entries.clear();
    this.episodes.clear();
  }
}

export function titleInfoFromSearchResult(result: SearchResult): TitleInfo {
  return {
    id: result.id,
    type: result.type,
    name: result.title,
    year: result.year,
    overview: result.overview,
    posterUrl:
      result.artwork?.posterUrl ??
      (result.posterPath?.startsWith("http")
        ? result.posterPath
        : result.posterPath
          ? `https://image.tmdb.org/t/p/w500${result.posterPath}`
          : undefined),
    isAnime: result.isAnime,
    externalIds: result.externalIds,
    release: result.release,
    artwork: result.artwork,
    languageEvidence: result.languageEvidence,
    episodeCount: result.episodeCount,
  };
}

export function posterUrlForSearchResult(result: SearchResult): string | null {
  if (result.artwork?.posterUrl) return result.artwork.posterUrl;
  if (!result.posterPath) return null;
  return result.posterPath.startsWith("http")
    ? result.posterPath
    : `https://image.tmdb.org/t/p/w500${result.posterPath}`;
}

export function parseCompanionLane(value: string | null): CompanionLane | null {
  if (value === "anime" || value === "series" || value === "movies" || value === "youtube") {
    return value;
  }
  return null;
}

export function shellModeForLane(lane: CompanionLane): ShellMode {
  if (lane === "anime") return "anime";
  if (lane === "youtube") return "youtube";
  return "series";
}
