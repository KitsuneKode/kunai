import { describe, expect, test } from "bun:test";

import { loadingStageCopy, resolveHonestLoadingStageDetail } from "@/app-shell/loading-shell-model";

describe("loading stage copy", () => {
  test("maps startup timeline stages to honest user-facing status", () => {
    expect(loadingStageCopy("resolve-started")).toBe("Resolving provider stream");
    expect(loadingStageCopy("mpv-process-started")).toBe("Starting mpv");
    expect(loadingStageCopy("subtitle-attached")).toBe("Subtitles attached");
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
      }),
    ).toBe("Preparing media for player");
  });
});
