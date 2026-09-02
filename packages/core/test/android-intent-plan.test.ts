import { describe, expect, test } from "bun:test";

import { resolveAndroidIntentPlan } from "../src/android-intent-plan";

const URL = "https://media.example/episode.m3u8?token=a&title=$(touch%20nope)";

describe("resolveAndroidIntentPlan", () => {
  test("prefers termux-am and keeps the URL in one chooser argument", () => {
    expect(
      resolveAndroidIntentPlan({
        target: "chooser",
        url: URL,
        launchers: {
          termuxAm: "/data/data/com.termux/files/usr/bin/termux-am",
          am: "/system/bin/am",
        },
      }),
    ).toEqual({
      ok: true,
      launcher: "termux-am",
      argv: [
        "/data/data/com.termux/files/usr/bin/termux-am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        URL,
        "-t",
        "video/*",
      ],
    });
  });

  test("pins VLC and mpv to their Android packages", () => {
    for (const [target, packageName] of [
      ["vlc", "org.videolan.vlc"],
      ["mpv", "is.xyz.mpv"],
    ] as const) {
      expect(
        resolveAndroidIntentPlan({
          target,
          url: URL,
          launchers: { am: "/system/bin/am" },
        }),
      ).toEqual({
        ok: true,
        launcher: "am",
        argv: [
          "/system/bin/am",
          "start",
          "-a",
          "android.intent.action.VIEW",
          "-d",
          URL,
          "-t",
          "video/*",
          "-p",
          packageName,
        ],
      });
    }
  });

  test("uses chooser-only Termux fallbacks in capability order", () => {
    expect(
      resolveAndroidIntentPlan({
        target: "chooser",
        url: URL,
        launchers: {
          termuxOpen: "/usr/bin/termux-open",
          termuxOpenUrl: "/usr/bin/termux-open-url",
        },
      }),
    ).toEqual({
      ok: true,
      launcher: "termux-open",
      argv: ["/usr/bin/termux-open", "--view", "--chooser", "--content-type", "video/*", URL],
    });
    expect(
      resolveAndroidIntentPlan({
        target: "chooser",
        url: URL,
        launchers: { termuxOpenUrl: "/usr/bin/termux-open-url" },
      }),
    ).toEqual({
      ok: true,
      launcher: "termux-open-url",
      argv: ["/usr/bin/termux-open-url", URL],
    });
  });

  test("rejects missing or chooser-only launchers for explicit players", () => {
    expect(resolveAndroidIntentPlan({ target: "chooser", url: URL, launchers: {} })).toEqual({
      ok: false,
      reason: "intent-launcher-missing",
    });
    expect(
      resolveAndroidIntentPlan({
        target: "vlc",
        url: URL,
        launchers: { termuxOpenUrl: "/usr/bin/termux-open-url" },
      }),
    ).toEqual({ ok: false, reason: "intent-launcher-missing" });
  });
});
