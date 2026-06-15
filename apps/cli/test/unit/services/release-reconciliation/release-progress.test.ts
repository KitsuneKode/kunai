import { expect, test } from "bun:test";

import { computeReleaseProgress } from "@/services/release-reconciliation/ReleaseReconciliationService";

test("ongoing show ahead of anchor yields new-episodes with the exact delta", () => {
  // Releasing show (hasUpcoming) drops episodes continuously — a positive delta is
  // genuinely new even without an explicit air date.
  expect(
    computeReleaseProgress({ latestAiredEpisode: 8, anchorEpisode: 5, hasUpcoming: true }),
  ).toEqual({ newEpisodeCount: 3, status: "new-episodes" });
});

test("finished show you fell behind on is NOT new without proof of recent airing", () => {
  // Bungo Stray Dogs case: finished season (no upcoming), watched ep2 of 12, no
  // known air date for the latest episode. Being behind on a back-catalog season is
  // "continue watching", never "10 new episodes".
  expect(
    computeReleaseProgress({ latestAiredEpisode: 12, anchorEpisode: 2, hasUpcoming: false }),
  ).toEqual({ newEpisodeCount: 0, status: "caught-up" });
});

test("finished show is new when the latest episode aired after your last watch", () => {
  expect(
    computeReleaseProgress({
      latestAiredEpisode: 12,
      anchorEpisode: 2,
      hasUpcoming: false,
      latestKnownReleaseAt: "2026-06-10T00:00:00.000Z",
      anchorWatchedAt: "2026-05-01T00:00:00.000Z",
    }),
  ).toEqual({ newEpisodeCount: 10, status: "new-episodes" });
});

test("finished show is NOT new when the latest episode aired before your last watch", () => {
  expect(
    computeReleaseProgress({
      latestAiredEpisode: 12,
      anchorEpisode: 2,
      hasUpcoming: false,
      latestKnownReleaseAt: "2019-06-10T00:00:00.000Z",
      anchorWatchedAt: "2026-06-01T00:00:00.000Z",
    }),
  ).toEqual({ newEpisodeCount: 0, status: "caught-up" });
});

test("caught up only when latest aired >= anchor and nothing upcoming", () => {
  expect(
    computeReleaseProgress({ latestAiredEpisode: 5, anchorEpisode: 5, hasUpcoming: false }),
  ).toEqual({ newEpisodeCount: 0, status: "caught-up" });
});

test("upcoming wins over caught-up when a future airing is known", () => {
  expect(
    computeReleaseProgress({ latestAiredEpisode: 5, anchorEpisode: 5, hasUpcoming: true }),
  ).toEqual({ newEpisodeCount: 0, status: "upcoming" });
});

test("axis mismatch (latest aired below anchor) is unknown, NOT a false caught-up", () => {
  // history stored absolute ep 64, AniList reports cour-relative ep 5
  expect(
    computeReleaseProgress({ latestAiredEpisode: 5, anchorEpisode: 64, hasUpcoming: false }),
  ).toEqual({ newEpisodeCount: 0, status: "unknown" });
});

test("missing latest-aired is unknown (or upcoming when a future airing exists)", () => {
  expect(
    computeReleaseProgress({ latestAiredEpisode: undefined, anchorEpisode: 5, hasUpcoming: false }),
  ).toEqual({ newEpisodeCount: 0, status: "unknown" });
  expect(
    computeReleaseProgress({ latestAiredEpisode: undefined, anchorEpisode: 5, hasUpcoming: true }),
  ).toEqual({ newEpisodeCount: 0, status: "upcoming" });
});
