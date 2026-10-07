import { describe, expect, test } from "bun:test";

import { COMMAND_CONTEXTS } from "@/app-shell/commands";
import { LoadingShell } from "@/app-shell/loading-shell";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

function mountPlayback() {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  const handle = render(
    <LoadingShell
      state={{
        title: "Sintel",
        operation: "playing",
        commands: fallbackCommandState(COMMAND_CONTEXTS.activePlayback),
        onCommandAction: () => undefined,
      }}
      onStop={record("stop")}
      onNext={record("next")}
      onPrevious={record("previous")}
      onToggleAutoplay={record("autoplay")}
      onToggleAutoskip={record("autoskip")}
    />,
    { columns: 100, rows: 40 },
  );
  // A terminal delivers one chunk per keystroke; a multi-character chunk is a paste to Ink.
  const type = (text: string) => {
    for (const key of text) handle.stdin.enqueue(key);
  };
  return { calls, handle, type };
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

  test("closing the palette hands the keys back", async () => {
    const { calls, type, handle } = mountPlayback();
    type("/");
    type("q");
    // Ink defers a lone ESC briefly to tell it apart from an escape sequence.
    await act(async () => {
      handle.stdin.enqueue("\u001b");
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(calls).toEqual([]);

    type("q");
    expect(calls).toEqual(["stop"]);
    handle.unmount();
  });
});
