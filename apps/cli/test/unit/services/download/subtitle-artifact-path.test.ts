import { describe, expect, test } from "bun:test";

import { resolveSubtitleArtifactPath } from "@/services/download/subtitle-artifact-path";

describe("resolveSubtitleArtifactPath", () => {
  test("uses URL extension when present", () => {
    expect(
      resolveSubtitleArtifactPath({
        videoOutputPath: "/videos/show-s01e01.mp4",
        subtitleUrl: "https://cdn.example/track.vtt?token=abc",
      }),
    ).toBe("/videos/show-s01e01.vtt");
  });

  test("respects Content-Type when URL has no suffix", () => {
    expect(
      resolveSubtitleArtifactPath({
        videoOutputPath: "/videos/movie.mp4",
        subtitleUrl: "https://cdn.example/track",
        contentType: "text/vtt; charset=utf-8",
      }),
    ).toBe("/videos/movie.vtt");
  });

  test("defaults to .srt", () => {
    expect(
      resolveSubtitleArtifactPath({
        videoOutputPath: "/videos/movie.mp4",
        subtitleUrl: "https://cdn.example/track",
      }),
    ).toBe("/videos/movie.srt");
  });
});
