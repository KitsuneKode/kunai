import { describe, expect, spyOn, test } from "bun:test";

import { COMMAND_CONTEXTS } from "@/app-shell/commands";
import { LoadingShell } from "@/app-shell/loading-shell";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

function mountPlayback(operation: "playing" | "resolving" = "playing") {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  const handle = render(
    <LoadingShell
      state={{
        title: "Sintel",
        operation,
        cancellable: operation === "resolving",
        commands: fallbackCommandState(COMMAND_CONTEXTS.activePlayback),
        onCommandAction: () => undefined,
      }}
      onStop={record("stop")}
      onNext={record("next")}
      onPrevious={record("previous")}
      onToggleAutoplay={record("autoplay")}
      onToggleAutoskip={record("autoskip")}
      onCancel={record("cancel")}
    />,
    { columns: 100, rows: 40 },
  );
  // A terminal delivers one chunk per keystroke; a multi-character chunk is a paste to Ink.
  const type = (text: string) => {
    for (const key of text) handle.stdin.enqueue(key);
  };
  return { calls, handle, type };
}

function pressEscape(handle: ReturnType<typeof render>): void {
  // Ink schedules a lone Escape to disambiguate terminal sequences. Deliver
  // that callback explicitly: this regression must not depend on wall time.
  const schedule = globalThis.setTimeout;
  let flush: (() => void) | undefined;
  const timerSpy = spyOn(globalThis, "setTimeout").mockImplementationOnce(
    Object.assign(
      (...args: Parameters<typeof schedule>) => {
        const timer = schedule(...args);
        clearTimeout(timer);
        const [callback, , ...callbackArgs] = args;
        flush = () => callback(...callbackArgs);
        return timer;
      },
      { __promisify__: schedule.__promisify__ },
    ),
  );
  try {
    handle.stdin.enqueue("\u001b");
    expect(flush).toBeDefined();
    act(() => flush?.());
  } finally {
    timerSpy.mockRestore();
  }
}

describe("playback command palette", () => {
  test("a playback key stops playback while the palette is closed", () => {
    const { calls, type, handle } = mountPlayback();
    type("q");
    expect(calls).toEqual(["stop"]);
    handle.unmount();
  });

  test("typing a command name does not fire playback keys behind the palette", () => {
    const { calls, type, handle } = mountPlayback();
    type("/");
    expect(stripAnsi(handle.lastFrame())).toContain("type a command");

    // q stop, n next, p previous, a autoplay, u autoskip: every one is a live key outside the palette.
    type("quitnpau");

    expect(calls).toEqual([]);
    expect(stripAnsi(handle.lastFrame())).toContain("quitnpau");
    handle.unmount();
  });

  test("closing the palette hands the keys back", () => {
    const { calls, type, handle } = mountPlayback();
    try {
      type("/");
      type("q");
      pressEscape(handle);
      expect(calls).toEqual([]);
      type("q");
      expect(calls).toEqual(["stop"]);
    } finally {
      handle.unmount();
    }
  });

  test("Escape closes a resolving palette before cancelling the resolve", () => {
    const { calls, type, handle } = mountPlayback("resolving");
    try {
      type("/");
      pressEscape(handle);
      expect(calls).toEqual([]);
      pressEscape(handle);
      expect(calls).toEqual(["cancel"]);
    } finally {
      handle.unmount();
    }
  });
});
