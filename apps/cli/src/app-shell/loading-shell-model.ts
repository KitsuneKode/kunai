import { selectFooterActions } from "./shell-primitives";
import type { FooterAction, LoadingShellState } from "./types";

export function buildLoadingFooterActions(state: LoadingShellState): readonly FooterAction[] {
  const fallbackLabel = state.fallbackProviderName
    ? `fallback ${state.fallbackProviderName}`
    : "fallback";
  const isSeriesPlayback = Boolean(
    state.isSeriesPlayback || state.hasNextEpisode || state.hasPreviousEpisode,
  );
  if (state.operation === "playing") {
    const playingFooterActions: readonly FooterAction[] = [
      { key: "/", label: "commands", action: "command-mode", primary: true },
      ...(isSeriesPlayback
        ? [
            { key: "e", label: "episodes", action: "pick-episode" as const },
            {
              key: "a",
              label: state.autoplayPaused ? "resume autoplay" : "pause autoplay",
              action: "toggle-autoplay" as const,
            },
          ]
        : []),
      { key: "t", label: "tracks", action: "source" },
      { key: "q", label: "stop", action: "quit" },
    ];
    return selectFooterActions(playingFooterActions, "minimal");
  }

  return [
    { key: "/", label: "commands", action: "command-mode" },
    ...(state.hasStreamCandidates
      ? [{ key: "o", label: "source", action: "source" as const }]
      : []),
    ...(state.fallbackAvailable
      ? [
          {
            key: "f",
            label: fallbackLabel,
            action: "fallback" as const,
          },
        ]
      : []),
    ...(isSeriesPlayback
      ? [
          {
            key: "a",
            label: state.autoplayPaused ? "resume autoplay" : "pause autoplay",
            action: "toggle-autoplay" as const,
          },
          {
            key: "u",
            label: state.autoskipPaused ? "resume autoskip" : "pause autoskip",
            action: "toggle-autoskip" as const,
          },
          {
            key: "x",
            label: "stop after current",
            action: "stop-after-current" as const,
          },
        ]
      : []),
    { key: "g", label: "settings", action: "settings" },
    { key: "h", label: "history", action: "history" },
    { key: "d", label: "diagnostics", action: "diagnostics" },
    { key: "?", label: "help", action: "help" },
  ];
}

export function formatLoadingProviderLine(
  state: Pick<LoadingShellState, "providerName" | "providerId">,
): string | null {
  const name = state.providerName?.trim();
  const id = state.providerId?.trim();
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id || null;
}

export function buildPlaybackSignalRail(
  state: Pick<LoadingShellState, "qualityLabel" | "downloadStatus" | "subtitleTrack">,
): string[] {
  const lines: string[] = [];
  if (state.qualityLabel?.trim()) {
    const fpsMatch = state.qualityLabel.match(/(\d+)\s*fps\b/i);
    const resolution = state.qualityLabel
      .replace(/\s*[·|]\s*\d+\s*fps\b/gi, "")
      .replace(/\d+\s*fps\b/gi, "")
      .trim();
    if (resolution) {
      lines.push(fpsMatch ? `${resolution} · ${fpsMatch[1]}fps` : resolution);
    } else if (fpsMatch) {
      lines.push(`${fpsMatch[1]}fps`);
    }
  }
  if (state.downloadStatus?.trim()) {
    const speed = state.downloadStatus.replace(/^dl:\s*/i, "").trim();
    if (speed) lines.push(speed.includes("↓") ? speed : `${speed} ↓`);
  }
  if (state.subtitleTrack?.trim()) {
    const track = state.subtitleTrack.trim();
    lines.push(/^sub\b/i.test(track) ? track : `sub ${track}`);
  }
  return lines;
}
