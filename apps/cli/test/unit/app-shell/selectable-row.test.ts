import { describe, expect, test } from "bun:test";

import { selectableRowStyle } from "@/app-shell/shell-primitives";
import { palette } from "@/app-shell/shell-theme";

describe("selectableRowStyle", () => {
  test("selected row uses accent rule + fill background", () => {
    const s = selectableRowStyle(true);
    expect(s.prefix).toBe("▌");
    expect(s.backgroundColor).toBe(palette.accentFill);
    expect(s.color).toBe(palette.accentSoft);
  });
  test("unselected row is calm: no fill, two-space prefix", () => {
    const s = selectableRowStyle(false);
    expect(s.prefix).toBe("  ");
    expect(s.backgroundColor).toBeUndefined();
    expect(s.color).toBe(palette.text);
  });
});
