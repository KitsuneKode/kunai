import { describe, expect, test } from "bun:test";

import { emptyMpvHardwareAccelProbe } from "@/infra/player/mpv-hwaccel-probe";
import {
  describeMpvHwaccel,
  mpvHwdecEmittedFor,
  mpvHwdecPlaybackReport,
} from "@/services/update/native-installer/mpv-hwdec-report";

describe("mpv hwdec report copy", () => {
  test("probe failure and not-probed state stay neutral for explicit decoder modes", () => {
    const failed = describeMpvHwaccel(emptyMpvHardwareAccelProbe("probe-failed"));
    const notProbed = describeMpvHwaccel(emptyMpvHardwareAccelProbe("not-probed"));

    expect(failed).toBe("probe failed or timed out");
    expect(notProbed).toBe("not probed yet");
    expect(failed).not.toContain("playback uses mpv default");
    expect(notProbed).not.toContain("playback uses mpv default");
    expect(mpvHwdecEmittedFor("vaapi", emptyMpvHardwareAccelProbe("probe-failed"))).toBe("vaapi");
  });

  test("playback emission remains policy-specific for default, off, auto, and explicit modes", () => {
    const hardware = {
      ...emptyMpvHardwareAccelProbe("hardware"),
      probed: true,
      autoSafeOk: true,
      autoSafeDriver: "nvdec-copy",
    };
    const failed = emptyMpvHardwareAccelProbe("probe-failed");

    expect(mpvHwdecEmittedFor("mpv-default", hardware)).toBeNull();
    expect(mpvHwdecEmittedFor("off", hardware)).toBe("no");
    expect(mpvHwdecEmittedFor("auto", hardware)).toBe("auto-safe");
    expect(mpvHwdecEmittedFor("auto", failed)).toBeNull();
    expect(mpvHwdecEmittedFor("vaapi", hardware)).toBe("vaapi");
  });

  test("playback report only emits an mpv flag for managed mpv", () => {
    const hardware = {
      ...emptyMpvHardwareAccelProbe("hardware"),
      probed: true,
      autoSafeOk: true,
      autoSafeDriver: "nvdec-copy",
    };

    expect(mpvHwdecPlaybackReport("managed-mpv", "auto", hardware).mpvHwdecEmitted).toBe(
      "auto-safe",
    );
    expect(mpvHwdecPlaybackReport("managed-vlc", "off", hardware).mpvHwdecEmitted).toBeNull();
    expect(mpvHwdecPlaybackReport("android-handoff", "off", hardware).mpvHwdecEmitted).toBeNull();
  });
});
