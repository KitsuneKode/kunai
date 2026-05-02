import { expect, test } from "bun:test";

import type { PlaybackTimingMetadata } from "@/domain/types";
import { findActivePlaybackSkip } from "@/infra/player/playback-skip";

const timing: PlaybackTimingMetadata = {
  tmdbId: "1396",
  type: "series",
  recap: [{ startMs: 0, endMs: 60_000 }],
  intro: [{ startMs: 60_000, endMs: 120_000 }],
  credits: [{ startMs: 1_200_000, endMs: null }],
  preview: [{ startMs: 1_250_000, endMs: 1_290_000 }],
};

test("findActivePlaybackSkip prefers recap, intro, and preview windows only when enabled", () => {
  expect(
    findActivePlaybackSkip(timing, 10, {
      skipRecap: true,
      skipIntro: true,
      skipPreview: true,
    }),
  ).toMatchObject({
    kind: "recap",
    startSeconds: 0,
    endSeconds: 60,
  });

  expect(
    findActivePlaybackSkip(timing, 70, {
      skipRecap: true,
      skipIntro: true,
      skipPreview: true,
    }),
  ).toMatchObject({
    kind: "intro",
    startSeconds: 60,
    endSeconds: 120,
  });

  expect(
    findActivePlaybackSkip(timing, 1260, {
      skipRecap: true,
      skipIntro: true,
      skipPreview: true,
    }),
  ).toMatchObject({
    kind: "preview",
    startSeconds: 1250,
    endSeconds: 1290,
  });

  expect(
    findActivePlaybackSkip(timing, 70, {
      skipRecap: true,
      skipIntro: false,
      skipPreview: true,
    }),
  ).toBeNull();
});
