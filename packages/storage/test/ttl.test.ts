import { describe, expect, test } from "bun:test";

import { isExpired } from "../src/ttl";

describe("ttl isExpired", () => {
  test("returns true for timestamps in the past", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  test("returns false for timestamps in the future", () => {
    const future = new Date(Date.now() + 10_000).toISOString();
    expect(isExpired(future)).toBe(false);
  });

  test("returns true for non-finite or corrupted timestamps to prevent immortal cache leaks", () => {
    expect(isExpired("not-a-valid-date")).toBe(true);
    expect(isExpired("")).toBe(true);
    expect(isExpired("undefined")).toBe(true);
  });
});
