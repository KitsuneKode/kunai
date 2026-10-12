import { describe, expect, test } from "bun:test";

import { nearestOptionIndex } from "@/domain/session/picker-model";

describe("nearestOptionIndex", () => {
  test("starts on the matching option", () => {
    expect(nearestOptionIndex([1, 2, 3], 2)).toBe(1);
  });

  test("a miss starts on the nearest option, never on nothing", () => {
    // A picker that opened unhighlighted made Enter a silent no-op until ↓.
    expect(nearestOptionIndex([7], 1)).toBe(0);
    expect(nearestOptionIndex([1, 4, 8], 5)).toBe(1);
  });

  test("a tie prefers the later option — the next episode is the likelier intent", () => {
    expect(nearestOptionIndex([4, 6], 5)).toBe(1);
  });

  test("an empty list has no cursor", () => {
    expect(nearestOptionIndex([], 3)).toBe(-1);
  });
});
