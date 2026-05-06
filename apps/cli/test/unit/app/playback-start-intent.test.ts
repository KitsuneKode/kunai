import { describe, expect, test } from "bun:test";

import {
  startAtResumePoint,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback-start-intent";

describe("playback start intent", () => {
  test("keeps resume offset and prompt handling together", () => {
    expect(
      startFromEpisodeSelection({
        season: 4,
        episode: 2,
        startAt: 1334,
        suppressResumePrompt: true,
      }),
    ).toEqual({
      startAt: 1334,
      suppressResumePrompt: true,
    });
  });

  test("normalizes start-over and invalid offsets to beginning", () => {
    expect(startFromBeginning()).toEqual({ startAt: 0, suppressResumePrompt: false });
    expect(startAtResumePoint(-1, { suppressResumePrompt: true })).toEqual({
      startAt: 0,
      suppressResumePrompt: true,
    });
  });
});
