import { expect, test } from "bun:test";

import { computeReleaseProgress } from "@/services/release-reconciliation/ReleaseReconciliationService";

test("latest aired ahead of anchor yields new-episodes with the exact delta", () => {
  expect(
    computeReleaseProgress({ latestAiredEpisode: 8, anchorEpisode: 5, hasUpcoming: false }),
  ).toEqual({ newEpisodeCount: 3, status: "new-episodes" });
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
