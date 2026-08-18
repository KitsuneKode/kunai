import { describe, expect, it } from "bun:test";

import { buildMediaPanel } from "@/app-shell/media-panel-model";
import { MediaPanel } from "@/app-shell/MediaPanel";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

// The post-play rail was reported rendering with rows missing (no ❀ badge, no
// title, no synopsis divider) and stray text welded onto fact values —
// "2006urite", "★ 8.5tion". That looks like a content bug and is not one: these
// tests pin the rendered FRAME so the model/component layer stays ruled out and
// the search stays on the write path (Ink's frame diff vs. the direct stdout
// writes the poster overlays make). See .docs/debugging-map.md.

const SYNOPSIS =
  "The Amanto, aliens from outer space, have invaded Earth and taken over " +
  "feudal Japan. As a result, a prohibition on swords has been established.";

function railModel() {
  return buildMediaPanel({
    surface: "post-play",
    contentKind: "anime",
    titleType: "series",
    title: "Gintama",
    titleDetail: {
      type: "series",
      year: "2006",
      score: 8.5,
      studios: ["SUNRISE"],
      status: "released",
      synopsis: SYNOPSIS,
      runtimeMinutes: 24,
    } as never,
    currentSeason: 1,
    currentEpisode: 8,
    nextEpisodeLabel: "S01 E09 — Fighting Should Be Done With Fists",
    previousEpisodeLabel: "S01 E07 — Bring It On",
    progress: { watched: 8, total: 200 },
  });
}

/** The rail's own render width, mirroring post-play-shell's rail slice. */
const RAIL_WIDTHS = [36, 34, 30, 28] as const;

function railFrame(railWidth: number): string {
  return captureFrame(
    <MediaPanel model={railModel()} railWidth={railWidth} placementSlot="postplay-rail" />,
    { columns: railWidth + 4, rows: 60 },
  );
}

describe("post-play rail frame", () => {
  it("renders every section the model carries", () => {
    const frame = railFrame(36);
    // The three rows reported missing from the screen.
    expect(frame).toContain("❀ anime");
    expect(frame).toContain("Gintama");
    expect(frame).toContain("synopsis");
    // Plus the sections that did survive, so a regression cannot pass by
    // deleting the ones above.
    expect(frame).toContain("details");
    expect(frame).toContain("prev");
    expect(frame).toContain("up next");
  });

  it("keeps fact values intact, with nothing welded onto them", () => {
    const frame = railFrame(36);
    const factLine = (label: string) =>
      frame
        .split("\n")
        .find((line) => line.includes(label))
        ?.trimEnd() ?? "";
    // "2006urite" / "★ 8.5tion" is what the screen showed; the frame must end
    // each value at the value.
    expect(factLine("year")).toMatch(/year\s+2006$/u);
    expect(factLine("score")).toMatch(/score\s+★ 8\.5$/u);
    expect(factLine("studio")).toMatch(/studio\s+SUNRISE$/u);
  });

  it("never emits a line wider than the rail it was given", () => {
    // A line wider than the rail would wrap in the terminal, and a wrapped line
    // is a row Ink's erase bookkeeping does not know about — which would make
    // this a content bug after all.
    for (const railWidth of RAIL_WIDTHS) {
      const overflowing = railFrame(railWidth)
        .split("\n")
        .filter((line) => line.length > railWidth);
      expect({ railWidth, overflowing }).toEqual({ railWidth, overflowing: [] });
    }
  });
});
