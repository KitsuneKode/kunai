import { describe, expect, test } from "bun:test";

import {
  applyPlaybackShellInputEffect,
  resolvePlaybackShellInput,
  type PlaybackShellInputHandlers,
} from "@/app-shell/playback-shell-input";

function handlers(overrides: Partial<PlaybackShellInputHandlers> = {}): PlaybackShellInputHandlers {
  return {
    onRecover: () => {},
    onFallback: () => {},
    onPickSource: () => {},
    onStop: () => {},
    onNext: () => {},
    onPrevious: () => {},
    onPickEpisode: () => {},
    onToggleAutoplay: () => {},
    onCommandAction: () => {},
    ...overrides,
  };
}

describe("resolvePlaybackShellInput", () => {
  test("playing trouble routes r/f/o/d without onCommandAction gate", () => {
    const ctx = {
      operation: "playing" as const,
      cancellable: false,
      fallbackAvailable: true,
      canOpenSourcePicker: true,
      recoveryViewActive: false,
      playbackTroubleActive: true,
      handlers: handlers({ onCommandAction: undefined }),
    };
    expect(resolvePlaybackShellInput("r", ctx)?.kind).toBe("recover");
    expect(resolvePlaybackShellInput("f", ctx)?.kind).toBe("fallback");
    expect(resolvePlaybackShellInput("o", ctx)?.kind).toBe("pick-source");
    expect(resolvePlaybackShellInput("d", ctx)).toBeNull();
  });

  test("playing trouble diagnostics uses onCommandAction when present", () => {
    const ctx = {
      operation: "playing" as const,
      cancellable: false,
      fallbackAvailable: true,
      canOpenSourcePicker: true,
      recoveryViewActive: false,
      playbackTroubleActive: true,
      handlers: handlers(),
    };
    expect(resolvePlaybackShellInput("d", ctx)).toEqual({
      kind: "shell-action",
      action: "diagnostics",
    });
  });

  test("playing routes episode and autoplay keys while footer would be active", () => {
    const ctx = {
      operation: "playing" as const,
      cancellable: false,
      fallbackAvailable: false,
      canOpenSourcePicker: true,
      recoveryViewActive: false,
      playbackTroubleActive: false,
      handlers: handlers(),
    };
    expect(resolvePlaybackShellInput("e", ctx)?.kind).toBe("pick-episode");
    expect(resolvePlaybackShellInput("a", ctx)?.kind).toBe("toggle-autoplay");
    expect(resolvePlaybackShellInput("q", ctx)?.kind).toBe("stop");
    expect(resolvePlaybackShellInput("r", ctx)?.kind).toBe("recover");
  });

  test("bootstrap footer keys resolve before playback starts", () => {
    const ctx = {
      operation: "loading" as const,
      cancellable: true,
      fallbackAvailable: true,
      canOpenSourcePicker: true,
      recoveryViewActive: false,
      playbackTroubleActive: false,
      handlers: handlers({ onCancel: () => {} }),
    };
    expect(resolvePlaybackShellInput("g", ctx)).toEqual({
      kind: "shell-action",
      action: "settings",
    });
    expect(resolvePlaybackShellInput("?", ctx)).toEqual({
      kind: "shell-action",
      action: "help",
    });
    expect(resolvePlaybackShellInput("q", ctx)?.kind).toBe("cancel");
  });

  test("applyPlaybackShellInputEffect dispatches shell actions", () => {
    const seen: string[] = [];
    applyPlaybackShellInputEffect(
      { kind: "shell-action", action: "diagnostics" },
      handlers({
        onCommandAction: (action) => seen.push(action),
      }),
    );
    expect(seen).toEqual(["diagnostics"]);
  });
});
