import { describe, expect, test } from "bun:test";

import {
  formatEpisodePickerDetail,
  formatEpisodePickerLabel,
  formatEpisodePreviewSynopsis,
} from "@/services/catalog/episode-display";

describe("episode display", () => {
  test("treats punctuation-only TMDB names as placeholders", () => {
    expect(formatEpisodePickerLabel(1, ".", "Class begins in Itaewon.")).toBe(
      "Episode 1  ·  Class begins in Itaewon.",
    );
  });

  test("uses formatted air date and runtime in picker detail", () => {
    expect(
      formatEpisodePickerDetail({
        airDate: "2020-01-31",
        runtimeMinutes: 68,
      }),
    ).toBe("Jan 31, 2020  ·  68 min");
  });

  test("drops placeholder synopsis from preview body", () => {
    expect(formatEpisodePreviewSynopsis(".")).toBeUndefined();
    expect(formatEpisodePreviewSynopsis("Dan-bam opens its doors.")).toBe(
      "Dan-bam opens its doors.",
    );
  });
});
