import { expect, test } from "bun:test";

import { TracksPanelShell } from "@/app-shell/tracks-panel-shell";
import type { TrackCapabilityGroup } from "@/domain/playback/track-capabilities";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// Real renderer, switchable demo/worst-case fixtures; opt-in text artifacts for review.
const demo: TrackCapabilityGroup[] = [
  {
    section: "source",
    title: "Source",
    selectable: true,
    rows: [
      {
        section: "source",
        label: "Citadel",
        value: "citadel",
        enabled: false,
        selected: true,
        risk: "normal",
        detail: "playing · host cdn.example · 32 subtitles",
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
        label: "Auto",
        value: "quality:auto",
        enabled: false,
        selected: true,
        risk: "normal",
        detail: "Currently 1080p · Best available",
      },
      {
        section: "quality",
        label: "1080p",
        value: "q1080",
        enabled: true,
        selected: false,
        risk: "normal",
      },
    ],
  },
  {
    section: "subtitle",
    title: "Subtitles",
    selectable: true,
    rows: [
      {
        section: "subtitle",
        label: "Subtitles off",
        value: "subtitle:off",
        enabled: true,
        selected: false,
        risk: "normal",
      },
      {
        section: "subtitle",
        label: "English",
        value: "en",
        enabled: false,
        selected: true,
        risk: "normal",
      },
    ],
  },
];
const worst: TrackCapabilityGroup[] = demo.map((group) =>
  group.section === "source"
    ? {
        ...group,
        rows: [
          ...group.rows,
          ...Array.from({ length: 15 }, (_, index) => ({
            section: "source" as const,
            label: `鏡 ${index} — A very long mirror name that exceeds its cell budget`,
            value: `mirror:${index}`,
            enabled: true,
            selected: false,
            risk: "failed" as const,
            detail:
              "Provider candidate timed out · failed · host private-cdn.example · repeated diagnostics",
          })),
        ],
      }
    : group.section === "subtitle"
      ? {
          ...group,
          rows: [
            ...group.rows,
            ...Array.from({ length: 33 }, (_, index) => ({
              section: "subtitle" as const,
              label: ["中文", "العربية", "Français", "English"][index % 4] ?? "English",
              value: `sub:${index}`,
              enabled: true,
              selected: false,
              risk: "normal" as const,
            })),
          ],
        }
      : group,
);
for (const width of [48, 72, 100, 140]) {
  for (const [name, groups] of Object.entries({ demo, worst })) {
    test(`watching layout ${name} at ${width} columns`, async () => {
      for (const sectionIndex of [0, 1, 2]) {
        const frame = captureFrame(
          <TracksPanelShell
            groups={groups}
            width={width}
            height={20}
            nav={{ focusedPane: "options", sectionIndex, optionIndex: 0 }}
            onBack={() => {}}
          />,
          { columns: width, rows: 24 },
        );
        expect(frame.split("\n").every((line) => Bun.stringWidth(line) <= width)).toBe(true);
        expect(frame.split("\n").length).toBeLessThanOrEqual(20);
        expect(frame).not.toContain("private-cdn.example");
        expect(frame).toContain("← Back");
        if (process.env.KUNAI_UX_CAPTURE_DIR)
          await Bun.write(
            `${process.env.KUNAI_UX_CAPTURE_DIR}/tracks-${name}-${width}-${sectionIndex}.txt`,
            frame,
          );
      }
    });
  }
}
