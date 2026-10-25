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

  /**
   * On 16 colours there are only six hues and their bright twins, so a careless
   * mapping makes unrelated signals the same colour: the brand accent, the anime
   * kind, the milestone and the mixed-day blend were all literal "magenta", and
   * the warning and the movie kind were both "yellow". One colour has to mean one
   * thing, so every signal that carries meaning gets its own entry here.
   */
  test("no two meaning-carrying tokens collapse to one colour on 16-colour terminals", () => {
    const resolved = resolveDesignTokens("16");
    const signals = [
      "accent",
      "ok",
      "warn",
      "danger",
      "info",
      "milestone",
      "typeAnime",
      "typeSeries",
      "typeMovie",
    ] as const;
    const seen = new Map<string, string>();
    for (const name of signals) {
      const value = resolved[name];
      const clash = seen.get(value);
      expect(clash, `${name} and ${clash} both resolve to "${value}"`).toBeUndefined();
      seen.set(value, name);
    }
  });

  describe("text and control contrast on the surfaces they render on (truecolor)", () => {
    const t = resolveDesignTokens("truecolor");
    const luminance = (hex: string): number => {
      const channel = (offset: number) => {
        const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const ratio = (a: string, b: string): number => {
      const [first, second] = [luminance(a), luminance(b)];
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };

    test.each(["text", "textDim", "muted"] as const)(
      "%s is body-readable (4.5:1) on every surface, including the selected row",
      (token) => {
        for (const surface of ["bg", "surface", "surfaceElevated", "surfaceActive"] as const) {
          expect(ratio(t[token], t[surface]), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    test("lineControl is a 3:1 edge on every surface a control sits on", () => {
      for (const surface of ["bg", "surface", "surfaceElevated"] as const) {
        expect(
          ratio(t.lineControl, t[surface]),
          `lineControl on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    test("the decorative line stays decorative, so nothing leans on it to mark a control", () => {
      // If `line` ever reaches 3:1 this is no longer a distinction worth keeping,
      // and lineControl can be retired. Until then, it is the tell that the two
      // tokens mean different things.
      expect(ratio(t.line, t.surface)).toBeLessThan(3);
    });
  });

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
