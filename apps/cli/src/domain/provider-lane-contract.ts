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
  return resolveTitleProviderLane(title) === shellModeToProviderLane(mode);
}

export function assertTitleMatchesShellMode(
  title: Pick<TitleInfo, "id" | "externalIds" | "isAnime">,
  mode: ShellMode,
): void {
  const lane = resolveTitleProviderLane(title);
  if (lane !== shellModeToProviderLane(mode)) {
    throw new Error(`Title belongs to ${lane} lane, not ${mode} mode`);
  }
}
