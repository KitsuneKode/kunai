import {
  getModeSwitchTarget,
  type ModeSwitchDirection,
  sessionTargetForMode,
} from "@/domain/session/mode-target";
import {
  ensureSessionProviderMatchesLane,
  formatSessionLaneLabel,
  resolveProviderIdForSessionLane,
  type SessionProviderLaneLookup,
} from "@/domain/session/session-display";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { ShellMode } from "@/domain/types";

export {
  getModeSwitchTarget,
  type ModeSwitchDirection,
  sessionTargetForMode,
} from "@/domain/session/mode-target";

/**
 * A lane switch either lands or reports why not. `getDefaultForMode` throws
 * on an empty lane — without this result the throw escapes the command
 * dispatcher mid-keypress and the user sees the key do nothing.
 */
export type SessionLaneSwitchResult =
  | { readonly switched: true }
  | { readonly switched: false; readonly reason: string };

/** Switch session to a specific catalog lane and clear stale browse/search context. */
export function setSessionLane(
  stateManager: SessionStateManager,
  mode: ShellMode,
  providerRegistry?: SessionProviderLaneLookup,
): SessionLaneSwitchResult {
  const state = stateManager.getState();
  if (state.mode === mode) {
    if (providerRegistry) {
      ensureSessionProviderMatchesLane(stateManager, providerRegistry);
    }
    return { switched: true };
  }
  const configuredTarget = sessionTargetForMode(state, mode);
  let provider = configuredTarget.provider;
  if (providerRegistry) {
    try {
      provider = resolveProviderIdForSessionLane(
        { ...state, mode: configuredTarget.mode, provider: configuredTarget.provider },
        providerRegistry,
      );
    } catch (error) {
      return {
        switched: false,
        reason:
          error instanceof Error
            ? error.message
            : `No providers are available for ${formatSessionLaneLabel(mode)} mode.`,
      };
    }
  }
  stateManager.dispatch({
    type: "SET_MODE",
    mode: configuredTarget.mode,
    provider,
  });
  return { switched: true };
}

export function switchSessionMode(
  stateManager: SessionStateManager,
  providerRegistry?: SessionProviderLaneLookup,
  direction: ModeSwitchDirection = "forward",
): SessionLaneSwitchResult {
  const target = getModeSwitchTarget(stateManager.getState(), direction);
  return setSessionLane(stateManager, target.mode, providerRegistry);
}
