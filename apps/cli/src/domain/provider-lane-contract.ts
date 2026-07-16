import type { ProviderLane, ShellMode, TitleInfo } from "@/domain/types";

import { shellModeToProviderLane } from "./provider-lane";

export function resolveTitleProviderLane(
  title: Pick<TitleInfo, "id" | "externalIds" | "isAnime">,
): ProviderLane {
  if (title.id.startsWith("youtube:") || title.externalIds?.youtubeId) return "youtube";
  if (title.isAnime || title.id.startsWith("anilist:")) return "anime";
  return "series";
}

export function titleMatchesShellMode(
  title: Pick<TitleInfo, "id" | "externalIds" | "isAnime">,
  mode: ShellMode,
): boolean {
  const lane = resolveTitleProviderLane(title);
  const modeLane = shellModeToProviderLane(mode);

  // YouTube identities are globally unique and must never cross lanes. Explicit
  // AniList/anime identities need anime mode too, but opaque provider-native IDs
  // have no lane marker until their adapter maps them, so anime mode may accept
  // that unclassified form.
  if (lane === "youtube" || modeLane === "youtube") return lane === modeLane;
  if (lane !== "anime" || modeLane === "anime") return true;
  // Dual-lane: an anime work with a known TMDB id may resolve through the
  // series lane (Videasy etc.); the resolve adapter maps kind and episode.
  return Boolean(title.externalIds?.tmdbId);
}

/** Which provider lanes can serve this title given its current id bag. */
export function resolveTitleLaneEligibility(
  title: Pick<TitleInfo, "id" | "externalIds" | "isAnime">,
): { readonly anime: boolean; readonly series: boolean; readonly youtube: boolean } {
  const lane = resolveTitleProviderLane(title);
  if (lane === "youtube") return { anime: false, series: false, youtube: true };
  const anime =
    lane === "anime" || Boolean(title.externalIds?.anilistId) || Boolean(title.externalIds?.malId);
  const series = lane === "series" || Boolean(title.externalIds?.tmdbId);
  return { anime, series, youtube: false };
}

export function assertTitleMatchesShellMode(
  title: Pick<TitleInfo, "id" | "externalIds" | "isAnime">,
  mode: ShellMode,
): void {
  const lane = resolveTitleProviderLane(title);
  if (!titleMatchesShellMode(title, mode)) {
    throw new Error(`Title belongs to ${lane} lane, not ${mode} mode`);
  }
}
