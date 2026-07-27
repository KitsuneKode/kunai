import { describe, expect, test } from "bun:test";

import { diagnosticsVisibleRows } from "@/app-shell/diagnostics-dashboard-model";

describe("diagnosticsVisibleRows", () => {
  test("uses the terminal height, not a picker budget", () => {
    // 49 rows of content in a 60-row terminal must not scroll at 18.
    const visible = diagnosticsVisibleRows({ contentRows: 60, chromeRows: 6, sectionCount: 3 });
    expect(visible).toBeGreaterThan(40);
  });

  test("reserves room for chrome and section headings", () => {
    const visible = diagnosticsVisibleRows({ contentRows: 60, chromeRows: 6, sectionCount: 3 });
    expect(visible).toBeLessThanOrEqual(60 - 6 - 3);
  });

  test("stays positive on a very small terminal", () => {
    expect(
      diagnosticsVisibleRows({ contentRows: 8, chromeRows: 6, sectionCount: 3 }),
    ).toBeGreaterThanOrEqual(1);
  });

  test("never returns a fractional or negative row count", () => {
    const visible = diagnosticsVisibleRows({ contentRows: 3, chromeRows: 9, sectionCount: 2 });
    expect(Number.isInteger(visible)).toBe(true);
    expect(visible).toBeGreaterThan(0);
  });

  test("more sections mean fewer content rows", () => {
    const few = diagnosticsVisibleRows({ contentRows: 40, chromeRows: 4, sectionCount: 1 });
    const many = diagnosticsVisibleRows({ contentRows: 40, chromeRows: 4, sectionCount: 3 });
    expect(many).toBeLessThan(few);
  });

  test("a taller terminal shows strictly more", () => {
    const short = diagnosticsVisibleRows({ contentRows: 30, chromeRows: 4, sectionCount: 2 });
    const tall = diagnosticsVisibleRows({ contentRows: 80, chromeRows: 4, sectionCount: 2 });
    expect(tall).toBeGreaterThan(short);
  });
});
