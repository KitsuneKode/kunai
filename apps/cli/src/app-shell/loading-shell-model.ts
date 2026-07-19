import type { PlaybackStartupStage } from "@/services/playback/playback-startup-timeline";

import { formatChord, KEYBINDINGS, type KeyBinding } from "./keybindings";
import { selectFooterActions } from "./shell-primitives";
import type { FooterAction, LoadingShellState, ShellMode } from "./types";

type LoadingFooterBindingId =
  | "command-palette"
  | "help"
  | "loading-history"
  | "loading-settings"
  | "loading-title-control-menu"
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

const STARTUP_STAGE_COPY: Record<PlaybackStartupStage, string> = {
  "episode-bootstrap-started": "Preparing episode context",
  "timing-fetch-started": "Fetching skip timing",
  "episode-context-ready": "Loading episode metadata",
  "resolve-started": "Resolving provider stream",
  "resolve-complete": "Verifying stream availability",
  "timing-wait-started": "Waiting for skip timing",
  "timing-ready": "Skip timing ready",
  "stream-prepared": "Preparing media for player",
  "media-materialized": "Media ready for playback",
  "player-launch": "Launching player",
  "mpv-process-started": "Starting mpv",
  "ipc-connected": "Connected to player",
  "player-ready": "Player ready",
  "subtitle-attached": "Subtitles attached",
  "first-progress": "Buffering playback",
};

const YOUTUBE_STARTUP_STAGE_COPY: Partial<Record<PlaybackStartupStage, string>> = {
  "episode-bootstrap-started": "Preparing YouTube selection",
  "episode-context-ready": "Loading YouTube metadata",
  "resolve-started": "Resolving YouTube metadata and watch URL",
  "resolve-complete": "YouTube stream options ready",
  "stream-prepared": "Preparing yt-dlp playback arguments",
  "media-materialized": "YouTube watch URL ready for mpv",
  "player-launch": "Launching mpv with yt-dlp",
  "mpv-process-started": "Starting mpv with yt-dlp",
  "player-ready": "Player ready for YouTube playback",
  "first-progress": "Buffering YouTube playback",
};

/** User-facing status line for a playback startup timeline stage. */
export function loadingStageCopy(stage: PlaybackStartupStage, mode?: ShellMode): string {
  if (mode === "youtube") return YOUTUBE_STARTUP_STAGE_COPY[stage] ?? STARTUP_STAGE_COPY[stage];
  return STARTUP_STAGE_COPY[stage];
}

/** Prefer explicit playback detail; otherwise derive honest copy from startup stage. */
export function resolveHonestLoadingStageDetail(input: {
  readonly startupStage: PlaybackStartupStage | null;
  readonly playbackDetail?: string | null;
  readonly mode?: ShellMode;
}): string | undefined {
  const explicit = input.playbackDetail?.trim();
  if (explicit) return explicit;
  if (input.startupStage) return loadingStageCopy(input.startupStage, input.mode);
  return undefined;
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
    footerActionFromBinding("loading-title-control-menu", "menu", bindings),
    // Advertise cancel while bootstrap is abortable (Esc/q already work; footer
    // makes the exit path discoverable and routes through the same quit action).
    ...(state.cancellable
      ? [footerActionFromBinding("player-stop", "quit", bindings, { label: "cancel" })]
      : []),
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
    footerActionFromBinding("loading-settings", "settings", bindings),
    footerActionFromBinding("loading-history", "history", bindings),
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
