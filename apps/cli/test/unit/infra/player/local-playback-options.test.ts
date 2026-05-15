import { describe, expect, test } from "bun:test";

import { resolveLocalPlaybackPolicy } from "@/infra/player/local-playback-policy";

describe("resolveLocalPlaybackPolicy", () => {
  test("uses the same autoskip flags as online playback", () => {
    expect(
      resolveLocalPlaybackPolicy({
        autoSkipEnabled: true,
        skipRecap: false,
        skipIntro: true,
        skipPreview: true,
        skipCredits: false,
      }),
    ).toEqual({
      autoSkipEnabled: true,
      skipRecap: false,
      skipIntro: true,
      skipPreview: true,
      skipCredits: false,
    });
  });

  test("keeps backwards-compatible defaults when callers do not pass policy", () => {
    expect(resolveLocalPlaybackPolicy({})).toEqual({
      autoSkipEnabled: true,
      skipRecap: true,
      skipIntro: true,
      skipPreview: false,
      skipCredits: true,
    });
  });
});
