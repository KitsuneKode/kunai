import { describe, expect, test } from "bun:test";

import {
  describeStaleYtDlp,
  YTDLP_STALE_AFTER_DAYS,
  ytDlpReleaseAgeDays,
} from "../../src/youtube/version-freshness";

const NOW = Date.UTC(2026, 9, 13);

describe("yt-dlp release freshness", () => {
  test("computes release age in days", () => {
    expect(ytDlpReleaseAgeDays("2026.08.19", NOW)).toBe(55);
    expect(ytDlpReleaseAgeDays("2026.10.13", NOW)).toBe(0);
  });

  test("rejects non-release version strings without guessing", () => {
    expect(ytDlpReleaseAgeDays(undefined, NOW)).toBeNull();
    expect(ytDlpReleaseAgeDays("", NOW)).toBeNull();
    expect(ytDlpReleaseAgeDays("nightly", NOW)).toBeNull();
    expect(ytDlpReleaseAgeDays("2026.13.99", NOW)).toBeNull();
  });

  test("stays quiet for fresh releases and names stale ones", () => {
    expect(describeStaleYtDlp("2026.08.19", NOW)).toBeNull();
    const stale = describeStaleYtDlp("2026.01.01", NOW);
    expect(stale?.daysOld).toBeGreaterThanOrEqual(YTDLP_STALE_AFTER_DAYS);
    expect(stale?.message).toContain("update it for reliable extraction");
  });
});
