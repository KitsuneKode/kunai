import { describe, expect, test } from "bun:test";

import { reconcileContinueHistory } from "@/domain/continuation/history-reconciliation";
import type { HistoryProgress } from "@kunai/storage";

function history(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    title: "Demo",
    mediaKind: "series",
    season: 1,
    episode: 5,
    positionSeconds: 1_800,
    durationSeconds: 1_800,
    completed: true,
    providerId: "vidking",
    updatedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

describe("history reconciliation", () => {
  test("resumes the most-recent episode when it is unfinished", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [
        [
          "tmdb:1",
          history({
            episode: 6,
            completed: false,
            positionSeconds: 600,
            updatedAt: "2026-05-12T00:00:00.000Z",
          }),
        ],
        ["tmdb:1", history({ episode: 5, updatedAt: "2026-05-11T00:00:00.000Z" })],
      ],
    });

    expect(decision).toMatchObject({
      kind: "resume",
      titleId: "tmdb:1",
      entry: expect.objectContaining({ episode: 6, completed: false }),
    });
  });

  test("does NOT resume an older abandoned episode when the most-recent is finished", () => {
    // Netflix/Crunchyroll anchor rule: decide off the most-recent episode, never
    // scan back to an older unfinished one. The most-recent (E6) is finished, and
    // without release evidence we stay up to date — crucially NOT resuming E5.
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [
        ["tmdb:1", history({ episode: 6, completed: true, updatedAt: "2026-05-12T00:00:00.000Z" })],
        [
          "tmdb:1",
          history({
            episode: 5,
            completed: false,
            positionSeconds: 600,
            updatedAt: "2026-05-11T00:00:00.000Z",
          }),
        ],
      ],
    });

    expect(decision).toMatchObject({
      kind: "up-to-date",
      titleId: "tmdb:1",
      entry: expect.objectContaining({ episode: 6, completed: true }),
    });
  });

  test("surfaces a released next episode without mutating completed history", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ episode: 5, completed: true })]],
      nextRelease: {
        season: 1,
        episode: 6,
        status: "released",
        releaseAt: "2026-05-17",
      },
    });

    expect(decision).toEqual({
      kind: "new-episode",
      titleId: "tmdb:1",
      titleName: "Demo",
      season: 1,
      episode: 6,
      previousCompleted: expect.objectContaining({ episode: 5 }),
      releaseAt: "2026-05-17",
    });
  });

  test("keeps completed titles calm when the next episode is only scheduled", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ episode: 5, completed: true })]],
      nextRelease: {
        season: 1,
        episode: 6,
        status: "upcoming",
        releaseAt: "2026-05-24",
      },
    });

    expect(decision).toMatchObject({
      kind: "up-to-date",
      nextRelease: { episode: 6, status: "upcoming" },
    });
  });

  test("finished series without release evidence is up to date, not optimistic E+1", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ season: 2, episode: 3, completed: true })]],
    });

    expect(decision).toMatchObject({
      kind: "up-to-date",
      titleId: "tmdb:1",
      entry: expect.objectContaining({ season: 2, episode: 3 }),
    });
  });

  test("stays caught up when the latest released episode is the one already watched", () => {
    // A positive 'released' signal that is NOT ahead of history means caught up —
    // do not fabricate an optimistic next episode.
    const decision = reconcileContinueHistory({
      titleId: "tmdb:1",
      entries: [["tmdb:1", history({ episode: 6, completed: true })]],
      nextRelease: { season: 1, episode: 6, status: "released", releaseAt: "2026-05-17" },
    });

    expect(decision).toMatchObject({ kind: "up-to-date" });
  });

  test("does not optimistically advance a finished movie", () => {
    const decision = reconcileContinueHistory({
      titleId: "tmdb:9",
      entries: [
        ["tmdb:9", history({ mediaKind: "movie", season: 1, episode: 1, completed: true })],
      ],
    });

    expect(decision).toMatchObject({ kind: "up-to-date" });
  });
});
