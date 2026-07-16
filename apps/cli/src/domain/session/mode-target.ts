import { shellModeToDefaultProviderKey } from "@/domain/provider-lane";
import type { SessionState } from "@/domain/session/SessionState";
import type { ShellMode } from "@/domain/types";

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
