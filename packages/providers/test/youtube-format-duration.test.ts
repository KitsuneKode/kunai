import { describe, expect, test } from "bun:test";

import { formatDurationSeconds, formatViewCount } from "../src/youtube/format-duration";

describe("formatDurationSeconds", () => {
  test("formats sub-hour durations", () => {
    expect(formatDurationSeconds(754)).toBe("12:34");
  });

  test("formats hour-plus durations", () => {
    expect(formatDurationSeconds(3661)).toBe("1:01:01");
  });
});

describe("formatViewCount", () => {
  test("formats compact view counts", () => {
    expect(formatViewCount(1_250_000)).toBe("1.3M views");
  });
});
