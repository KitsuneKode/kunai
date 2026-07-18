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

function emptyKey() {
  return {};
}

describe("resolvePlaybackShellInput", () => {
  test("playing trouble routes r/Shift+F/o/d without onCommandAction gate", () => {
    const ctx = {
      operation: "playing" as const,
      cancellable: false,
      fallbackAvailable: true,
      canOpenSourcePicker: true,
      recoveryViewActive: false,
      playbackTroubleActive: true,
      handlers: handlers({ onCommandAction: undefined }),
    };
    expect(resolvePlaybackShellInput("r", emptyKey(), ctx)?.kind).toBe("recover");
    expect(resolvePlaybackShellInput("F", { shift: true }, ctx)?.kind).toBe("fallback");
    // A bare lowercase f must never switch providers — mispress protection.
    expect(resolvePlaybackShellInput("f", emptyKey(), ctx)).toBeNull();
    expect(resolvePlaybackShellInput("o", emptyKey(), ctx)?.kind).toBe("pick-source");
    expect(resolvePlaybackShellInput("d", emptyKey(), ctx)).toBeNull();
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
    expect(resolvePlaybackShellInput("d", emptyKey(), ctx)).toEqual({
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
      handlers: handlers({ onPickQuality: () => {} }),
    };
    expect(resolvePlaybackShellInput("e", emptyKey(), ctx)?.kind).toBe("pick-episode");
    expect(resolvePlaybackShellInput("a", emptyKey(), ctx)?.kind).toBe("toggle-autoplay");
    expect(resolvePlaybackShellInput("q", emptyKey(), ctx)?.kind).toBe("stop");
    expect(resolvePlaybackShellInput("r", emptyKey(), ctx)?.kind).toBe("recover");
    expect(resolvePlaybackShellInput("k", emptyKey(), ctx)?.kind).toBe("pick-quality");
    expect(resolvePlaybackShellInput("v", emptyKey(), ctx)?.kind).toBe("pick-quality");
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
    expect(resolvePlaybackShellInput("g", emptyKey(), ctx)).toEqual({
      kind: "shell-action",
      action: "settings",
    });
    expect(resolvePlaybackShellInput("?", emptyKey(), ctx)).toEqual({
      kind: "shell-action",
      action: "help",
    });
    expect(resolvePlaybackShellInput("q", emptyKey(), ctx)?.kind).toBe("cancel");
    expect(resolvePlaybackShellInput("F", { shift: true }, ctx)?.kind).toBe("fallback");
    expect(resolvePlaybackShellInput("f", emptyKey(), ctx)).toBeNull();
  });

  test("bootstrap q is a no-op cancel when surface is not cancellable", () => {
    const ctx = {
      operation: "loading" as const,
      cancellable: false,
      fallbackAvailable: false,
      canOpenSourcePicker: false,
      recoveryViewActive: false,
      playbackTroubleActive: false,
      handlers: handlers({ onCancel: () => {} }),
    };
    expect(resolvePlaybackShellInput("q", emptyKey(), ctx)).toBeNull();
  });

  test("applyPlaybackShellInputEffect cancel invokes onCancel", () => {
    let cancelled = false;
    applyPlaybackShellInputEffect(
      { kind: "cancel" },
      handlers({
        onCancel: () => {
          cancelled = true;
        },
      }),
    );
    expect(cancelled).toBe(true);
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
