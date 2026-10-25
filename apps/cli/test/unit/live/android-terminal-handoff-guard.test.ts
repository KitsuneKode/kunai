import { describe, expect, test } from "bun:test";

import { validateAndroidHandoffSmoke } from "../../live/android-terminal-handoff-guard";

const BASE_ENV = {
  TERMUX_VERSION: "0.119.0",
  KUNAI_ANDROID_HANDOFF_PLAYER: "vlc",
  KUNAI_ANDROID_HANDOFF_URL: "https://media.example/video.m3u8?token=secret",
  KUNAI_ANDROID_HANDOFF_BINARY: "/data/data/com.termux/files/usr/bin/kunai",
  KUNAI_ANDROID_SMOKE_ROOT: "/tmp/kunai-android-handoff-123",
} as const;

describe("validateAndroidHandoffSmoke", () => {
  test("accepts an explicit player, direct URL, and isolated root on Termux", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: BASE_ENV,
        realHome: "/data/data/com.termux/files/home",
        fileExists: () => true,
      }),
    ).toEqual({
      ok: true,
      player: "vlc",
      url: "https://media.example/video.m3u8?token=secret",
      binaryPath: "/data/data/com.termux/files/usr/bin/kunai",
      storageRoot: "/tmp/kunai-android-handoff-123",
    });
  });

  test("requires an existing absolute compiled binary", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: { ...BASE_ENV, KUNAI_ANDROID_HANDOFF_BINARY: "kunai" },
        realHome: "/data/data/com.termux/files/home",
        fileExists: () => true,
      }),
    ).toMatchObject({ ok: false, reason: "binary-required" });

    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: BASE_ENV,
        realHome: "/data/data/com.termux/files/home",
        fileExists: () => false,
      }),
    ).toMatchObject({ ok: false, reason: "binary-not-found" });
  });

  test("always validates Termux paths with Android POSIX semantics", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: {
          ...BASE_ENV,
          KUNAI_ANDROID_HANDOFF_BINARY: String.raw`D:\data\data\com.termux\files\usr\bin\kunai`,
        },
        realHome: "/data/data/com.termux/files/home",
        fileExists: () => true,
      }),
    ).toMatchObject({ ok: false, reason: "binary-required" });

    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: {
          ...BASE_ENV,
          KUNAI_ANDROID_SMOKE_ROOT: String.raw`D:\tmp\kunai-android-handoff-123`,
        },
        realHome: "/data/data/com.termux/files/home",
        fileExists: () => true,
      }),
    ).toMatchObject({ ok: false, reason: "storage-root-required" });
  });

  test("refuses non-Android hosts before launcher execution", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: { ...BASE_ENV, TERMUX_VERSION: undefined },
        realHome: "/home/developer",
      }),
    ).toMatchObject({ ok: false, reason: "not-android" });
  });

  test("requires VLC or mpv rather than an implicit chooser", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: { ...BASE_ENV, KUNAI_ANDROID_HANDOFF_PLAYER: "auto" },
        realHome: "/data/data/com.termux/files/home",
      }),
    ).toMatchObject({ ok: false, reason: "player-required" });
  });

  test("rejects missing and non-HTTP media URLs", () => {
    const missing = validateAndroidHandoffSmoke({
      platform: "linux",
      env: { ...BASE_ENV, KUNAI_ANDROID_HANDOFF_URL: undefined },
      realHome: "/data/data/com.termux/files/home",
    });
    const local = validateAndroidHandoffSmoke({
      platform: "linux",
      env: { ...BASE_ENV, KUNAI_ANDROID_HANDOFF_URL: "file:///sdcard/video.mp4" },
      realHome: "/data/data/com.termux/files/home",
    });

    expect(missing).toMatchObject({ ok: false, reason: "url-required" });
    expect(local).toMatchObject({ ok: false, reason: "invalid-url" });
  });

  test("rejects roots that resolve to the real profile", () => {
    expect(
      validateAndroidHandoffSmoke({
        platform: "linux",
        env: {
          ...BASE_ENV,
          KUNAI_ANDROID_SMOKE_ROOT: "/data/data/com.termux/files/home/.cache/smoke",
        },
        realHome: "/data/data/com.termux/files/home",
      }),
    ).toMatchObject({ ok: false, reason: "storage-root-not-isolated" });
  });
});
