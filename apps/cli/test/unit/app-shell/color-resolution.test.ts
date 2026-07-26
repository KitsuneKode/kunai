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

  describe("Windows consoles set neither COLORTERM nor TERM", () => {
    // The 16-colour branch resolves every surface token to literal "black", so
    // falling through to it on Windows flattened the whole UI.
    test.each([
      ["Windows Terminal", { WT_SESSION: "abc-123", OS: "Windows_NT" }],
      ["ConEmu", { ConEmuANSI: "ON", OS: "Windows_NT" }],
      ["bare Windows console", { OS: "Windows_NT" }],
      ["VS Code integrated terminal", { TERM_PROGRAM: "vscode" }],
    ] satisfies readonly [string, Record<string, string>][])("%s gets truecolor", (_name, env) => {
      expect(detectTerminalColorLevel(env)).toBe("truecolor");
    });

    test("surfaces keep their designed colour instead of collapsing to black", () => {
      const level = detectTerminalColorLevel({ WT_SESSION: "abc-123", OS: "Windows_NT" });
      const resolved = resolveDesignTokens(level);

      expect(resolved.surface).not.toBe("black");
      expect(resolved.surfaceElevated).not.toBe("black");
      expect(resolved.accentFill).not.toBe("black");
    });

    test("explicit user intent still wins over the Windows default", () => {
      expect(detectTerminalColorLevel({ OS: "Windows_NT", NO_COLOR: "1" })).toBe("16");
      expect(detectTerminalColorLevel({ OS: "Windows_NT", FORCE_COLOR: "1" })).toBe("16");
      // A real TERM means the Unix hints already classified it.
      expect(detectTerminalColorLevel({ OS: "Windows_NT", TERM: "xterm" })).toBe("16");
    });
  });
});
