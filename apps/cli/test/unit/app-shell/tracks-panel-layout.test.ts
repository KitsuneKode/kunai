import { describe, expect, test } from "bun:test";

import {
  chunkSubtitleGrid,
  disambiguateSubtitleLabels,
  subtitleGridColumns,
  subtitleGridWindow,
  tracksCountsHeader,
} from "@/app-shell/tracks-panel-layout";

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

describe("disambiguateSubtitleLabels", () => {
  test("leaves unique labels alone", () => {
    expect(disambiguateSubtitleLabels([{ label: "English" }, { label: "Spanish" }])).toEqual([
      "English",
      "Spanish",
    ]);
  });

  test("numbers repeats so every row has its own identity", () => {
    // A merged list routinely carries several tracks under one language name.
    // Rendered identically, picking one is guesswork.
    expect(
      disambiguateSubtitleLabels([
        { label: "English" },
        { label: "English" },
        { label: "French" },
        { label: "English" },
      ]),
    ).toEqual(["English #1", "English #2", "French", "English #3"]);
  });

  test("puts the ordinal ahead of the release detail", () => {
    // Chips truncate from the right, so a discriminator behind a long release
    // string is the first thing cut — leaving the rows indistinguishable again.
    const [first, second] = disambiguateSubtitleLabels([
      { label: "English", detail: "Bytes.1080p.WEB-DL" },
      { label: "English", detail: "RARBG.720p.BluRay" },
    ]);

    expect(first?.startsWith("English #1")).toBe(true);
    expect(second?.startsWith("English #2")).toBe(true);
    expect(first).toContain("Bytes.1080p.WEB-DL");
  });

  test("ignores a detail that only repeats the label", () => {
    expect(
      disambiguateSubtitleLabels([
        { label: "English", detail: "English" },
        { label: "English", detail: "English" },
      ]),
    ).toEqual(["English #1", "English #2"]);
  });
});

describe("subtitleGridWindow", () => {
  test("shows everything when it fits", () => {
    expect(
      subtitleGridWindow({ totalCells: 6, columns: 3, focusedIndex: 0, visibleRows: 5 }),
    ).toEqual({ startRow: 0, endRow: 2, totalRows: 2 });
  });

  test("keeps the focused row in view for a long list", () => {
    // The grid used to draw every row it was given, straight through the bottom
    // of the panel and over whatever sat below it.
    const window = subtitleGridWindow({
      totalCells: 60,
      columns: 3,
      focusedIndex: 44,
      visibleRows: 5,
    });

    const focusedRow = Math.floor(44 / 3);
    expect(window.endRow - window.startRow).toBe(5);
    expect(focusedRow).toBeGreaterThanOrEqual(window.startRow);
    expect(focusedRow).toBeLessThan(window.endRow);
  });

  test("clamps at both ends rather than scrolling past them", () => {
    const atTop = subtitleGridWindow({
      totalCells: 60,
      columns: 3,
      focusedIndex: 0,
      visibleRows: 5,
    });
    expect(atTop.startRow).toBe(0);

    const atEnd = subtitleGridWindow({
      totalCells: 60,
      columns: 3,
      focusedIndex: 59,
      visibleRows: 5,
    });
    expect(atEnd.endRow).toBe(atEnd.totalRows);
    expect(atEnd.startRow).toBe(atEnd.totalRows - 5);
  });
});

describe("subtitleGridColumns", () => {
  test("never drops below a single column", () => {
    expect(subtitleGridColumns(0)).toBe(1);
    expect(subtitleGridColumns(-40)).toBe(1);
    expect(subtitleGridColumns(10)).toBe(1);
  });

  test("fits whole chips only", () => {
    expect(subtitleGridColumns(48)).toBe(3);
    expect(subtitleGridColumns(47)).toBe(2);
  });
});
