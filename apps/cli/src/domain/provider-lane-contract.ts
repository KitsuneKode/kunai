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
  return lane !== "anime" || modeLane === "anime";
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
