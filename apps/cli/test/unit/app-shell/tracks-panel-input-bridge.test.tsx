import { describe, expect, test } from "bun:test";

import type { ResolvedAppCommand } from "@/app-shell/commands";
import { useShellInput } from "@/app-shell/shell-command-input";
import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "@/app-shell/tracks-panel-nav";
import { Text, useInput } from "ink";
import React, { useReducer } from "react";

import { render } from "../../harness/render-capture";

/**
 * Bridge test for tracks-panel left/right routing. It mirrors the PRODUCTION
 * wiring in root-overlay-shell.tsx: command mode comes from `useShellInput`, and a
 * separate always-mounted `useInput` routes arrows to `tracksPanelNavReducer` but
 * first bails with `if (commandMode) return`. This locks two contracts:
 *   • →/← reach the reducer (right enters options, left exits) through real input
 *     delivery, not just the pure unit test.
 *   • While the command palette is open, arrows are correctly withheld from the
 *     panel — so a stale command-mode branch (the bug class the useShellInput
 *     disabled-reset fixed) would be caught here as arrows that stop working.
 */

const COMMANDS: readonly ResolvedAppCommand[] = [
  { id: "next", label: "Next", aliases: [], description: "Play next", enabled: true },
];

const NAV_CTX = { sectionCount: 3, optionCount: 4 } as const;

function TracksSurface({ onPane }: { onPane: (pane: string) => void }) {
  const [nav, dispatchNav] = useReducer(
    (state: TracksNavState, event: Parameters<typeof tracksPanelNavReducer>[1]) =>
      tracksPanelNavReducer(state, event, NAV_CTX),
    createInitialTracksNav({}),
  );
  const { commandMode } = useShellInput({
    footerActions: [],
    commands: COMMANDS,
    onResolve: () => {},
  });
  useInput((_input, key) => {
    if (commandMode) return; // production gate: palette owns input while open
    if (key.rightArrow && nav.focusedPane === "sections") {
      dispatchNav({ type: "enter-section" });
      onPane("options");
      return;
    }
    if (key.leftArrow && nav.focusedPane === "options") {
      dispatchNav({ type: "exit-section" });
      onPane("sections");
      return;
    }
  });
  return <Text>{nav.focusedPane}</Text>;
}

describe("tracks-panel left/right input bridge", () => {
  test("right enters options, left exits back to sections", () => {
    const panes: string[] = [];
    const handle = render(<TracksSurface onPane={(pane) => panes.push(pane)} />, { columns: 100 });
    handle.stdin.enqueue("\u001b[C"); // right arrow
    handle.stdin.enqueue("\u001b[D"); // left arrow
    expect(panes).toEqual(["options", "sections"]);
    handle.unmount();
  });

  test("while the palette is open, arrows are withheld from the panel", () => {
    const panes: string[] = [];
    const handle = render(<TracksSurface onPane={(pane) => panes.push(pane)} />, { columns: 100 });
    handle.stdin.enqueue("/"); // open command palette → commandMode true
    handle.stdin.enqueue("\u001b[C"); // right arrow must NOT enter options
    expect(panes).toEqual([]);
    handle.unmount();
  });
});
