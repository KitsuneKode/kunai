import { describe, expect, test } from "bun:test";

import {
  buildYtdlFormatSelector,
  defaultYtdlPlaybackFormat,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildYtdlFormatSelector", () => {
  test("best uses DASH merge first", () => {
    expect(defaultYtdlPlaybackFormat()).toBe("bv*+ba/b");
    expect(buildYtdlFormatSelector("best")).toBe("bv*+ba/b");
  });

  test("height caps prefer bestvideo+bestaudio, not muxed best[height]", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]/bestvideo+bestaudio/bv*+ba/b",
    );
    expect(buildYtdlFormatSelector("2160p")).toBe(
      "bestvideo[height<=2160]+bestaudio/bestvideo[height<=2160]/bestvideo+bestaudio/bv*+ba/b",
    );
  });
});
