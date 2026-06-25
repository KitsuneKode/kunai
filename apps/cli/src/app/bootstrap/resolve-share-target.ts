import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import type { Container } from "@/container";
import type { PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, SearchResult, ShellMode, TitleInfo } from "@/domain/types";
import { resolveProviderIdAlias } from "@kunai/core";

export type ResolvedShareTarget = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly startSeconds?: number;
  readonly mode: ShellMode;
  readonly searchQuery?: string;
  readonly autoPickIndex?: number;
  readonly download?: boolean;
  readonly note?: string;
};

export async function resolveShareTarget(
  ref: PlaybackTargetRef,
  container: Container,
  options: { readonly action?: "play" | "download" } = {},
): Promise<ResolvedShareTarget> {
  const mode: ShellMode =
    ref.kind === "anime" ? "anime" : ref.kind === "video" ? "youtube" : "series";
  const hintNote = validateProviderHint(ref, container);
  const download = options.action === "download";

  if (ref.anchor.by === "search") {
    return {
      title: {
        id: `search:${ref.anchor.query}`,
        type: ref.kind === "movie" || ref.kind === "video" ? "movie" : "series",
        name: ref.title ?? ref.anchor.query,
        ...(ref.kind === "anime" ? { isAnime: true as const } : {}),
      },
      mode,
      searchQuery: ref.anchor.query,
      autoPickIndex: 1,
      ...(ref.startSeconds !== undefined ? { startSeconds: ref.startSeconds } : {}),
      ...(download ? { download: true } : {}),
      ...(hintNote ? { note: hintNote } : {}),
    };
  }

  let title = buildTitleFromCatalogAnchor(ref);
  if (ref.kind === "anime") {
    const mapped = await mapAnimeTitleToProviderNative(title, container, mode);
    title = mapped.title;
    const mappingNote = mapped.note;
    const episode = buildEpisode(ref);
    return {
      title,
      mode,
      ...(episode ? { episode } : {}),
      ...(ref.startSeconds !== undefined ? { startSeconds: ref.startSeconds } : {}),
      ...(download ? { download: true } : {}),
      ...(joinNotes(hintNote, mappingNote) ? { note: joinNotes(hintNote, mappingNote) } : {}),
    };
  }

  const episode = buildEpisode(ref);
  return {
    title,
    mode,
    ...(episode ? { episode } : {}),
    ...(ref.startSeconds !== undefined ? { startSeconds: ref.startSeconds } : {}),
    ...(download ? { download: true } : {}),
    ...(hintNote ? { note: hintNote } : {}),
  };
}

function buildTitleFromCatalogAnchor(ref: PlaybackTargetRef): TitleInfo {
  const anchor = ref.anchor as Extract<PlaybackTargetRef["anchor"], { by: "catalog" }>;
  const externalIds = catalogExternalIds(anchor.ns, anchor.id);
  const id = anchor.ns === "youtube" ? `youtube:${anchor.id}` : `${anchor.ns}:${anchor.id}`;
  return {
    id,
    type: ref.kind === "movie" || ref.kind === "video" ? "movie" : "series",
    name: ref.title ?? id,
    externalIds,
    ...(ref.kind === "anime" ? { isAnime: true as const } : {}),
  };
}

function catalogExternalIds(
  ns: Extract<PlaybackTargetRef["anchor"], { by: "catalog" }>["ns"],
  id: string,
) {
  switch (ns) {
    case "youtube":
      return /^PL[\w-]+$/.test(id) ? { youtubePlaylistId: id } : { youtubeId: id };
    case "tmdb":
      return { tmdbId: id };
    case "anilist":
      return { anilistId: id };
    case "mal":
      return { malId: id };
    case "imdb":
      return { imdbId: id.startsWith("tt") ? id : `tt${id}` };
  }
}

function buildEpisode(ref: PlaybackTargetRef): EpisodeInfo | undefined {
  if (typeof ref.season === "number" && typeof ref.episode === "number") {
    return { season: ref.season, episode: ref.episode };
  }
  if (typeof ref.absoluteEpisode === "number") {
    return { season: 1, episode: ref.absoluteEpisode };
  }
  if (typeof ref.episode === "number") {
    return { season: 1, episode: ref.episode };
  }
  return undefined;
}

function validateProviderHint(ref: PlaybackTargetRef, container: Container): string | undefined {
  if (!ref.hint?.providerId) return undefined;
  const normalized = resolveProviderIdAlias(ref.hint.providerId);
  const provider = container.providerRegistry.get(normalized);
  if (!provider) {
    return `Shared source "${ref.hint.providerId}" isn't available here — using your default provider.`;
  }
  if (ref.kind === "anime" && !provider.metadata.isAnimeProvider) {
    return `Shared source "${ref.hint.providerId}" is not an anime provider here — using your default provider.`;
  }
  if (ref.kind === "video" && provider.metadata.id !== "youtube") {
    return `Shared source "${ref.hint.providerId}" is not the YouTube provider here — using your default provider.`;
  }
  return undefined;
}

async function mapAnimeTitleToProviderNative(
  title: TitleInfo,
  container: Container,
  mode: ShellMode,
): Promise<{ readonly title: TitleInfo; readonly note?: string }> {
  const providerId = container.stateManager.getState().provider;
  const catalogId = shareTitleCatalogIdForAnimeMapping(title);
  const searchResult: SearchResult = {
    id: catalogId,
    title: title.name,
    type: title.type,
    year: title.year ?? "",
    overview: "",
    posterPath: title.posterUrl ?? null,
    externalIds: title.externalIds,
  };
  try {
    const mapped = await mapAnimeDiscoveryResultToProviderNative(searchResult, {
      mode,
      providerId,
      animeLanguageProfile: container.config.animeLanguageProfile,
      providerRegistry: container.providerRegistry,
    });
    if (mapped.id === searchResult.id) return { title };
    return {
      title: {
        ...title,
        id: mapped.id,
        externalIds: mapped.externalIds ?? title.externalIds,
      },
    };
  } catch {
    return {
      title,
      note: "Could not map this anime to your provider — trying the shared catalog id.",
    };
  }
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const merged = notes.filter((note): note is string => Boolean(note?.trim()));
  return merged.length > 0 ? merged.join(" ") : undefined;
}

/** Normalizes portable catalog ids before anime provider-native remapping. */
export function shareTitleCatalogIdForAnimeMapping(title: TitleInfo): string {
  return (
    title.externalIds?.anilistId ??
    title.externalIds?.malId ??
    title.externalIds?.tmdbId ??
    title.id.replace(/^(?:anilist|mal|tmdb):/, "")
  );
}
