import { afterEach, describe, expect, test } from "bun:test";

import {
  decorationGlyphs,
  EMOJI_OR_MASCOT,
  LONG_BOX_RULE,
  setPlainDecorationSource,
} from "@/app-shell/decoration-policy";
import { DetailsSheetUI } from "@/app-shell/details-pane-ui";
import {
  buildBrowseDetailsPanel,
  buildDetailsPanelDataFromBrowseOption,
} from "@/app-shell/details-panel";
import { DetailsSheet } from "@/app-shell/details-sheet-ui";
import { buildDetailsSheet } from "@/app-shell/details-sheet.model";
import { kannaLinesFor } from "@/app-shell/kanna-voice";
import { helpSectionsForScope } from "@/app-shell/keybindings";
import { renderStageRail } from "@/app-shell/loading-shell-runtime";
import { buildMediaPanel } from "@/app-shell/media-panel-model";
import { MediaPanel } from "@/app-shell/MediaPanel";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { HelpShell } from "@/app-shell/root-overlay-shell";
import { ErrorShell } from "@/app-shell/root-status-shells";
import { SakuraLoader } from "@/app-shell/SakuraLoader";
import { fallbackCommandState } from "@/app-shell/shell-command-model";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import React from "react";

import { historyWideNode } from "../../harness/capture-history";
import { playbackErrorNode } from "../../harness/capture-playback-error";
import { settingsFixtures } from "../../harness/capture-settings";
import { SETUP_SCREENS, setupFrameAt } from "../../harness/capture-setup";
import { StatsOverviewCapture } from "../../harness/capture-stats";
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

  test("plain details sheet and now-playing panel have no half-block poster or poster gap", () => {
    setPlainDecorationSource(() => true);
    const sheetModel = buildDetailsSheet({
      seed: {
        title: "Frieren",
        type: "series",
        year: "2023",
        score: 8.1,
        posterUrl: "https://image.example/frieren.jpg",
      },
      detail: null,
      history: null,
      availability: null,
    });
    const sheet = captureFrame(
      <DetailsSheet model={sheetModel} seasonsExpanded={false} width={72} />,
      { columns: 80, rows: 24 },
    );
    expect(sheet).not.toContain("▀");
    expect(sheet).toContain("Frieren");
    expect(sheet).toContain("8.1/10");
    expect(sheet).not.toContain("★");
    const titleLine = sheet.split("\n").find((line) => line.includes("Frieren"));
    expect(titleLine?.startsWith("Frieren")).toBe(true);

    const detail: TitleDetail = {
      id: "438631",
      type: "movie",
      title: "Dune",
      year: "2021",
      score: 8.1,
      synopsis: "A noble house arrives on Arrakis.",
      artwork: { poster: "https://image.example/dune.jpg" },
    };
    const panelModel = buildMediaPanel({
      surface: "playing",
      contentKind: "movie",
      title: "Dune",
      posterUrl: detail.artwork?.poster,
      titleDetail: detail,
    });
    const panel = captureFrame(
      <MediaPanel model={panelModel} railWidth={36} placementSlot="playing-rail" allowSixel />,
      { columns: 40, rows: 40 },
    );
    expect(panel).not.toContain("▀");
    expect(panel).toContain("Dune");
    expect(panel).toContain("8.1/10");
    expect(panel).not.toContain("★");
    const contentLines = panel.split("\n").filter((line) => line.trim().length > 0);
    const duneAt = contentLines.findIndex((line) => line.includes("Dune"));
    expect(duneAt).toBeGreaterThanOrEqual(0);
    expect(duneAt).toBeLessThan(3);
  });

  test("plain streak and stats copy has no emoji", () => {
    setPlainDecorationSource(() => true);
    const frame = captureFrame(<StatsOverviewCapture innerWidth={80} rows={24} />, {
      columns: 90,
      rows: 30,
    });
    expect(frame).toContain("2-day streak");
    expect(frame).not.toContain("🔥");
    expect(EMOJI_OR_MASCOT.test(frame)).toBe(false);
  });

  test("plain loading stage rail and chrome glyphs stay ascii", () => {
    setPlainDecorationSource(() => true);
    const rail = renderStageRail("finding-stream", null)
      .map((item) => `${item.glyph} ${item.label}`)
      .join("\n");
    expect(rail).not.toMatch(/[◐◓◑◒]/u);
    expect(rail).toContain("...");

    const glyphs = decorationGlyphs();
    expect(glyphs.search).toBe("Search");
    expect(glyphs.disclosure).toBe("...");
    expect(glyphs.disclosure).not.toBe(glyphs.listCursor);

    const library = setupFrameAt(3, 80);
    expect(library).not.toContain(">[");
    expect(library).toContain("> [");

    const settingsNode = settingsFixtures()[0]?.[1];
    if (settingsNode === undefined) throw new Error("settings fixture missing");
    const settings = captureFrame(settingsNode, { columns: 100, rows: 40 });
    expect(settings).not.toMatch(/[▲▼]/u);
    expect(settings).not.toContain("> >");
  });
});
