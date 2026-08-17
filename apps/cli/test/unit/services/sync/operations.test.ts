import { describe, expect, test } from "bun:test";

import {
  canCoalesceTrackerOperations,
  parseTrackerOperation,
  trackerOperationDedupeKey,
  type TrackerOperation,
} from "@/services/sync/operations";

const anilistTarget = { tracker: "anilist", anilistId: 438631, mediaKind: "anime" } as const;
const tmdbMovieTarget = { tracker: "tmdb", tmdbId: 550, mediaKind: "movie" } as const;
const tmdbSeriesTarget = { tracker: "tmdb", tmdbId: 1396, mediaKind: "series" } as const;

const progress: TrackerOperation = {
  version: 1,
  kind: "progress:set",
  target: anilistTarget,
  progress: 3,
  status: "watching",
};

const watchlist: TrackerOperation = {
  version: 1,
  kind: "list-membership:set",
  target: tmdbMovieTarget,
  list: "watchlist",
  present: true,
};

const favorite: TrackerOperation = {
  version: 1,
  kind: "favorite-membership:set",
  target: tmdbMovieTarget,
  present: true,
};

/**
 * Operations are persisted, so they outlive the process that wrote them and are
 * re-read by a later build. Parsing is therefore a trust boundary, not a
 * formality: a row written by an older version, or corrupted on disk, must be
 * rejected by shape rather than coerced into a plausible remote write.
 */
describe("parseTrackerOperation", () => {
  test("accepts each valid variant unchanged", () => {
    expect(parseTrackerOperation(progress)).toEqual({ ok: true, operation: progress });
    expect(parseTrackerOperation(watchlist)).toEqual({ ok: true, operation: watchlist });
    expect(parseTrackerOperation(favorite)).toEqual({ ok: true, operation: favorite });
  });

  test("accepts an optional watchedAt on progress", () => {
    const withTime = { ...progress, watchedAt: "2026-08-13T00:00:00.000Z" };
    expect(parseTrackerOperation(withTime)).toEqual({ ok: true, operation: withTime });
  });

  test("accepts completed status and series/movie targets", () => {
    const completed = { ...progress, status: "completed" as const };
    expect(parseTrackerOperation(completed)).toEqual({ ok: true, operation: completed });
    const series = { ...watchlist, target: tmdbSeriesTarget };
    expect(parseTrackerOperation(series)).toEqual({ ok: true, operation: series });
  });

  test("rejects non-objects", () => {
    for (const value of [null, undefined, 3, "progress:set", [], true]) {
      expect(parseTrackerOperation(value)).toEqual({ ok: false, code: "payload-not-object" });
    }
  });

  test("rejects a missing or unknown version", () => {
    const { version: _omitted, ...noVersion } = progress;
    expect(parseTrackerOperation(noVersion)).toEqual({ ok: false, code: "unsupported-version" });
    expect(parseTrackerOperation({ ...progress, version: 2 })).toEqual({
      ok: false,
      code: "unsupported-version",
    });
    expect(parseTrackerOperation({ ...progress, version: "1" })).toEqual({
      ok: false,
      code: "unsupported-version",
    });
  });

  test("rejects an unknown kind", () => {
    expect(parseTrackerOperation({ ...progress, kind: "rating:set" })).toEqual({
      ok: false,
      code: "unsupported-kind",
    });
  });

  /**
   * TMDB v3 has no episode-progress endpoint, so a progress row addressed to it
   * is not a delivery failure to retry — it is a payload that can never be
   * valid, and it must be rejected before any adapter sees it.
   */
  test("rejects progress addressed to TMDB", () => {
    expect(parseTrackerOperation({ ...progress, target: tmdbSeriesTarget })).toEqual({
      ok: false,
      code: "invalid-target",
    });
  });

  test("rejects malformed targets", () => {
    for (const target of [
      undefined,
      null,
      {},
      { tracker: "anilist" },
      { tracker: "mal", malId: 1, mediaKind: "anime" },
      { tracker: "anilist", anilistId: 0, mediaKind: "anime" },
      { tracker: "anilist", anilistId: -1, mediaKind: "anime" },
      { tracker: "anilist", anilistId: 1.5, mediaKind: "anime" },
      { tracker: "anilist", anilistId: "438631", mediaKind: "anime" },
      { tracker: "anilist", anilistId: 438631, mediaKind: "movie" },
      { tracker: "tmdb", tmdbId: 550, mediaKind: "anime" },
      { tracker: "tmdb", tmdbId: 550 },
    ]) {
      expect(parseTrackerOperation({ ...watchlist, target }), JSON.stringify(target)).toEqual({
        ok: false,
        code: "invalid-target",
      });
    }
  });

  test("rejects non-positive-integer progress", () => {
    for (const value of [0, -1, 1.5, "3", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseTrackerOperation({ ...progress, progress: value }), String(value)).toEqual({
        ok: false,
        code: "invalid-progress",
      });
    }
  });

  test("rejects an unknown progress status", () => {
    expect(parseTrackerOperation({ ...progress, status: "dropped" })).toEqual({
      ok: false,
      code: "invalid-state",
    });
    expect(parseTrackerOperation({ ...progress, status: undefined })).toEqual({
      ok: false,
      code: "invalid-state",
    });
  });

  /** A string "false" is truthy; coercing membership would invert the user's intent. */
  test("rejects non-boolean membership", () => {
    for (const value of ["true", "false", 1, 0, null, undefined]) {
      expect(parseTrackerOperation({ ...favorite, present: value }), String(value)).toEqual({
        ok: false,
        code: "invalid-state",
      });
    }
  });

  test("rejects a missing or unknown list", () => {
    expect(parseTrackerOperation({ ...watchlist, list: undefined })).toEqual({
      ok: false,
      code: "invalid-state",
    });
    expect(parseTrackerOperation({ ...watchlist, list: "favorites" })).toEqual({
      ok: false,
      code: "invalid-state",
    });
  });

  /** Rejection codes are persisted as diagnostics, so they carry no payload. */
  test("returns only a bounded code, never the rejected payload", () => {
    const result = parseTrackerOperation({ secret: "bearer-abc123", version: 9 });
    expect(result).toEqual({ ok: false, code: "unsupported-version" });
    expect(JSON.stringify(result)).not.toContain("bearer-abc123");
  });
});

describe("trackerOperationDedupeKey", () => {
  test("separates tracker, media kind, id and kind", () => {
    expect(trackerOperationDedupeKey(progress)).toBe("anilist:anime:438631|progress:set");
    expect(trackerOperationDedupeKey(watchlist)).toBe("tmdb:movie:550|list-membership:set");
    expect(trackerOperationDedupeKey(favorite)).toBe("tmdb:movie:550|favorite-membership:set");
  });

  /** The same integer in two catalogues, or two media kinds, is two rows. */
  test("does not collide across trackers or media kinds", () => {
    const sameNumberOnAniList = { ...progress, target: { ...anilistTarget, anilistId: 550 } };
    expect(trackerOperationDedupeKey(sameNumberOnAniList)).not.toBe(
      trackerOperationDedupeKey(watchlist),
    );
    const asSeries = { ...watchlist, target: { ...tmdbSeriesTarget, tmdbId: 550 } };
    expect(trackerOperationDedupeKey(asSeries)).not.toBe(trackerOperationDedupeKey(watchlist));
  });
});

/**
 * Coalescing is what keeps the outbox bounded when a user binge-watches: only
 * the newest desired value for one field matters. It is safe exactly when the
 * replacement fully supersedes the current row — same tracker, target, kind and
 * field — and unsafe everywhere else, where it would silently drop an intent.
 */
describe("canCoalesceTrackerOperations", () => {
  test("coalesces a newer desired value for the same field", () => {
    expect(canCoalesceTrackerOperations(progress, { ...progress, progress: 4 })).toBe(true);
    expect(canCoalesceTrackerOperations(watchlist, { ...watchlist, present: false })).toBe(true);
    expect(canCoalesceTrackerOperations(favorite, { ...favorite, present: false })).toBe(true);
  });

  test("never coalesces different operation kinds", () => {
    expect(canCoalesceTrackerOperations(watchlist, { ...favorite })).toBe(false);
    expect(canCoalesceTrackerOperations(favorite, { ...watchlist })).toBe(false);
  });

  test("never coalesces across trackers, ids, or media kinds", () => {
    expect(
      canCoalesceTrackerOperations(progress, {
        ...progress,
        target: { ...anilistTarget, anilistId: 999 },
      }),
    ).toBe(false);
    expect(
      canCoalesceTrackerOperations(watchlist, { ...watchlist, target: tmdbSeriesTarget }),
    ).toBe(false);
  });
});
