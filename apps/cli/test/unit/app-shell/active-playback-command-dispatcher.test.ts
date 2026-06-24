import { describe, expect, test } from "bun:test";

import {
  dispatchActivePlaybackCommand,
  type ActivePlaybackCommandDispatchDeps,
} from "@/app-shell/active-playback-command-dispatcher";
import type { ShellAction } from "@/app-shell/types";

describe("dispatchActivePlaybackCommand", () => {
  test("fallback cancels active work before asking player control to fallback", async () => {
    const calls: string[] = [];
    const deps = createDeps(calls, {
      workControl: {
        cancelActive: (reason) => {
          calls.push(`cancel:${reason}`);
          return true;
        },
      },
    });

    await dispatchActivePlaybackCommand("fallback", {
      deps,
      canGoNext: false,
      canGoPrevious: false,
      canToggleAutoplay: false,
    });

    expect(calls).toEqual(["cancel:playback-loading-command-fallback"]);
  });

  test("fallback asks player control when no active work was cancelled", async () => {
    const calls: string[] = [];
    const deps = createDeps(calls, {
      workControl: {
        cancelActive: (reason) => {
          calls.push(`cancel:${reason}`);
          return false;
        },
      },
    });

    await dispatchActivePlaybackCommand("fallback", {
      deps,
      canGoNext: false,
      canGoPrevious: false,
      canToggleAutoplay: false,
    });

    expect(calls).toEqual([
      "cancel:playback-loading-command-fallback",
      "fallback:playback-loading-command-fallback",
    ]);
  });

  test("provider/source/quality/audio/subtitle commands share the stream selection picker seam", async () => {
    const calls: string[] = [];
    const deps = createDeps(calls);

    for (const action of ["provider", "source", "quality", "audio", "subtitle"] as const) {
      await dispatchActivePlaybackCommand(action, {
        deps,
        canGoNext: false,
        canGoPrevious: false,
        canToggleAutoplay: false,
      });
    }

    expect(calls).toEqual([
      "stream-picker:provider:playback-loading-command-provider",
      "stream-picker:source:playback-loading-command-source",
      "stream-picker:quality:playback-loading-command-quality",
      "stream-picker:audio:playback-loading-command-audio",
      "stream-picker:subtitle:playback-loading-command-subtitle",
    ]);
  });

  test("disabled next command is ignored before player control", async () => {
    const calls: string[] = [];
    const deps = createDeps(calls);

    const result = await dispatchActivePlaybackCommand("next", {
      deps,
      canGoNext: false,
      canGoPrevious: false,
      canToggleAutoplay: false,
    });

    expect(result).toBe("ignored");
    expect(calls).toEqual([]);
  });

  test("enabled next previous and quit commands delegate to player control", async () => {
    const calls: string[] = [];
    const deps = createDeps(calls);

    await dispatchActivePlaybackCommand("next", {
      deps,
      canGoNext: true,
      canGoPrevious: false,
      canToggleAutoplay: false,
    });
    await dispatchActivePlaybackCommand("previous", {
      deps,
      canGoNext: false,
      canGoPrevious: true,
      canToggleAutoplay: false,
    });
    await dispatchActivePlaybackCommand("quit", {
      deps,
      canGoNext: false,
      canGoPrevious: false,
      canToggleAutoplay: false,
    });

    expect(calls).toEqual([
      "next:playback-loading-command-next",
      "previous:playback-loading-command-previous",
      "stop:playback-loading-command-stop",
    ]);
  });
});

function createDeps(
  calls: string[],
  overrides: Partial<ActivePlaybackCommandDispatchDeps> = {},
): ActivePlaybackCommandDispatchDeps {
  let state = {
    autoplaySessionPaused: false,
    autoskipSessionPaused: false,
    stopAfterCurrent: false,
  };
  return {
    playerControl: {
      nextCurrentPlayback: async (reason) => {
        calls.push(`next:${reason}`);
      },
      previousCurrentPlayback: async (reason) => {
        calls.push(`previous:${reason}`);
      },
      returnToSearchFromPlayback: async (reason) => {
        calls.push(`search:${reason}`);
      },
      recoverCurrentPlayback: async (reason) => {
        calls.push(`recover:${reason}`);
      },
      recomputeCurrentPlayback: async (reason) => {
        calls.push(`recompute:${reason}`);
      },
      fallbackCurrentPlayback: async (reason) => {
        calls.push(`fallback:${reason}`);
      },
      switchEpisodePlaybackSource: async (kind, reason) => {
        calls.push(`source:${kind}:${reason}`);
      },
      stopCurrentPlayback: async (reason) => {
        calls.push(`stop:${reason}`);
      },
    },
    workControl: {
      cancelActive: (reason) => {
        calls.push(`cancel:${reason}`);
        return false;
      },
    },
    stateManager: {
      getState: () => state,
      dispatch: (event) => {
        calls.push(`dispatch:${event.type}`);
        state =
          event.type === "SET_SESSION_AUTOPLAY_PAUSED"
            ? { ...state, autoplaySessionPaused: event.paused }
            : event.type === "SET_SESSION_AUTOSKIP_PAUSED"
              ? { ...state, autoskipSessionPaused: event.paused }
              : event.type === "SET_SESSION_STOP_AFTER_CURRENT"
                ? { ...state, stopAfterCurrent: event.enabled }
                : state;
      },
    },
    openStreamSelectionPicker: async (_deps, action, reason) => {
      calls.push(`stream-picker:${action}:${reason}`);
    },
    openEpisodePicker: async (_deps, reason) => {
      calls.push(`episode-picker:${reason}`);
    },
    enqueueCurrentPlaybackDownload: async (_deps, reason) => {
      calls.push(`download:${reason}`);
    },
    switchSessionMode: () => {
      calls.push("switch-mode");
    },
    routeSearchShellAction: async (action: ShellAction) => {
      calls.push(`route:${action}`);
      return "handled";
    },
    setExiting: (value) => {
      calls.push(`exiting:${value}`);
    },
    ...overrides,
  };
}
