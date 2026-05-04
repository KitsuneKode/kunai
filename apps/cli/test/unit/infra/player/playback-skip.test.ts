import { expect, test } from "bun:test";

import type { PlaybackTimingMetadata } from "@/domain/types";
import {
  findActivePlaybackSkip,
  findPlaybackSegmentAtPosition,
  playbackSkipKindLabel,
  pruneSkippedPlaybackSegmentKeys,
} from "@/infra/player/playback-skip";

const timing: PlaybackTimingMetadata = {
  tmdbId: "1396",
  type: "series",
  recap: [{ startMs: 0, endMs: 60_000 }],
  intro: [{ startMs: 60_000, endMs: 120_000 }],
  credits: [{ startMs: 1_200_000, endMs: null }],
  preview: [{ startMs: 1_250_000, endMs: 1_290_000 }],
};

const BASE_CONFIG = {
  skipRecap: true,
  skipIntro: true,
  skipPreview: true,
  skipCredits: true,
  autoNextEnabled: false,
} as const;

test("findPlaybackSegmentAtPosition ignores user toggles", () => {
  expect(findPlaybackSegmentAtPosition(timing, 70)).toMatchObject({
    kind: "intro",
    startSeconds: 60,
    endSeconds: 120,
  });
  expect(findPlaybackSegmentAtPosition(timing, 70)).not.toBeNull();
  expect(playbackSkipKindLabel("intro")).toBe("SKIP INTRO");
});

test("findActivePlaybackSkip prefers recap, intro, preview, and credits windows only when enabled", () => {
  expect(findActivePlaybackSkip(timing, 10, BASE_CONFIG)).toMatchObject({
    kind: "recap",
    startSeconds: 0,
    endSeconds: 60,
  });

  expect(findActivePlaybackSkip(timing, 70, BASE_CONFIG)).toMatchObject({
    kind: "intro",
    startSeconds: 60,
    endSeconds: 120,
  });

  expect(findActivePlaybackSkip(timing, 1260, BASE_CONFIG)).toMatchObject({
    kind: "preview",
    startSeconds: 1250,
    endSeconds: 1290,
  });

  expect(findActivePlaybackSkip(timing, 70, { ...BASE_CONFIG, skipIntro: false })).toBeNull();

  // credits: skipped when skipCredits is on
  expect(
    findActivePlaybackSkip(
      { ...timing, credits: [{ startMs: 1_200_000, endMs: 1_250_000 }] },
      1210,
      BASE_CONFIG,
    ),
  ).toMatchObject({ kind: "credits", startSeconds: 1200, endSeconds: 1250 });

  // credits: also skipped when autoNextEnabled is on even if skipCredits is off
  expect(
    findActivePlaybackSkip(
      { ...timing, credits: [{ startMs: 1_200_000, endMs: 1_250_000 }] },
      1210,
      { ...BASE_CONFIG, skipCredits: false, autoNextEnabled: true },
    ),
  ).toMatchObject({ kind: "credits" });

  // credits: not skipped when both are off
  expect(
    findActivePlaybackSkip(
      { ...timing, credits: [{ startMs: 1_200_000, endMs: 1_250_000 }] },
      1210,
      { ...BASE_CONFIG, skipCredits: false, autoNextEnabled: false },
    ),
  ).toBeNull();
});

test("pruneSkippedPlaybackSegmentKeys re-arms segments when seeking backward", () => {
  const skipped = new Set<string>([
    "recap:0:60",
    "intro:60:120",
    "preview:1250:1290",
    "custom:1:2",
  ]);
  const pruned = pruneSkippedPlaybackSegmentKeys(skipped, timing, 0);
  expect([...pruned]).toEqual(["custom:1:2"]);
});

test("pruneSkippedPlaybackSegmentKeys keeps only segments that start before the rewound position", () => {
  const skipped = new Set<string>(["recap:0:60", "intro:60:120", "preview:1250:1290"]);
  const pruned = pruneSkippedPlaybackSegmentKeys(skipped, timing, 100);
  expect([...pruned]).toEqual(["recap:0:60", "intro:60:120"]);
});
