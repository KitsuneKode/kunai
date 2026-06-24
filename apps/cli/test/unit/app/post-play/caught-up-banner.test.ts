import { describe, expect, it } from "bun:test";

import { formatCaughtUpReleaseBanner } from "@/app/post-play/caught-up-banner";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

describe("formatCaughtUpReleaseBanner", () => {
  it("returns null when the episode or release date is missing", () => {
    expect(
      formatCaughtUpReleaseBanner({ episode: undefined, releaseAt: undefined, now: NOW }),
    ).toBeNull();
    expect(formatCaughtUpReleaseBanner({ episode: 5, releaseAt: undefined, now: NOW })).toBeNull();
    expect(
      formatCaughtUpReleaseBanner({
        episode: undefined,
        releaseAt: "2026-03-02T12:00:00Z",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for an unparseable or past release date", () => {
    expect(
      formatCaughtUpReleaseBanner({ episode: 5, releaseAt: "not-a-date", now: NOW }),
    ).toBeNull();
    expect(
      formatCaughtUpReleaseBanner({ episode: 5, releaseAt: "2026-02-28T12:00:00.000Z", now: NOW }),
    ).toBeNull();
  });

  it("uses an hours/minutes countdown within a day", () => {
    const releaseAt = new Date(NOW + 3 * 3_600_000 + 20 * 60_000).toISOString();
    expect(formatCaughtUpReleaseBanner({ episode: 7, releaseAt, now: NOW })).toBe(
      "Caught up · Ep 7 airs in 3h 20m",
    );
  });

  it("drops the hours component when under an hour away", () => {
    const releaseAt = new Date(NOW + 45 * 60_000).toISOString();
    expect(formatCaughtUpReleaseBanner({ episode: 7, releaseAt, now: NOW })).toBe(
      "Caught up · Ep 7 airs in 45m",
    );
  });

  it("uses the weekday name within a week", () => {
    const releaseAt = new Date(NOW + 3 * 24 * 3_600_000).toISOString();
    const banner = formatCaughtUpReleaseBanner({ episode: 7, releaseAt, now: NOW });
    expect(banner).toContain("Caught up · Ep 7 airs on ");
    // Three days after a Sunday is Wednesday; assert it names a weekday, not a date.
    expect(banner).toMatch(/airs on [A-Za-z]+$/);
  });

  it("uses a month/day date beyond a week", () => {
    const releaseAt = new Date(NOW + 10 * 24 * 3_600_000).toISOString();
    const banner = formatCaughtUpReleaseBanner({ episode: 7, releaseAt, now: NOW });
    expect(banner).toContain("Caught up · Ep 7 airs ");
    expect(banner).not.toContain("airs on ");
    expect(banner).not.toContain(" in ");
  });
});
