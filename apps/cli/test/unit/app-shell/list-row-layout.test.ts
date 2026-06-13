import { describe, expect, test } from "bun:test";

import {
  buildListRowLayoutFixtures,
  computeCalendarRowLayout,
  computeMediaListRowLayout,
  computeQueueRowLayout,
} from "@/app-shell/primitives/list-row-layout";

describe("list-row-layout", () => {
  test("media list layout keeps a flex title base instead of pre-consuming row width", () => {
    const layout = computeMediaListRowLayout(72, { hasEpisode: true, hasRecency: true });
    expect(layout.titleWidth).toBe(12);
    expect(layout.statusWidth).toBeGreaterThanOrEqual(12);
    expect(layout.recencyWidth).toBe(8);
  });

  test("calendar layout reserves wider status cells on wide rows", () => {
    const narrow = computeCalendarRowLayout(60, true);
    const wide = computeCalendarRowLayout(100, true);
    expect(wide.statusWidth).toBeGreaterThan(narrow.statusWidth);
  });

  test("queue layout scales progress column with shell width", () => {
    const narrow = computeQueueRowLayout(80);
    const wide = computeQueueRowLayout(160);
    expect(wide.progressWidth).toBeGreaterThan(narrow.progressWidth);
  });

  test("fixtures cover regression breakpoints with companion split", () => {
    const fixtures = buildListRowLayoutFixtures();
    expect(fixtures.map((fixture) => fixture.breakpoint)).toEqual([80, 100, 120, 160]);
    expect(fixtures.find((fixture) => fixture.breakpoint === 80)?.companion).toBe(false);
    expect(fixtures.find((fixture) => fixture.breakpoint === 120)?.companion).toBe(true);
    expect(fixtures.every((fixture) => fixture.rowWidth >= 20)).toBe(true);
  });
});
