import type { LoadingShellState, ShellStatusTone } from "./types";

export type LoadingShellTimerPolicy = {
  readonly animate: boolean;
  readonly trackElapsed: boolean;
  readonly memoryRefreshMs: number | null;
  readonly runtimeHealthRefreshMs: number | null;
};

export function isPlaybackSupervisionOperation(operation: LoadingShellState["operation"]): boolean {
  return operation === "playing";
}

export function shouldShowLoadingElapsed(
  operation: LoadingShellState["operation"],
  elapsedSeconds: number,
): boolean {
  return !isPlaybackSupervisionOperation(operation) && elapsedSeconds >= 2;
}

export function getLoadingShellTimerPolicy(input: {
  operation: LoadingShellState["operation"];
  memoryPanelVisible?: boolean;
  runtimeHealthVisible?: boolean;
}): LoadingShellTimerPolicy {
  const supervisingPlayback = isPlaybackSupervisionOperation(input.operation);
  return {
    animate: !supervisingPlayback,
    trackElapsed: !supervisingPlayback,
    memoryRefreshMs: input.memoryPanelVisible ? 2_000 : null,
    runtimeHealthRefreshMs: input.runtimeHealthVisible ? 2_000 : null,
  };
}

export function shouldShowPlaybackRuntimeStrip(input: {
  operation: LoadingShellState["operation"];
  memoryPanelVisible: boolean;
  hasMemoryLine: boolean;
  hasRuntimeHealthLine: boolean;
}): boolean {
  return (
    input.operation === "playing" &&
    ((input.memoryPanelVisible && input.hasMemoryLine) || input.hasRuntimeHealthLine)
  );
}

// ── 3-stage loading UX ──────────────────────────────────────────────────────

const STAGE_ORDER: readonly LoadingShellState["stage"][] = [
  "finding-stream",
  "preparing-player",
  "starting-playback",
];

export function resolveStageFromOperation(
  operation: LoadingShellState["operation"],
  explicitStage?: LoadingShellState["stage"],
): LoadingShellState["stage"] {
  if (explicitStage) return explicitStage;
  switch (operation) {
    case "resolving":
      return "finding-stream";
    case "loading":
      return "preparing-player";
    case "playing":
      return "starting-playback";
    default:
      return "finding-stream";
  }
}

export function stageLabel(stage: LoadingShellState["stage"]): string {
  switch (stage) {
    case "finding-stream":
      return "finding stream";
    case "preparing-player":
      return "preparing player";
    case "starting-playback":
      return "starting playback";
    default:
      return "loading";
  }
}

export function stageDescription(stage: LoadingShellState["stage"]): string {
  switch (stage) {
    case "finding-stream":
      return "Resolving title metadata, provider data, direct links, and subtitles.";
    case "preparing-player":
      return "Loading skip timing, building player arguments, and opening IPC socket.";
    case "starting-playback":
      return "Launching mpv, validating stream, and waiting for ready signal.";
    default:
      return "Preparing playback context.";
  }
}

export function renderStageRail(
  activeStage: LoadingShellState["stage"],
  latestIssue: string | null | undefined,
): readonly { label: string; tone: "neutral" | "info" | "success" | "warning" | "error" }[] {
  const issue = normalizeLoadingIssue(latestIssue);
  const activeIndex = activeStage ? STAGE_ORDER.indexOf(activeStage) : -1;
  return STAGE_ORDER.map((stage, index) => {
    const isActive = index === activeIndex;
    const isPast = index < activeIndex;
    let tone: "neutral" | "info" | "success" | "warning" | "error" = isPast
      ? "success"
      : isActive
        ? issue
          ? "warning"
          : "info"
        : "neutral";
    return {
      label: stageLabel(stage),
      tone,
    };
  });
}

export type ProviderResolveWaitPresentation = {
  readonly message: string;
  readonly tone: ShellStatusTone;
  readonly footerTask: string;
};

export function getProviderResolveWaitPresentation(input: {
  readonly elapsedSeconds: number;
  readonly fallbackAvailable?: boolean;
  readonly latestIssue?: string | null;
  readonly stageDetail?: string;
}): ProviderResolveWaitPresentation {
  const fallbackHint = input.fallbackAvailable ? "f fallback · " : "";
  const issue = normalizeLoadingIssue(input.latestIssue);

  if (issue) {
    return {
      message: input.stageDetail ? `${input.stageDetail} · Issue: ${issue}` : `Issue: ${issue}`,
      tone: "warning",
      footerTask: `Playback bootstrap  ·  ${fallbackHint}q / Esc cancel`,
    };
  }

  if (input.elapsedSeconds >= 20) {
    return {
      message: input.stageDetail
        ? `${input.stageDetail} · Provider/CDN may be degraded.`
        : "Provider/CDN may be degraded. Try fallback or open diagnostics.",
      tone: "warning",
      footerTask: `Provider/CDN degraded  ·  ${fallbackHint}Esc cancel · d diagnostics`,
    };
  }

  if (input.elapsedSeconds >= 10) {
    return {
      message: input.stageDetail ?? "Taking longer than expected…",
      tone: "info",
      footerTask: `Playback bootstrap  ·  ${fallbackHint}q / Esc cancel`,
    };
  }

  return {
    message: input.stageDetail ?? "Preparing playback context…",
    tone: "info",
    footerTask: `Playback bootstrap  ·  ${fallbackHint}q / Esc cancel`,
  };
}

export function normalizeLoadingIssue(issue: string | null | undefined): string | null {
  const trimmed = issue?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (
    normalized === "subtitle attached" ||
    normalized === "subtitles attached" ||
    normalized === "subs ready" ||
    normalized === "subtitles ready" ||
    normalized === "recoverable provider failures retry before fallback." ||
    normalized.includes("retry before fallback") ||
    normalized.includes("retrying before fallback") ||
    (normalized.includes("trying ") && normalized.includes(" fallback"))
  ) {
    return null;
  }
  return trimmed;
}

export function normalizeProviderDetail(detail: string | null | undefined): string | null {
  const trimmed = detail?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^provider:\s*/i, "");
}

// ── Progressive disclosure for loading shell ─────────────────────────────

export type LoadingDisclosureState = {
  readonly showProvider: boolean;
  readonly showProgress: boolean;
  readonly showElapsed: boolean;
  readonly showDiagnostics: boolean;
  readonly showIssue: boolean;
  readonly showSubtitleStatus: boolean;
};

/**
 * Returns what information should be visible in the loading shell based on
 * elapsed time. The goal is to start calm and reveal more as the wait extends.
 *
 * Gates:
 * - 0-2s:  stage label + dot matrix only
 * - 2s+:   add provider detail + progress (if available) + subtitle status
 * - 5s+:   add elapsed timer + diagnostics trace + memory
 * - Issue:  immediately surface warning regardless of elapsed time
 */
export function getLoadingDisclosure(
  elapsedSeconds: number,
  hasIssue: boolean,
  hasProgress: boolean,
): LoadingDisclosureState {
  return {
    showProvider: elapsedSeconds >= 2,
    showProgress: hasProgress,
    showElapsed: elapsedSeconds >= 5,
    showDiagnostics: elapsedSeconds >= 5,
    showIssue: hasIssue,
    showSubtitleStatus: elapsedSeconds >= 2,
  };
}

export function getStageAnimationVariant(
  stage: LoadingShellState["stage"],
): "flux-columns" | "echo-ring" | "neon-drift" | "core-spiral" | "pulse-grid" {
  switch (stage) {
    case "finding-stream":
      return "echo-ring";
    case "preparing-player":
      return "neon-drift";
    case "starting-playback":
      return "core-spiral";
    default:
      return "flux-columns";
  }
}
