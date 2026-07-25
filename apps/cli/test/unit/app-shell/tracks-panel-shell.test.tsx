import { describe, expect, test } from "bun:test";

import { createInitialTracksNav } from "@/app-shell/tracks-panel-nav";
import { TracksPanelShell } from "@/app-shell/tracks-panel-shell";
import type { TrackCapabilityGroup } from "@/domain/playback/track-capabilities";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const groups: TrackCapabilityGroup[] = [
  {
    section: "source",
    title: "Source",
    selectable: true,
    rows: [
      {
        section: "source",
        label: "Neon",
        value: "neon",
        selected: true,
        enabled: false,
        risk: "normal",
      },
      {
        section: "source",
        label: "Fade",
        value: "fade",
        selected: false,
        enabled: true,
        risk: "normal",
      },
    ],
  },
  {
    section: "quality",
    title: "Quality",
    selectable: true,
    rows: [
      {
        section: "quality",
        label: "1080p",
        value: "q1080",
        selected: true,
        enabled: false,
        risk: "normal",
      },
    ],
  },
];

describe("TracksPanelShell two-pane", () => {
  test("shows counts header and a ♥ on a favorited source", () => {
    const frame = captureFrame(
      <TracksPanelShell
        groups={groups}
        width={80}
        nav={createInitialTracksNav({})}
        favorites={["fade"]}
        providerLabel="vidlink"
      />,
      { columns: 80 },
    );
    expect(frame).toContain("2 sources · 1 quality · vidlink");
    expect(frame).toContain("♥");
    expect(frame).toContain("Fade");
  });

  test("narrow width falls back to single column (shows rows, no crash)", () => {
    const frame = captureFrame(
      <TracksPanelShell groups={groups} width={40} nav={createInitialTracksNav({})} />,
      { columns: 40 },
    );
    expect(frame).toContain("Neon");
  });

  test("empty groups renders a graceful message", () => {
    const frame = captureFrame(<TracksPanelShell groups={[]} width={80} />, { columns: 80 });
    expect(frame).toContain("No stream details");
  });
});

describe("TracksPanelShell subtitle grid", () => {
  const subtitleGroup = (labels: readonly string[]): TrackCapabilityGroup[] => [
    {
      section: "subtitle",
      title: "Subtitle",
      selectable: true,
      rows: labels.map((label, index) => ({
        section: "subtitle" as const,
        label,
        value: `sub-${String(index)}`,
        selected: index === 0,
        enabled: true,
        risk: "normal" as const,
      })),
    },
  ];

  test("stays inside its height for a long merged list", () => {
    // The grid used to render every row regardless of the height it was given,
    // so an external-search merge drew past the bottom of the panel and over
    // whatever sat below it.
    const frame = captureFrame(
      <TracksPanelShell
        groups={subtitleGroup(Array.from({ length: 60 }, (_, i) => `Track ${String(i)}`))}
        width={80}
        height={20}
        nav={{ focusedPane: "options", sectionIndex: 0, optionIndex: 44 }}
        favorites={[]}
        providerLabel="videasy"
      />,
      { columns: 84 },
    );

    expect(frame.split("\n").length).toBeLessThanOrEqual(20);
    // The focused cell is on screen, with the rest accounted for above it.
    expect(frame).toContain("Track 44");
    expect(frame).toContain("more");
  });

  test("keeps repeated language names tellable apart", () => {
    const frame = captureFrame(
      <TracksPanelShell
        groups={subtitleGroup(["English", "English", "English", "Spanish"])}
        width={80}
        height={20}
        nav={{ focusedPane: "options", sectionIndex: 0, optionIndex: 0 }}
        favorites={[]}
        providerLabel="videasy"
      />,
      { columns: 84 },
    );

    expect(frame).toContain("English #1");
    expect(frame).toContain("English #2");
    expect(frame).toContain("English #3");
    // A label with no twin is left alone.
    expect(frame).toContain("Spanish");
    expect(frame).not.toContain("Spanish #");
  });

  test("caps the narrow stacked view instead of drawing past the terminal", () => {
    // The stacked fallback rendered every section's rows with no height budget
    // at all, so a merged subtitle list overflowed a narrow terminal entirely.
    const frame = captureFrame(
      <TracksPanelShell
        groups={subtitleGroup(Array.from({ length: 40 }, (_, i) => `Track ${String(i)}`))}
        width={40}
        height={16}
        nav={{ focusedPane: "options", sectionIndex: 0, optionIndex: 0 }}
        favorites={[]}
        providerLabel="videasy"
      />,
      { columns: 44 },
    );

    expect(frame.split("\n").length).toBeLessThanOrEqual(16);
    expect(frame).toContain("more");
  });
});
