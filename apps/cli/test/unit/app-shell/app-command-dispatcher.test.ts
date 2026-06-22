import { describe, expect, test } from "bun:test";

import type { ActivePlaybackCommandDispatchDeps } from "@/app-shell/active-playback-command-dispatcher";
import { dispatchAppCommand } from "@/app-shell/app-command-dispatcher";
import type { ShellAction } from "@/app-shell/types";

describe("dispatchAppCommand", () => {
  test("routes active playback commands through the shared app dispatcher seam", async () => {
    const calls: string[] = [];

    const result = await dispatchAppCommand({
      action: "fallback",
      source: "hotkey",
      activePlayback: {
        deps: createDeps(calls),
        canGoNext: false,
        canGoPrevious: false,
        canToggleAutoplay: false,
      },
    });

    expect(result).toEqual({
      status: "handled",
      surface: "active-playback",
      reason: undefined,
    });
    expect(calls).toEqual([
      "cancel:playback-loading-command-fallback",
      "fallback:playback-loading-command-fallback",
    ]);
  });

  test("returns a visible reason when an active playback command is disabled", async () => {
    const result = await dispatchAppCommand({
      action: "next",
      source: "hotkey",
      activePlayback: {
        deps: createDeps([]),
        canGoNext: false,
        canGoPrevious: false,
        canToggleAutoplay: false,
      },
    });

    expect(result).toEqual({
      status: "ignored",
      surface: "active-playback",
      reason: "No next episode available",
    });
  });
});

function createDeps(calls: string[]): ActivePlaybackCommandDispatchDeps {
  return {
    playerControl: {
      nextCurrentPlayback: async (reason) => calls.push(`next:${reason}`),
      previousCurrentPlayback: async (reason) => calls.push(`previous:${reason}`),
      returnToSearchFromPlayback: async (reason) => calls.push(`search:${reason}`),
      recoverCurrentPlayback: async (reason) => calls.push(`recover:${reason}`),
      recomputeCurrentPlayback: async (reason) => calls.push(`recompute:${reason}`),
      fallbackCurrentPlayback: async (reason) => calls.push(`fallback:${reason}`),
      stopCurrentPlayback: async (reason) => calls.push(`stop:${reason}`),
    },
    workControl: {
      cancelActive: (reason) => {
        calls.push(`cancel:${reason}`);
        return false;
      },
    },
    stateManager: {
      getState: () => ({
        autoplaySessionPaused: false,
        autoskipSessionPaused: false,
        stopAfterCurrent: false,
      }),
      dispatch: (event) => calls.push(`dispatch:${event.type}`),
    },
    openStreamSelectionPicker: async (_deps, action, reason) =>
      calls.push(`stream-picker:${action}:${reason}`),
    openEpisodePicker: async (_deps, reason) => calls.push(`episode-picker:${reason}`),
    enqueueCurrentPlaybackDownload: async (_deps, reason) => calls.push(`download:${reason}`),
    switchSessionMode: () => calls.push("switch-mode"),
    routeSearchShellAction: async (action: ShellAction) => {
      calls.push(`route:${action}`);
      return "handled";
    },
    setExiting: (value) => calls.push(`exiting:${value}`),
  };
}
