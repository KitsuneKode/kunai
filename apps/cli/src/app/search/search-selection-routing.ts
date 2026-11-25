import { primeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import type { Container } from "@/container";
import { providerLaneToShellMode } from "@/domain/provider-lane";
import type { EpisodeInfo, SearchResult, ShellMode, TitleInfo } from "@/domain/types";

function isYoutubeSearchResult(result: SearchResult): boolean {
  return (
    result.resultKind !== undefined ||
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

/**
 * Select a routed history entry (a `/watch` link, a history pick) and carry a
 * share link's start time into playback. One implementation for the startup
 * and in-session routes: the in-session copy had dropped the start time, so a
 * `t=` link pasted into `/watch` from search started at 0:00.
 */
export function adoptHistoryEntry(
  container: Pick<Container, "stateManager">,
  entry: {
    readonly title: TitleInfo;
    readonly episode?: EpisodeInfo;
    readonly startSeconds?: number;
  },
): TitleInfo {
  primeShareBootstrapStartSeconds(entry.startSeconds);
  container.stateManager.dispatch({ type: "SELECT_TITLE", title: entry.title });
  if (entry.episode) {
    container.stateManager.dispatch({ type: "SELECT_EPISODE", episode: entry.episode });
  }
  return entry.title;
}
