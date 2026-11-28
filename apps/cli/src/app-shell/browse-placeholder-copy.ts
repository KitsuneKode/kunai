import type { ShellMode } from "@/domain/types";

export function browseIdleHint(mode: ShellMode): string {
  if (mode === "youtube") return "Search for a channel or video — or try /trending";
  if (mode === "anime") return "Search for an anime — or try /trending";
  return "Search for a title — or try /trending to see what's popular";
}

export function browseFilterPlaceholder(mode: ShellMode): string {
  if (mode === "youtube") return "type channel, playlist, video, downloaded…";
  if (mode === "anime") return "type title, year, anime, downloaded…";
  return "type title, year, movie, series, downloaded…";
}
