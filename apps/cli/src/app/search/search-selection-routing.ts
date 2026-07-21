import type { Container } from "@/container";
import { providerLaneToShellMode } from "@/domain/provider-lane";
import type { SearchResult, ShellMode } from "@/domain/types";

function isYoutubeSearchResult(result: SearchResult): boolean {
  return (
    result.contentShape !== undefined ||
    Boolean(result.externalIds?.youtubeId) ||
    Boolean(result.externalIds?.youtubePlaylistId) ||
    result.id.startsWith("youtube:")
  );
}

/** Provider routing mode for a browse/search pick — stamped lane overrides session mode. */
export function resolveShellModeForSearchResult(
  result: SearchResult,
  fallbackMode: ShellMode,
): ShellMode {
  if (result.resolvedLane) return providerLaneToShellMode(result.resolvedLane);
  if (isYoutubeSearchResult(result)) return "youtube";
  const calendarKind = result.calendar?.contentKind;
  if (calendarKind === "anime") return "anime";
  if (calendarKind === "series" || calendarKind === "movie") return "series";
  if (result.isAnime) return "anime";
  return fallbackMode;
}

export function applySearchSelectionSessionRouting(
  container: Pick<Container, "stateManager">,
  result: SearchResult,
): ShellMode {
  const state = container.stateManager.getState();
  const targetMode = resolveShellModeForSearchResult(result, state.mode);
  if (targetMode === state.mode) return targetMode;

  const provider =
    targetMode === "anime"
      ? state.defaultProviders.anime
      : targetMode === "youtube"
        ? state.defaultProviders.youtube
        : state.defaultProviders.series;

  container.stateManager.dispatch({
    type: "SET_MODE",
    mode: targetMode,
    provider,
  });
  return targetMode;
}
