import { describe, expect, test } from "bun:test";

import {
  companionLineFor,
  KANNA_DONE_PICKS,
  KANNA_MOMENTS,
  kannaDoneKindForSkipKind,
  kannaDoneLine,
  kannaDoneText,
  kannaLine,
  kannaLinesFor,
  LINE_BUDGET,
  momentForStateKind,
} from "@/app-shell/kanna-voice";

describe("kanna copy", () => {
  test("every line fits one row and stays in voice", () => {
    for (const moment of KANNA_MOMENTS) {
      const lines = kannaLinesFor(moment);
      expect(lines.length, moment).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.length, line).toBeLessThanOrEqual(LINE_BUDGET);
        // She is brief and level. An exclamation mark or a second sentence is
        // the point where a companion turns into a mascot that chatters.
        expect(line, line).not.toContain("!");
        expect(line.split(". ").length, line).toBe(1);
        // Emoji live in the glyph slot, never in the copy.
        expect(/\p{Extended_Pictographic}/u.test(line), line).toBe(false);
      }
    }
  });

  test("lines are unique within a pool so a repeat never looks like a stutter", () => {
    for (const moment of KANNA_MOMENTS) {
      const lines = kannaLinesFor(moment);
      expect(new Set(lines).size, moment).toBe(lines.length);
    }
  });
});

describe("kanna line selection", () => {
  test("is pure — the same pick always yields the same line", () => {
    // The component re-renders on every keystroke; a counter here would re-roll
    // the line out from under whoever is reading it.
    expect(kannaLine("empty", 4)).toBe(kannaLine("empty", 4));
  });

  test("walks the pool and wraps, including on negative picks", () => {
    const pool = kannaLinesFor("error");
    expect(kannaLine("error", 0)).toBe(pool[0] as string);
    expect(kannaLine("error", pool.length)).toBe(pool[0] as string);
    // Callers should never have to sanitise the number they hold.
    expect(kannaLine("error", -1)).toBe(pool[pool.length - 1] as string);
  });
});

describe("the done moment", () => {
  test("speaks for each completion a surface claims", () => {
    // These constants are the contract between copy and call site: the pick IS
    // the line, so a pool reorder that swapped them would misname the moment.
    expect(kannaDoneLine("saved", "glyph")).toBe("saved your spot.");
    expect(kannaDoneLine("queued", "glyph")).toBe("queued.");
    expect(kannaDoneLine("downloaded", "glyph")).toBe("on disk now.");
    expect(kannaDoneLine("skip-intro", "glyph")).toBe("intro dodged.");
  });

  test("every declared pick stays inside its own pool", () => {
    const pool = kannaLinesFor("done");
    for (const pick of Object.values(KANNA_DONE_PICKS)) {
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(pool.length);
    }
    // Two kinds pointing at one line is copy debt, not a shortcut.
    expect(new Set(Object.values(KANNA_DONE_PICKS)).size).toBe(
      Object.values(KANNA_DONE_PICKS).length,
    );
  });

  test("maps a skipped segment to its own line, not a generic one", () => {
    expect(kannaDoneLine(kannaDoneKindForSkipKind("intro"), "glyph")).toBe("intro dodged.");
    expect(kannaDoneLine(kannaDoneKindForSkipKind("recap"), "glyph")).toBe("recap dodged.");
    expect(kannaDoneLine(kannaDoneKindForSkipKind("credits"), "glyph")).toBe("credits dodged.");
    // Unknown kinds still get a true sentence, just not a borrowed one.
    expect(kannaDoneLine(kannaDoneKindForSkipKind("unknown-kind"), "glyph")).toBe("skipped it.");
  });

  test("done text composes glyph plus line for plain-text slots", () => {
    expect(kannaDoneText("queued", "glyph")).toBe("🦊 queued.");
    expect(kannaDoneText("queued", "graphics")).toBe("🦊 queued.");
  });

  test("a switched-off companion finishes silently", () => {
    expect(kannaDoneLine("saved", "off")).toBeNull();
    expect(kannaDoneText("queued", "off")).toBeNull();
  });
});

describe("which surfaces speak", () => {
  test("only the kinds that leave a person with nothing to look at", () => {
    expect(momentForStateKind("empty")).toBe("empty");
    expect(momentForStateKind("error")).toBe("error");
    for (const quiet of ["loading", "info", "success"]) {
      expect(momentForStateKind(quiet), quiet).toBeNull();
    }
  });

  test("a switched-off companion says nothing anywhere", () => {
    expect(companionLineFor("empty", "off", 0)).toBeNull();
    expect(companionLineFor("error", "off", 0)).toBeNull();
  });

  test("the glyph tier still speaks — the copy is the tier every terminal gets", () => {
    expect(companionLineFor("empty", "glyph", 0)).toBe(kannaLine("empty", 0));
    expect(companionLineFor("empty", "graphics", 0)).toBe(kannaLine("empty", 0));
  });

  test("a quiet kind stays quiet even when the companion is on", () => {
    expect(companionLineFor("loading", "graphics", 0)).toBeNull();
  });
});
