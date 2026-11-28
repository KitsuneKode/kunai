import { describe, expect, test } from "bun:test";

import { debugGridElements } from "../../../../../.reference/design/brand/kanna-debug-grid.mjs";

describe("Kanna trace debug grid", () => {
  test("covers the bottom of a tall raw master while keeping the master width", () => {
    const grid = debugGridElements(928, 993).join("\n");
    expect(grid).toContain('d="M900 0V993"');
    expect(grid).toContain('d="M0 900H928"');
    expect(grid).toContain(">900</text>");
    expect(grid).not.toContain('d="M900 0V928"');
  });

  test("does not draw horizontal rows past a square master", () => {
    const grid = debugGridElements(928, 928).join("\n");
    expect(grid).toContain('d="M0 900H928"');
    expect(grid).not.toContain('d="M0 1000H928"');
  });
});
