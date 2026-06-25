import { describe, expect, test } from "bun:test";

import { loadingStageCopy, resolveHonestLoadingStageDetail } from "@/app-shell/loading-shell-model";

describe("loading stage copy", () => {
  test("maps startup timeline stages to honest user-facing status", () => {
    expect(loadingStageCopy("resolve-started")).toBe("Resolving provider stream");
    expect(loadingStageCopy("mpv-process-started")).toBe("Starting mpv");
    expect(loadingStageCopy("subtitle-attached")).toBe("Subtitles attached");
  });

  test("uses YouTube-specific loading copy for yt-dlp phases", () => {
    expect(loadingStageCopy("resolve-started", "youtube")).toBe(
      "Resolving YouTube metadata and watch URL",
    );
    expect(loadingStageCopy("stream-prepared", "youtube")).toBe(
      "Preparing yt-dlp playback arguments",
    );
    expect(loadingStageCopy("mpv-process-started", "youtube")).toBe("Starting mpv with yt-dlp");
  });

  test("prefers explicit playback detail over derived startup copy", () => {
    expect(
      resolveHonestLoadingStageDetail({
        startupStage: "player-ready",
        playbackDetail: "Opening provider stream",
      }),
    ).toBe("Opening provider stream");
  });

  test("falls back to startup stage copy when playback detail is absent", () => {
    expect(
      resolveHonestLoadingStageDetail({
        startupStage: "stream-prepared",
        playbackDetail: "   ",
        mode: "series",
      }),
    ).toBe("Preparing media for player");
  });

  test("falls back to YouTube-specific startup copy when playback detail is absent", () => {
    expect(
      resolveHonestLoadingStageDetail({
        startupStage: "media-materialized",
        playbackDetail: "   ",
        mode: "youtube",
      }),
    ).toBe("YouTube watch URL ready for mpv");
  });
});
