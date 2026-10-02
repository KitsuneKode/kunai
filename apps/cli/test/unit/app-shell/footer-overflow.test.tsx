import { describe, expect, test } from "bun:test";

import { Footer } from "@/app-shell/shell-primitives";
import type { FooterAction } from "@/app-shell/types";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const MANY_ACTIONS: readonly FooterAction[] = [
  { key: "enter", label: "play", action: "search", primary: true },
  { key: "n", label: "next", action: "next" },
  { key: "p", label: "previous", action: "previous" },
  { key: "a", label: "autoplay", action: "toggle-autoplay" },
  { key: "u", label: "autoskip", action: "toggle-autoskip" },
  { key: "e", label: "episodes", action: "pick-episode" },
  { key: "/", label: "commands", action: "command-mode" },
];

describe("Footer overflow count", () => {
  test("names the hidden action count when the cap drops real keys", () => {
    // columns=120 → detailed mode caps at 3 non-command hints + commands tail:
    // 4 shown of 7 enabled, so +3 tells the user more keys live behind /.
    const frame = captureFrame(
      <Footer taskLabel="Playback" actions={MANY_ACTIONS} mode="detailed" />,
      { columns: 120 },
    );
    expect(frame).toContain("+3");
  });

  test("prints no count when every enabled action fits", () => {
    const actions: readonly FooterAction[] = [
      { key: "enter", label: "play", action: "search", primary: true },
      { key: "/", label: "commands", action: "command-mode" },
    ];
    const frame = captureFrame(<Footer taskLabel="Search" actions={actions} mode="detailed" />, {
      columns: 120,
    });
    expect(frame).not.toContain("+");
    expect(frame).toContain("play");
  });

  test("disabled actions don't count toward the overflow", () => {
    const actions: readonly FooterAction[] = [
      { key: "enter", label: "play", action: "search", primary: true },
      { key: "n", label: "next", action: "next" },
      { key: "p", label: "previous", action: "previous" },
      // Dropped before the cap — it was never visible and never will be.
      { key: "a", label: "autoplay", action: "toggle-autoplay", disabled: true },
      { key: "/", label: "commands", action: "command-mode" },
    ];
    const frame = captureFrame(<Footer taskLabel="Playback" actions={actions} mode="detailed" />, {
      columns: 120,
    });
    expect(frame).not.toContain("+");
  });
});
