import { getModeSwitchTarget, sessionTargetForMode } from "@/domain/session/mode-target";
import {
  ensureSessionProviderMatchesLane,
  resolveProviderIdForSessionLane,
  type SessionProviderLaneLookup,
} from "@/domain/session/session-display";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { ShellMode } from "@/domain/types";

export { getModeSwitchTarget, sessionTargetForMode } from "@/domain/session/mode-target";

/** Switch session to a specific catalog lane and clear stale browse/search context. */
export function setSessionLane(
  stateManager: SessionStateManager,
  mode: ShellMode,
  providerRegistry?: SessionProviderLaneLookup,
): void {
  const state = stateManager.getState();
  if (state.mode === mode) {
    if (providerRegistry) {
      ensureSessionProviderMatchesLane(stateManager, providerRegistry);
    }
    return;
  }
  const configuredTarget = sessionTargetForMode(state, mode);
  const provider = providerRegistry
    ? resolveProviderIdForSessionLane(
        { ...state, mode: configuredTarget.mode, provider: configuredTarget.provider },
        providerRegistry,
      )
    : configuredTarget.provider;
  stateManager.dispatch({
    type: "SET_MODE",
    mode: configuredTarget.mode,
    provider,
  });
}

export function switchSessionMode(
  stateManager: SessionStateManager,
  providerRegistry?: SessionProviderLaneLookup,
): void {
  const target = getModeSwitchTarget(stateManager.getState());
  setSessionLane(stateManager, target.mode, providerRegistry);
}
