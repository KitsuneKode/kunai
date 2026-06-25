import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { ShellMode } from "@/domain/types";
import { shellModeToDefaultProviderKey } from "@/services/providers/provider-lane";

const MODE_CYCLE: readonly ShellMode[] = ["series", "anime", "youtube"];

export function getModeSwitchTarget(state: SessionState): {
  mode: ShellMode;
  provider: string;
} {
  const currentIndex = MODE_CYCLE.indexOf(state.mode);
  const nextMode = MODE_CYCLE[(currentIndex + 1) % MODE_CYCLE.length] ?? "series";
  return sessionTargetForMode(state, nextMode);
}

export function sessionTargetForMode(
  state: SessionState,
  mode: ShellMode,
): { mode: ShellMode; provider: string } {
  const providerKey = shellModeToDefaultProviderKey(mode);
  return {
    mode,
    provider: state.defaultProviders[providerKey],
  };
}

/** Switch session to a specific catalog lane and clear stale browse/search context. */
export function setSessionLane(stateManager: SessionStateManager, mode: ShellMode): void {
  const state = stateManager.getState();
  if (state.mode === mode) return;
  const target = sessionTargetForMode(state, mode);
  stateManager.dispatch({
    type: "SET_MODE",
    mode: target.mode,
    provider: target.provider,
  });
}

export function switchSessionMode(stateManager: SessionStateManager): void {
  const target = getModeSwitchTarget(stateManager.getState());
  setSessionLane(stateManager, target.mode);
}
