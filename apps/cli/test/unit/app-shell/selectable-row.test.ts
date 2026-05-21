import { describe, expect, test } from "bun:test";

import { selectableRowStyle } from "@/app-shell/shell-primitives";

describe("selectableRowStyle", () => {
  test("selected row uses amber rule + fill background", () => {
    const s = selectableRowStyle(true);
    expect(s.prefix).toBe("▌");
    expect(s.backgroundColor).toBe("#2a2012"); // amberFill
    expect(s.color).toBe("#ffbf80"); // amberSoft
  });
  test("unselected row is calm: no fill, two-space prefix", () => {
    const s = selectableRowStyle(false);
    expect(s.prefix).toBe("  ");
    expect(s.backgroundColor).toBeUndefined();
    expect(s.color).toBe("#e8ddd0"); // text
  });
});
