import { afterEach, describe, expect, test } from "bun:test";

import {
  EMOJI_OR_MASCOT,
  LONG_BOX_RULE,
  setPlainDecorationSource,
} from "@/app-shell/decoration-policy";
import { DetailsSheetUI } from "@/app-shell/details-pane-ui";
import {
  buildBrowseDetailsPanel,
  buildDetailsPanelDataFromBrowseOption,
} from "@/app-shell/details-panel";
import { kannaLinesFor } from "@/app-shell/kanna-voice";
import { helpSectionsForScope } from "@/app-shell/keybindings";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { HelpShell } from "@/app-shell/root-overlay-shell";
import { ErrorShell } from "@/app-shell/root-status-shells";
import { SakuraLoader } from "@/app-shell/SakuraLoader";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import React from "react";

import { historyWideNode } from "../../harness/capture-history";
import { playbackErrorNode } from "../../harness/capture-playback-error";
import { settingsFixtures } from "../../harness/capture-settings";
import { SETUP_SCREENS, setupFrameAt } from "../../harness/capture-setup";
import { captureFrame } from "../../harness/render-capture";

const BOX_DRAWING = /[┌│└─]/u;
const MODIFIER_GLYPH = /[⇧⌃⇥]/u;
const CURSOR_GLYPH = "▌";
const PLAIN_MARK = /[❀❯▸◉○●✓△✗]/u;

afterEach(() => {
  setPlainDecorationSource(() => false);
});

describe("minimal plain render", () => {
  test("StateBlock under plain mode has no emoji, rules, mascot copy, ASCII title prefix", () => {
    setPlainDecorationSource(() => true);
    const frame = captureFrame(
      <StateBlock model={{ kind: "empty", title: "No results yet" }} width={64} />,
      { columns: 72, rows: 24 },
    );
    expect(frame).toContain("No results yet");
    expect(frame).toMatch(/(^- No results yet|- No results yet)/);
    expect(EMOJI_OR_MASCOT.test(frame)).toBe(false);
    expect(LONG_BOX_RULE.test(frame)).toBe(false);
    for (const line of kannaLinesFor("empty")) {
      expect(frame).not.toContain(line);
    }
  });

  test("rich mode still renders decorative empty-state copy when companion enabled", () => {
    const frame = captureFrame(
      <StateBlock model={{ kind: "empty", title: "No results yet" }} width={64} />,
      { columns: 72, rows: 24 },
    );
    expect(frame).toContain("No results yet");
  });

  test("every setup step under plain mode has no emoji, mascot, rules or fancy cursor", () => {
    // Setup is the first screen a screen-reader user meets; -m must cover it.
    setPlainDecorationSource(() => true);
    SETUP_SCREENS.forEach((name, step) => {
      const frame = setupFrameAt(step, 64);
      expect({ name, emoji: EMOJI_OR_MASCOT.test(frame) }).toEqual({ name, emoji: false });
      expect({ name, rule: LONG_BOX_RULE.test(frame) }).toEqual({ name, rule: false });
      expect({ name, cursor: frame.includes("▌") }).toEqual({ name, cursor: false });
    });
  });

  test("plain mode drops decorative glyphs on the surfaces a screen reader hears", () => {
    setPlainDecorationSource(() => true);
    const option = {
      value: { id: "smoke", type: "movie" as const, title: "Smoke Movie" },
      label: "Smoke Movie",
      previewTitle: "Smoke Movie",
      previewMeta: ["Movie", "2024"],
    };
    const settingsNode = settingsFixtures()[0]?.[1];
    if (settingsNode === undefined) throw new Error("settings fixture missing");
    const frames: ReadonlyArray<readonly [string, string]> = [
      [
        "help",
        captureFrame(
          <HelpShell
            sections={helpSectionsForScope("browse")}
            scopeLabel="browse"
            commandMode={false}
            commandInput=""
            commandCursor={0}
            commands={[]}
            highlightedIndex={0}
            footerActions={[]}
            onClose={() => {}}
          />,
          { columns: 120, rows: 40 },
        ),
      ],
      ["settings", captureFrame(settingsNode, { columns: 120, rows: 40 })],
      [
        "command-palette",
        captureFrame(
          <CommandPalette
            input=""
            commands={fallbackCommandState(["filters", "settings"])}
            highlightedIndex={0}
          />,
          { columns: 100, rows: 24 },
        ),
      ],
      ["history", captureFrame(historyWideNode(), { columns: 140, rows: 40 })],
      [
        "browse-details",
        captureFrame(
          <DetailsSheetUI
            data={buildDetailsPanelDataFromBrowseOption(option)}
            lines={buildBrowseDetailsPanel(option).lines}
            width={40}
            maxVisibleLines={16}
          />,
          { columns: 48, rows: 30 },
        ),
      ],
      [
        "loading",
        captureFrame(<SakuraLoader label="Loading titles" sublabel="Matching the catalog" />, {
          columns: 80,
          rows: 8,
        }),
      ],
      ["setup-language", setupFrameAt(2, 80)],
      ["setup-done", setupFrameAt(5, 80)],
      ["playback-error", captureFrame(playbackErrorNode(), { columns: 100, rows: 30 })],
      [
        "network-error",
        captureFrame(
          <ErrorShell
            message="The network is unreachable"
            scenario={{ kind: "network-offline" }}
            onResolve={() => {}}
          />,
          { columns: 100, rows: 24 },
        ),
      ],
    ];

    for (const [name, frame] of frames) {
      expect({ name, emoji: EMOJI_OR_MASCOT.test(frame) }).toEqual({ name, emoji: false });
      expect({ name, rule: LONG_BOX_RULE.test(frame) }).toEqual({ name, rule: false });
      expect({ name, cursor: frame.includes(CURSOR_GLYPH) }).toEqual({ name, cursor: false });
      expect({ name, box: BOX_DRAWING.test(frame) }).toEqual({ name, box: false });
      expect({ name, chord: MODIFIER_GLYPH.test(frame) }).toEqual({ name, chord: false });
      expect({ name, mark: PLAIN_MARK.test(frame) }).toEqual({ name, mark: false });
      expect(frame.length).toBeGreaterThan(0);
    }

    expect(frames.find(([name]) => name === "help")?.[1]).toContain("Help");
    expect(frames.find(([name]) => name === "browse-details")?.[1]).toContain("Synopsis");
    expect(frames.find(([name]) => name === "loading")?.[1]).toContain("Loading titles");
    expect(frames.find(([name]) => name === "setup-done")?.[1]).toContain("You're all set");
  });
});
