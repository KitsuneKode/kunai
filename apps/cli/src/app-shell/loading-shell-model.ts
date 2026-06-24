import { formatChord, KEYBINDINGS, type KeyBinding } from "./keybindings";
import { selectFooterActions } from "./shell-primitives";
import type { FooterAction, LoadingShellState } from "./types";

type LoadingFooterBindingId =
  | "command-palette"
  | "help"
  | "player-autoplay"
  | "player-autoskip"
  | "player-diagnostics"
  | "player-episode"
  | "player-fallback"
  | "player-next"
  | "player-previous"
  | "player-source"
  | "player-stop"
  | "player-stop-after-current";

function footerActionFromBinding(
  id: LoadingFooterBindingId,
  action: FooterAction["action"],
  bindings: readonly KeyBinding[],
  options: {
    readonly label?: string;
    readonly primary?: boolean;
    readonly disabled?: boolean;
  } = {},
): FooterAction {
  const binding = bindings.find((candidate) => candidate.id === id);
  return {
    key: binding ? formatChord(binding.chord).toLowerCase() : "",
    label: options.label ?? binding?.hintLabel ?? binding?.label ?? String(action),
    action,
    primary: options.primary,
    disabled: options.disabled,
  };
}

export function buildLoadingFooterActions(state: LoadingShellState): readonly FooterAction[] {
  const bindings = KEYBINDINGS;
  const fallbackLabel = state.fallbackProviderName
    ? `fallback ${state.fallbackProviderName}`
    : "fallback";
  const isSeriesPlayback = Boolean(
    state.isSeriesPlayback || state.hasNextEpisode || state.hasPreviousEpisode,
  );

  if (state.operation === "playing") {
    const playingFooterActions: readonly FooterAction[] = [
      footerActionFromBinding("command-palette", "command-mode", bindings, { primary: true }),
      ...(state.hasNextEpisode ? [footerActionFromBinding("player-next", "next", bindings)] : []),
      ...(state.hasPreviousEpisode
        ? [footerActionFromBinding("player-previous", "previous", bindings)]
        : []),
      ...(isSeriesPlayback
        ? [
            footerActionFromBinding("player-episode", "pick-episode", bindings),
            footerActionFromBinding("player-autoplay", "toggle-autoplay", bindings, {
              label: state.autoplayPaused ? "resume autoplay" : "pause autoplay",
            }),
          ]
        : []),
      footerActionFromBinding("player-source", "source", bindings),
      footerActionFromBinding("player-stop", "quit", bindings, { label: "stop" }),
    ];
    return selectFooterActions(playingFooterActions, state.footerMode ?? "detailed");
  }

  return [
    footerActionFromBinding("command-palette", "command-mode", bindings),
    ...(state.hasStreamCandidates
      ? [footerActionFromBinding("player-source", "source", bindings)]
      : []),
    ...(state.fallbackAvailable
      ? [
          footerActionFromBinding("player-fallback", "fallback", bindings, {
            label: fallbackLabel,
          }),
        ]
      : []),
    ...(isSeriesPlayback
      ? [
          footerActionFromBinding("player-autoplay", "toggle-autoplay", bindings, {
            label: state.autoplayPaused ? "resume autoplay" : "pause autoplay",
          }),
          footerActionFromBinding("player-autoskip", "toggle-autoskip", bindings, {
            label: state.autoskipPaused ? "resume autoskip" : "pause autoskip",
          }),
          footerActionFromBinding("player-stop-after-current", "stop-after-current", bindings, {
            label: "stop after current",
          }),
        ]
      : []),
    { key: "g", label: "settings", action: "settings" },
    { key: "h", label: "history", action: "history" },
    footerActionFromBinding("player-diagnostics", "diagnostics", bindings),
    footerActionFromBinding("help", "help", bindings),
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
