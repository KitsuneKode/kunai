import { describe, expect, test } from "bun:test";

import { formatRelativeTime } from "../../src/youtube/format-duration";
import {
  buildYtdlFormatSelector,
  defaultYtdlPlaybackFormat,
} from "../../src/youtube/yt-dlp-metadata";

describe("buildYtdlFormatSelector", () => {
  test("best uses DASH merge first", () => {
    expect(defaultYtdlPlaybackFormat()).toBe("bv*+ba/b/ba");
    expect(buildYtdlFormatSelector("best")).toBe("bv*+ba/b/ba");
  });

  test("height caps prefer bestvideo+bestaudio, not muxed best[height]", () => {
    expect(buildYtdlFormatSelector("1080p")).toBe(
      "bv*[height<=?1080]+ba/bv*[height<=?1080]/bv*+ba/b/ba",
    );
    expect(buildYtdlFormatSelector("2160p")).toBe(
      "bv*[height<=?2160]+ba/bv*[height<=?2160]/bv*+ba/b/ba",
    );
  });
});

describe("formatRelativeTime", () => {
  const NOW = Date.parse("2026-08-27T00:00:00.000Z");
  const agoDays = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

  test("humanizes below a day instead of flattening everything to today", () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe(
      "2 hours ago",
    );
    expect(formatRelativeTime(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe("1 hour ago");
  });

  test("every span lands on a rung — no gap between months and years", () => {
    // 30-day months compared against 365-day years left days 360-364 matching
    // neither rung, and they rendered as "0 years ago".
    expect(formatRelativeTime(agoDays(359), NOW)).toBe("11 months ago");
    for (const days of [360, 361, 362, 363, 364, 365]) {
      expect(formatRelativeTime(agoDays(days), NOW)).toBe("1 year ago");
    }
    expect(formatRelativeTime(agoDays(730), NOW)).toBe("2 years ago");
  });

  test("no span renders a zero count", () => {
    for (let days = 0; days <= 800; days += 1) {
      const rendered = formatRelativeTime(agoDays(days), NOW);
      expect(rendered).toBeDefined();
      expect(rendered).not.toMatch(/^0 /);
    }
  });

  test("a future timestamp has no relative form", () => {
    expect(formatRelativeTime(agoDays(-2), NOW)).toBeUndefined();
  });
});
