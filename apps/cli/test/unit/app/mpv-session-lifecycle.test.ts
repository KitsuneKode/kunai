import { describe, expect, test } from "bun:test";

import {
  MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
  shouldKeepPersistentMpvForPlaybackRecovery,
  shouldReleasePersistentMpvBeforePostPlay,
} from "@/app/mpv-session-lifecycle";
import type { PlaybackResult } from "@/domain/types";

describe("mpv session lifecycle policy", () => {
  test("keeps persistent mpv only for the first autoplay-chain auto-recover", () => {
    expect(shouldKeepPersistentMpvForPlaybackRecovery("autoplay-chain", 0)).toBe(true);
    expect(
      shouldKeepPersistentMpvForPlaybackRecovery(
        "autoplay-chain",
        MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
      ),
    ).toBe(false);
    expect(shouldKeepPersistentMpvForPlaybackRecovery("manual", 0)).toBe(false);
  });

  test("releases before post-play when auto-recover is exhausted and playback never started", () => {
    const failedStart: PlaybackResult = {
      watchedSeconds: 0,
      duration: 0,
      endReason: "error",
      resultSource: "unknown",
      playerExitedCleanly: false,
      playerExitCode: 1,
      playerExitSignal: null,
      socketPathCleanedUp: true,
      lastNonZeroPositionSeconds: 0,
      lastNonZeroDurationSeconds: 0,
    };

    expect(shouldReleasePersistentMpvBeforePostPlay(failedStart, true)).toBe(true);
    expect(shouldReleasePersistentMpvBeforePostPlay(failedStart, false)).toBe(false);
    expect(
      shouldReleasePersistentMpvBeforePostPlay(
        { ...failedStart, endReason: "eof", watchedSeconds: 1200, duration: 1200 },
        true,
      ),
    ).toBe(false);
  });
});
