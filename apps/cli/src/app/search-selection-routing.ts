import type { Container } from "@/container";
import type { SearchResult, ShellMode } from "@/domain/types";

/** Provider routing mode for a browse/search pick — calendar rows override session mode. */
export function resolveShellModeForSearchResult(
  result: SearchResult,
  fallbackMode: ShellMode,
): ShellMode {
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

  container.stateManager.dispatch({
    type: "SET_MODE",
    mode: targetMode,
    provider: targetMode === "anime" ? state.defaultProviders.anime : state.defaultProviders.series,
  });
  return targetMode;
}
