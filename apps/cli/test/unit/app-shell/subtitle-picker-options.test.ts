import { describe, expect, test } from "bun:test";

import { buildSubtitlePickerOptions } from "@/app-shell/subtitle-picker-options";

describe("buildSubtitlePickerOptions", () => {
  test("labels query-distinct YouTube tracks by language", () => {
    expect(
      buildSubtitlePickerOptions([
        {
          url: "https://www.youtube.com/api/timedtext?v=abc&lang=en",
          display: "English",
          language: "en",
        },
        {
          url: "https://www.youtube.com/api/timedtext?v=abc&lang=fr",
          display: "French",
          language: "fr",
        },
      ]).map((option) => option.label),
    ).toEqual(["English", "French"]);
  });

  test("numbers rows that would otherwise look identical", () => {
    const options = buildSubtitlePickerOptions([
      { url: "https://addon.example/sub?id=1", sourceName: "addon" },
      { url: "https://addon.example/sub?id=2", sourceName: "addon" },
      { url: "https://addon.example/en.vtt", language: "en", sourceName: "addon" },
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Unknown track (1)",
      "Unknown track (2)",
      "en",
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "https://addon.example/sub?id=1",
      "https://addon.example/sub?id=2",
      "https://addon.example/en.vtt",
    ]);
  });
});
