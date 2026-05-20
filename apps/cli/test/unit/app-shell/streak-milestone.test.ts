import { describe, expect, test } from "bun:test";

import { getNextStreakMilestone } from "@/app-shell/streak-milestone";

describe("getNextStreakMilestone", () => {
  test("celebrates the highest newly reached milestone instead of stale older milestones", () => {
    expect(getNextStreakMilestone(9, 0)).toBe(7);
    expect(getNextStreakMilestone(9, 3)).toBe(7);
    expect(getNextStreakMilestone(9, 7)).toBeNull();
  });

  test("stays quiet until the first milestone is reached", () => {
    expect(getNextStreakMilestone(2, 0)).toBeNull();
  });
});
