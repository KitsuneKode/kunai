import type { LoadingShellState } from "./types";

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
  return !isPlaybackSupervisionOperation(operation) && elapsedSeconds >= 10;
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
