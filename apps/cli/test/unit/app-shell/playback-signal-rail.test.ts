import { describe, expect, test } from "bun:test";

import { buildPlaybackSignalRail } from "@/app-shell/loading-shell";

describe("buildPlaybackSignalRail", () => {
  test("formats resolution, speed, and subtitle track", () => {
    expect(
      buildPlaybackSignalRail({
        qualityLabel: "720p · 23fps",
        downloadStatus: "24.3 MB/s",
        subtitleTrack: "en",
      }),
    ).toEqual(["720p · 23fps", "24.3 MB/s ↓", "sub en"]);
  });
});
