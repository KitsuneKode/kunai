import { shellModeToDefaultProviderKey } from "@/domain/provider-lane";
import type { SessionState } from "@/domain/session/SessionState";
import type { ShellMode } from "@/domain/types";

const MODE_CYCLE: readonly ShellMode[] = ["series", "anime", "youtube"];

/** Which way the mode cycle steps: Tab forward, Shift+Tab back. */
export type ModeSwitchDirection = "forward" | "backward";

export function getModeSwitchTarget(
  state: SessionState,
  direction: ModeSwitchDirection = "forward",
): {
  mode: ShellMode;
  provider: string;
} {
  const currentIndex = MODE_CYCLE.indexOf(state.mode);
  const step = direction === "backward" ? -1 : 1;
  // + length keeps the backward step positive before the modulo.
  const nextIndex = (currentIndex + step + MODE_CYCLE.length) % MODE_CYCLE.length;
  const nextMode = MODE_CYCLE[nextIndex] ?? "series";
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
