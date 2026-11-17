import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setPlainDecorationSource } from "@/app-shell/decoration-policy";
import { getStateBlockGlyph, getStateBlockTone } from "@/app-shell/primitives/StateBlock.model";

describe("StateBlock helpers", () => {
  let previousTerm: string | undefined;

  beforeEach(() => {
    setPlainDecorationSource(() => false);
    previousTerm = process.env.TERM;
    process.env.TERM = "xterm-256color";
  });

  afterEach(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
    setPlainDecorationSource(() => false);
  });

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
