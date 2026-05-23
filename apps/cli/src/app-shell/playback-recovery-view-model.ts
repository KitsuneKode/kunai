import type { ActionRowModel } from "./primitives/ActionList";
import type { StateBlockModel } from "./primitives/StateBlock";
import type { LoadingShellState } from "./types";

export type PlaybackRecoveryViewModel = {
  readonly state: StateBlockModel;
  readonly actions: readonly ActionRowModel[];
};

function normalizedIssue(state: LoadingShellState): string {
  return state.latestIssue?.trim().toLowerCase() ?? "";
}

export function buildPlaybackRecoveryViewModel(
  state: LoadingShellState,
): PlaybackRecoveryViewModel | null {
  const issue = normalizedIssue(state);
  const stalled =
    state.bufferHealth === "stalled" ||
    issue.includes("stream stalled") ||
    issue.includes("ipc stalled") ||
    issue.includes("no playback progress");
  const didNotStart =
    issue.includes("playback did not start") ||
    issue.includes("mpv did not start") ||
    issue.includes("player did not start");
  const noSource =
    issue.includes("no source") ||
    issue.includes("source unavailable") ||
    issue.includes("quality variants unavailable");
  const degraded = issue.includes("degraded") || issue.includes("fallback");

  if (!stalled && !didNotStart && !noSource && !degraded) return null;

  const actions: ActionRowModel[] = [];
  if (stalled || didNotStart || noSource) {
    actions.push({
      id: "recover",
      label: "Recover",
      detail: "Refresh this stream and resume from saved progress",
      shortcut: "r",
      tone: "warning",
    });
  }
  if (state.fallbackAvailable) {
    actions.push({
      id: "fallback",
      label: "Fallback",
      detail: state.fallbackProviderName
        ? `Try ${state.fallbackProviderName}`
        : "Try another compatible provider",
      shortcut: "f",
      tone: "warning",
    });
  }
  if (stalled || didNotStart || noSource) {
    actions.push({
      id: "sources",
      label: "Sources",
      detail: "Choose a different source or stream variant",
      shortcut: "s",
    });
  }
  actions.push({
    id: "diagnostics",
    label: "Diagnostics",
    detail: "Open trace and playback evidence",
    shortcut: "d",
    tone: "muted",
  });

  const title = stalled
    ? "Stream stalled"
    : didNotStart
      ? "Playback did not start"
      : noSource
        ? "No playable source"
        : "Provider degraded";

  return {
    state: {
      kind: stalled || didNotStart || noSource ? "error" : "info",
      title,
      detail:
        stalled || didNotStart || noSource
          ? "Progress is preserved. Kunai will not mark this episode watched until playback recovers."
          : "Kunai is trying a safer path. You can fallback or inspect diagnostics.",
      actions,
    },
    actions,
  };
}
