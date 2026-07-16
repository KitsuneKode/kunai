import type { PlaybackTargetRef, ShareAnchor } from "@/domain/share/playback-target-ref";
import type { ShellMode, TitleInfo } from "@/domain/types";

export function buildShareRefFromTitleContext(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly absoluteEpisode?: number;
  readonly startSeconds?: number;
  readonly providerId?: string;
}): PlaybackTargetRef | null {
  const anchor = resolveShareAnchor(input.title);
  if (!anchor) return null;
  const kind = resolveShareKind(input.title, input.mode);
  return {
    anchor,
    kind,
    ...(input.episode ? { season: input.episode.season, episode: input.episode.episode } : {}),
    ...(input.absoluteEpisode !== undefined ? { absoluteEpisode: input.absoluteEpisode } : {}),
    ...(input.startSeconds !== undefined ? { startSeconds: input.startSeconds } : {}),
    ...(input.title.name ? { title: input.title.name } : {}),
    ...(input.providerId ? { hint: { providerId: input.providerId } } : {}),
  };
}

function resolveShareKind(
  title: Pick<TitleInfo, "type" | "isAnime">,
  mode: ShellMode,
): PlaybackTargetRef["kind"] {
  if (mode === "youtube") return "video";
  if (mode === "anime" || title.isAnime) return "anime";
  return title.type === "movie" ? "movie" : "series";
}

function resolveShareAnchor(
  title: Pick<TitleInfo, "id" | "name" | "externalIds">,
): ShareAnchor | null {
  const external = title.externalIds;
  if (external?.youtubeId?.trim()) {
    return { by: "catalog", ns: "youtube", id: external.youtubeId.trim() };
  }
  if (external?.youtubePlaylistId?.trim()) {
    return { by: "catalog", ns: "youtube", id: external.youtubePlaylistId.trim() };
  }
  if (external?.anilistId?.trim()) {
    return { by: "catalog", ns: "anilist", id: external.anilistId.trim() };
  }
  if (external?.tmdbId?.trim()) {
    return { by: "catalog", ns: "tmdb", id: external.tmdbId.trim() };
  }
  if (external?.malId?.trim()) {
    return { by: "catalog", ns: "mal", id: external.malId.trim() };
  }
  if (external?.imdbId?.trim()) {
    const id = external.imdbId.trim().replace(/^tt/, "");
    return { by: "catalog", ns: "imdb", id: id.startsWith("tt") ? id : `tt${id}` };
  }
  const anilistFromId = /^anilist:(\d+)$/.exec(title.id.trim());
  if (anilistFromId?.[1]) return { by: "catalog", ns: "anilist", id: anilistFromId[1] };
  const tmdbFromId = /^tmdb:(\d+)$/.exec(title.id.trim());
  if (tmdbFromId?.[1]) return { by: "catalog", ns: "tmdb", id: tmdbFromId[1] };
  const malFromId = /^mal:(\d+)$/.exec(title.id.trim());
  if (malFromId?.[1]) return { by: "catalog", ns: "mal", id: malFromId[1] };
  const youtubeFromId = /^youtube:(.+)$/.exec(title.id.trim());
  if (youtubeFromId?.[1]) return { by: "catalog", ns: "youtube", id: youtubeFromId[1] };
  const query = title.name?.trim();
  if (!query) return null;
  return { by: "search", query: query.slice(0, 200) };
}
