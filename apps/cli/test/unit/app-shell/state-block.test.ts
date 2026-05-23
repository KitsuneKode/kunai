import { describe, expect, test } from "bun:test";

import { getStateBlockGlyph, getStateBlockTone } from "@/app-shell/primitives/StateBlock";

describe("StateBlock helpers", () => {
  test("maps state kind to glyphs", () => {
    expect(getStateBlockGlyph("loading")).toBe("◐");
    expect(getStateBlockGlyph("empty")).toBe("·");
    expect(getStateBlockGlyph("info")).toBe("●");
    expect(getStateBlockGlyph("success")).toBe("✓");
    expect(getStateBlockGlyph("error")).toBe("×");
  });

  test("maps errors to danger tone and success to ok tone", () => {
    expect(getStateBlockTone("error")).toBe("danger");
    expect(getStateBlockTone("success")).toBe("success");
  });
});
