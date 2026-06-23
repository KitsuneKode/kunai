import { expect, test } from "bun:test";

import type { ContinuationProjection } from "@/services/continuation/continuation-policy";
import {
  hasDualContinueSources,
  resolveContinueSourceAction,
} from "@/services/continuation/continuation-source";

const dualProjection: ContinuationProjection = {
  kind: "offline-ready",
  titleId: "tmdb:1",
  title: "Demo",
  season: 1,
  episode: 4,
  sourceEntry: {
    key: "k",
    titleId: "tmdb:1",
    title: "Demo",
    mediaKind: "series",
    season: 1,
    episode: 3,
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    providerId: "vidking",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  primaryAction: { kind: "play-local", season: 1, episode: 4, jobId: "job-4" },
  secondaryActions: [{ kind: "select-online", season: 1, episode: 4 }],
};

test("resolveContinueSourceAction prefers local in auto mode when both exist", () => {
  expect(resolveContinueSourceAction(dualProjection, "auto")?.kind).toBe("play-local");
});

test("resolveContinueSourceAction honors local and stream preferences", () => {
  expect(resolveContinueSourceAction(dualProjection, "local")?.kind).toBe("play-local");
  expect(resolveContinueSourceAction(dualProjection, "stream")?.kind).toBe("select-online");
});

test("resolveContinueSourceAction returns undefined in ask mode until override", () => {
  expect(resolveContinueSourceAction(dualProjection, "ask")).toBeUndefined();
  expect(resolveContinueSourceAction(dualProjection, "ask", "stream")?.kind).toBe("select-online");
});

test("hasDualContinueSources is true only when both local and online actions exist", () => {
  expect(hasDualContinueSources(dualProjection)).toBe(true);
  expect(
    hasDualContinueSources({
      ...dualProjection,
      secondaryActions: [],
    }),
  ).toBe(false);
});
