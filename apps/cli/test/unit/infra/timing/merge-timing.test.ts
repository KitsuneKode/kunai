import { describe, expect, test } from "bun:test";

import type { PlaybackTimingMetadata } from "@/domain/types";
import { mergeTimingMetadata } from "@/infra/timing/merge-timing";

function timing(overrides: Partial<PlaybackTimingMetadata> = {}): PlaybackTimingMetadata {
  return {
    tmdbId: "1396",
    type: "series",
    intro: [],
    recap: [],
    credits: [],
    preview: [],
    ...overrides,
  };
}

describe("mergeTimingMetadata", () => {
  test("a degenerate primary segment does not suppress a usable secondary window", () => {
    // IntroDB answers with a row it could not time. Choosing on array length
    // alone read that as "primary has intro timing" and dropped AniSkip's real
    // 80-90s window, so the skip prompt never appeared.
    const primary = timing({ intro: [{ startMs: 0, endMs: 0 }] });
    const secondary = timing({ intro: [{ startMs: 80_000, endMs: 90_000 }] });

    expect(mergeTimingMetadata(primary, secondary)?.intro).toEqual([
      { startMs: 80_000, endMs: 90_000 },
    ]);
  });

  test("a null-timed primary segment defers to a usable secondary window", () => {
    const primary = timing({ credits: [{ startMs: null, endMs: null }] });
    const secondary = timing({ credits: [{ startMs: 1_200_000, endMs: 1_260_000 }] });

    expect(mergeTimingMetadata(primary, secondary)?.credits).toEqual([
      { startMs: 1_200_000, endMs: 1_260_000 },
    ]);
  });

  test("a usable primary window still wins", () => {
    const primary = timing({ intro: [{ startMs: 10_000, endMs: 100_000 }] });
    const secondary = timing({ intro: [{ startMs: 80_000, endMs: 90_000 }] });

    expect(mergeTimingMetadata(primary, secondary)?.intro).toEqual([
      { startMs: 10_000, endMs: 100_000 },
    ]);
  });

  test("groups resolve independently", () => {
    const primary = timing({
      intro: [{ startMs: 0, endMs: 0 }],
      credits: [{ startMs: 1_200_000, endMs: 1_260_000 }],
    });
    const secondary = timing({
      intro: [{ startMs: 80_000, endMs: 90_000 }],
      credits: [{ startMs: 999, endMs: 1_000 }],
    });

    const merged = mergeTimingMetadata(primary, secondary);
    expect(merged?.intro).toEqual([{ startMs: 80_000, endMs: 90_000 }]);
    expect(merged?.credits).toEqual([{ startMs: 1_200_000, endMs: 1_260_000 }]);
  });

  test("when neither side can drive a skip the primary shape is kept", () => {
    const primary = timing({ intro: [{ startMs: 0, endMs: 0 }] });
    const secondary = timing({ intro: [{ startMs: null, endMs: null }] });

    expect(mergeTimingMetadata(primary, secondary)?.intro).toEqual([{ startMs: 0, endMs: 0 }]);
  });

  test("a missing side is returned whole", () => {
    const only = timing({ intro: [{ startMs: 80_000, endMs: 90_000 }] });

    expect(mergeTimingMetadata(null, only)).toBe(only);
    expect(mergeTimingMetadata(only, null)).toBe(only);
    expect(mergeTimingMetadata(null, null)).toBeNull();
  });
});
