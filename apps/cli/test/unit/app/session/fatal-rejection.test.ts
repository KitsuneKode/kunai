import { describe, expect, test } from "bun:test";

import { isFatalRejection, markFatalRejection } from "@/app/session/fatal-rejection";

describe("unhandled rejection policy", () => {
  test("a settings-save rejection is not fatal", () => {
    expect(isFatalRejection(new Error("config save failed"))).toBe(false);
  });

  test("a playback main-flow rejection stays fatal", () => {
    const reason = markFatalRejection(new Error("playback session failed"));
    expect(isFatalRejection(reason)).toBe(true);
  });
});
