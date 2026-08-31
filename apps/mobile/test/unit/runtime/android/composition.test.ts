import { describe, expect, test } from "bun:test";

import { resolveAndroidStateRoot } from "../../../../src/runtime/android/composition";

describe("Android mobile composition", () => {
  test("uses HOME-owned state and ignores the desktop config environment", () => {
    expect(
      resolveAndroidStateRoot({
        HOME: "/data/data/com.termux/files/home",
        KUNAI_CONFIG_DIR: "/developer/live/kunai",
      }),
    ).toBe("/data/data/com.termux/files/home/.local/share/kunai-mobile");
  });

  test("fails closed when HOME is unavailable", () => {
    expect(() => resolveAndroidStateRoot({})).toThrow("HOME is required");
  });
});
