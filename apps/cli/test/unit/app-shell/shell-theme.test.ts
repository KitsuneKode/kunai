import { describe, expect, test } from "bun:test";

import { hotkeyLabel } from "@/app-shell/shell-theme";

describe("hotkeyLabel", () => {
  test("wraps plain key in brackets", () => {
    expect(hotkeyLabel("esc")).toBe("[esc]");
    expect(hotkeyLabel("enter")).toBe("[enter]");
  });

  test("returns glyph alone when § sentinel is present", () => {
    expect(hotkeyLabel("⏭§n")).toBe("⏭");
    expect(hotkeyLabel("⏮§p")).toBe("⏮");
    expect(hotkeyLabel("↻§r")).toBe("↻");
  });
});
