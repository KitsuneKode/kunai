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
