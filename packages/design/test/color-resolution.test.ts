import { describe, expect, test } from "bun:test";

import { detectTerminalColorLevel, resolveDesignTokens } from "../src/color-resolution";

describe("@kunai/design color level none", () => {
  test("NO_COLOR (any value) selects none", () => {
    expect(detectTerminalColorLevel({ NO_COLOR: "1", TERM: "xterm-256color" })).toBe("none");
    expect(detectTerminalColorLevel({ NO_COLOR: "", COLORTERM: "truecolor" })).toBe("none");
  });

  test("FORCE_COLOR=0 and TERM=dumb select none", () => {
    expect(detectTerminalColorLevel({ FORCE_COLOR: "0", TERM: "xterm-256color" })).toBe("none");
    expect(detectTerminalColorLevel({ TERM: "dumb", COLORTERM: "truecolor" })).toBe("none");
  });

  test("resolveDesignTokens at none keeps raw palette values for non-Ink consumers", () => {
    const none = resolveDesignTokens("none");
    const truecolor = resolveDesignTokens("truecolor");
    expect(none.accent).toBe(truecolor.accent);
  });

  test("explicit FORCE_COLOR still wins when NO_COLOR is absent", () => {
    expect(detectTerminalColorLevel({ FORCE_COLOR: "1", TERM: "xterm" })).toBe("16");
    expect(detectTerminalColorLevel({ FORCE_COLOR: "3", TERM: "xterm" })).toBe("truecolor");
  });
});
