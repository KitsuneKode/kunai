import type { SessionState } from "@/domain/session/SessionState";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";

export function getModeSwitchTarget(state: SessionState): {
  mode: "series" | "anime";
  provider: string;
} {
  const mode = state.mode === "anime" ? "series" : "anime";
  return {
    mode,
    provider: mode === "anime" ? state.defaultProviders.anime : state.defaultProviders.series,
  };
}

export function switchSessionMode(stateManager: SessionStateManager): void {
  const target = getModeSwitchTarget(stateManager.getState());
  stateManager.dispatch({
    type: "SET_MODE",
    mode: target.mode,
    provider: target.provider,
  });
}
