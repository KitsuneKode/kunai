import type { LoadingShellStage, LoadingShellState } from "@/app-shell/types";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import {
  formatStartupPhaseBreakdown,
  summarizeStartupPhases,
  type PlaybackStartupStage,
  type PlaybackStartupTimelineSnapshot,
} from "@/services/playback/playback-startup-timeline";

export type BootstrapShellStage =
  | "episode-context"
  | "provider-resolve"
  | "stream-prepare"
  | "player-launch"
  | "buffering"
  | "playing";

export type PlaybackBootstrapPresentation = {
  readonly operation: LoadingShellState["operation"];
  readonly stage: LoadingShellStage;
  readonly stageDetail?: string;
  readonly dominantPhaseLabel?: string;
};

const STARTUP_STAGE_ORDER: readonly PlaybackStartupStage[] = [
  "episode-bootstrap-started",
  "timing-fetch-started",
  "episode-context-ready",
  "resolve-started",
  "resolve-complete",
  "timing-wait-started",
  "timing-ready",
  "stream-prepared",
  "media-materialized",
  "player-launch",
  "mpv-process-started",
  "ipc-connected",
  "player-ready",
  "subtitle-attached",
  "first-progress",
];

export function latestPlaybackStartupStage(
  recentEvents: readonly DiagnosticEvent[],
): PlaybackStartupStage | null {
  let latest: PlaybackStartupStage | null = null;
  let latestIndex = -1;
  for (const event of recentEvents) {
    if (event.operation !== "playback.startup.timeline") continue;
    const stage = event.context?.stage;
    if (typeof stage !== "string") continue;
    const index = STARTUP_STAGE_ORDER.indexOf(stage as PlaybackStartupStage);
    if (index > latestIndex) {
      latestIndex = index;
      latest = stage as PlaybackStartupStage;
    }
  }
  return latest;
}

export function mapStartupStageToLoadingStage(
  startupStage: PlaybackStartupStage | null,
  playbackStatus: string,
): LoadingShellStage {
  if (
    playbackStatus === "playing" ||
    playbackStatus === "buffering" ||
    playbackStatus === "seeking" ||
    playbackStatus === "stalled"
  ) {
    return playbackStatus === "buffering" || playbackStatus === "seeking"
      ? "starting-playback"
      : "starting-playback";
  }

  switch (startupStage) {
    case "resolve-started":
    case "resolve-complete":
      return "preparing-provider";
    case "timing-wait-started":
    case "timing-ready":
    case "stream-prepared":
    case "media-materialized":
      return "preparing-player";
    case "player-launch":
    case "mpv-process-started":
    case "ipc-connected":
    case "player-ready":
    case "subtitle-attached":
      return "starting-playback";
    case "first-progress":
      return "starting-playback";
    case "episode-bootstrap-started":
    case "timing-fetch-started":
    case "episode-context-ready":
    default:
      return playbackStatus === "loading" ? "preparing-provider" : "finding-stream";
  }
}

function dominantPhaseLabelFromEvents(
  recentEvents: readonly DiagnosticEvent[],
): string | undefined {
  const phaseEvent = [...recentEvents]
    .reverse()
    .find((event) => event.operation === "playback.startup.phases");
  if (!phaseEvent?.context) return undefined;
  const breakdown = phaseEvent.context.breakdown;
  if (typeof breakdown === "string") return breakdown;
  const dominant = phaseEvent.context.dominant;
  if (typeof dominant !== "string") return undefined;
  const snapshot = phaseEvent.context.timeline as PlaybackStartupTimelineSnapshot | undefined;
  if (snapshot) {
    const phases = summarizeStartupPhases(snapshot);
    if (phases) return formatStartupPhaseBreakdown(phases);
  }
  return `dominant: ${dominant}`;
}

export function buildPlaybackBootstrapPresentation(input: {
  readonly playbackStatus: string;
  readonly playbackDetail?: string | null;
  readonly recentEvents: readonly DiagnosticEvent[];
}): PlaybackBootstrapPresentation {
  const startupStage = latestPlaybackStartupStage(input.recentEvents);
  const isActivePlayback =
    input.playbackStatus === "playing" ||
    input.playbackStatus === "buffering" ||
    input.playbackStatus === "seeking" ||
    input.playbackStatus === "stalled";

  const operation: LoadingShellState["operation"] = isActivePlayback
    ? "playing"
    : input.playbackStatus === "loading"
      ? "loading"
      : "resolving";

  const stage = mapStartupStageToLoadingStage(startupStage, input.playbackStatus);
  const dominantPhaseLabel = dominantPhaseLabelFromEvents(input.recentEvents);

  return {
    operation,
    stage,
    stageDetail: input.playbackDetail?.trim() || undefined,
    dominantPhaseLabel,
  };
}

export function formatBootstrapInventorySummary(
  stream: {
    readonly providerResolveResult?: {
      readonly streams: readonly { readonly qualityLabel?: string }[];
      readonly subtitles: readonly unknown[];
      readonly sources?: readonly { readonly label?: string }[];
    } | null;
  } | null,
): string | null {
  const result = stream?.providerResolveResult;
  if (!result) return null;
  const sourceLabel = result.sources?.find((s) => s.label)?.label ?? "source";
  const qualities = [
    ...new Set(
      result.streams.map((s) => s.qualityLabel?.trim()).filter((q): q is string => Boolean(q)),
    ),
  ];
  const qualityPart =
    qualities.length > 0 ? qualities.slice(0, 3).join("/") : `${result.streams.length} streams`;
  const subPart =
    result.subtitles.length > 0
      ? `${result.subtitles.length} sub${result.subtitles.length === 1 ? "" : "s"}`
      : "no subs";
  return `${sourceLabel} · ${qualityPart} · ${subPart}`;
}
