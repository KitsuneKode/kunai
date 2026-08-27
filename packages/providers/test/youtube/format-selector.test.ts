import { describe, expect, test } from "bun:test";

import {
  buildYtdlFormatSelector,
  defaultYtdlPlaybackFormat,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildYtdlFormatSelector", () => {
  test("best uses DASH merge first", () => {
    expect(defaultYtdlPlaybackFormat()).toBe("bestvideo+bestaudio/best");
    expect(buildYtdlFormatSelector("best")).toBe("bestvideo+bestaudio/best");
  });

  test("height caps prefer bestvideo+bestaudio, not muxed best[height]", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "bestvideo[height<=?1080]+bestaudio/bestvideo+bestaudio/best",
    );
    expect(buildYtdlFormatSelector("2160p")).toBe(
      "bestvideo[height<=?2160]+bestaudio/bestvideo+bestaudio/best",
    );
  });
});
