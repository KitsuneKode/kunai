import { describe, expect, test } from "bun:test";

import { chunkSubtitleGrid, tracksCountsHeader } from "@/app-shell/tracks-panel-layout";

describe("tracksCountsHeader", () => {
  test("joins present counts, omits zeros, appends provider when given", () => {
    expect(tracksCountsHeader({ source: 1, quality: 3, audio: 0, subtitle: 10 }, "vidlink")).toBe(
      "1 source · 3 qualities · 10 subtitles · vidlink",
    );
  });

  test("singular/plural and no provider", () => {
    expect(tracksCountsHeader({ source: 2, quality: 1, audio: 1, subtitle: 0 })).toBe(
      "2 sources · 1 quality · 1 audio",
    );
  });

  test("all zero + no provider is empty", () => {
    expect(tracksCountsHeader({ source: 0, quality: 0, audio: 0, subtitle: 0 })).toBe("");
  });
});

describe("chunkSubtitleGrid", () => {
  test("wraps labels into rows of `columns`", () => {
    expect(chunkSubtitleGrid(["EN", "ES", "FR", "DE", "IT"], 2)).toEqual([
      ["EN", "ES"],
      ["FR", "DE"],
      ["IT"],
    ]);
  });

  test("columns < 1 coerces to single column", () => {
    expect(chunkSubtitleGrid(["EN", "ES"], 0)).toEqual([["EN"], ["ES"]]);
  });

  test("empty input = no rows", () => {
    expect(chunkSubtitleGrid([], 3)).toEqual([]);
  });
});
