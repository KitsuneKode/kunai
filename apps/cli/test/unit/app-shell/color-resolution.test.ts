import { describe, expect, test } from "bun:test";

import {
  detectTerminalColorLevel,
  resolveDesignTokens,
  type TerminalColorLevel,
} from "@kunai/design";

describe("design color resolution", () => {
  test.each([
    ["truecolor", "#ff8fb0"],
    ["256", "#ff87af"],
    ["16", "magenta"],
  ] satisfies readonly [TerminalColorLevel, string][])(
    "downgrades accent for %s terminals",
    (level, expectedAccent) => {
      const resolved = resolveDesignTokens(level);

      expect(resolved.accent).toBe(expectedAccent);
      expect(resolved.heatRamp.at(-1)).toBe(expectedAccent);
    },
  );

  test("detects remote/tmux-safe color levels without truecolor hints", () => {
    expect(detectTerminalColorLevel({ COLORTERM: "truecolor", TERM: "xterm-256color" })).toBe(
      "truecolor",
    );
    expect(detectTerminalColorLevel({ TERM: "screen-256color", TMUX: "/tmp/tmux-1000" })).toBe(
      "256",
    );
    expect(detectTerminalColorLevel({ TERM: "xterm" })).toBe("16");
  });
});
