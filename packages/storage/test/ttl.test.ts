import { describe, expect, test } from "bun:test";

import { isExpired } from "../src/ttl";

describe("ttl isExpired", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  test("returns true for timestamps in the past", () => {
    const past = new Date(now.getTime() - 1).toISOString();
    expect(isExpired(past, now)).toBe(true);
  });

  test("returns false for timestamps in the future", () => {
    const future = new Date(now.getTime() + 1).toISOString();
    expect(isExpired(future, now)).toBe(false);
  });

  test("returns true for non-finite or corrupted timestamps to prevent immortal cache leaks", () => {
    expect(isExpired("not-a-valid-date", now)).toBe(true);
    expect(isExpired("", now)).toBe(true);
    expect(isExpired("undefined", now)).toBe(true);
  });
});
