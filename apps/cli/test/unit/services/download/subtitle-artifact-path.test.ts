import { describe, expect, test } from "bun:test";

import { resolveSubtitleArtifactPath } from "@/services/download/subtitle-artifact-path";

describe("resolveSubtitleArtifactPath", () => {
  test("uses the format verified by the downloader", () => {
    expect(resolveSubtitleArtifactPath("/videos/show-s01e01.mp4", "vtt")).toBe(
      "/videos/show-s01e01.vtt",
    );
  });

  test("preserves dots in directory names", () => {
    expect(resolveSubtitleArtifactPath("D:\\Media\\Anime.Shows\\ep", "ass")).toBe(
      "D:\\Media\\Anime.Shows\\ep.ass",
    );
  });
});
