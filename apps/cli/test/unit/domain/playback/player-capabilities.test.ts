import { describe, expect, test } from "bun:test";

import {
  DETACHED_HANDOFF_CAPABILITIES,
  MANAGED_MPV_CAPABILITIES,
} from "@/domain/playback/player-capabilities";

describe("player capabilities", () => {
  test("managed mpv keeps every currently observed player feature", () => {
    expect(MANAGED_MPV_CAPABILITIES).toEqual({
      observation: "managed",
      customHeaders: true,
      externalSubtitles: true,
      localFiles: true,
      progressEvents: true,
    });
    expect(Object.isFrozen(MANAGED_MPV_CAPABILITIES)).toBe(true);
  });

  test("detached handoff claims no unobserved player behavior", () => {
    expect(DETACHED_HANDOFF_CAPABILITIES).toEqual({
      observation: "detached",
      customHeaders: false,
      externalSubtitles: false,
      localFiles: false,
      progressEvents: false,
    });
    expect(Object.isFrozen(DETACHED_HANDOFF_CAPABILITIES)).toBe(true);
  });
});
