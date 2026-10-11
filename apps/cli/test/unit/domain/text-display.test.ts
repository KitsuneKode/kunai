import { expect, test } from "bun:test";

import {
  padColumnsEnd,
  padColumnsStart,
  sanitizeTerminalText,
  truncateLine,
  wrapText,
} from "@/domain/text-display";

// Provider-supplied strings (failureReason, pickerHint, server names) flow
// through the truncation helpers — the terminal must never see raw control
// bytes, escape sequences, or bidi overrides regardless of what upstream sends.

const ESC = "\u001b";
const BEL = "\u0007";
const BS = "\u0008";
const RLO = "\u202e";
const BOM = "\ufeff";

test("sanitizeTerminalText strips ANSI CSI and OSC sequences", () => {
  expect(sanitizeTerminalText("plain")).toBe("plain");
  expect(sanitizeTerminalText(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  expect(sanitizeTerminalText(`a${ESC}[2Jb`)).toBe("ab");
  // OSC terminated by BEL — hyperlink/title injection.
  expect(sanitizeTerminalText(`x${ESC}]8;;https://evil.example${BEL}click${ESC}]8;;${BEL}y`)).toBe(
    "xclicky",
  );
});

test("sanitizeTerminalText strips an OSC ended by the string terminator", () => {
  expect(
    sanitizeTerminalText(`x${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\y`),
  ).toBe("xclicky");
});

test("sanitizeTerminalText handles many unterminated OSC introducers", () => {
  const hostile = `${ESC}]`.repeat(20_000);
  expect(sanitizeTerminalText(`a${hostile}b`)).toBe("ab");
});

test("sanitizeTerminalText strips C0/C1 controls, bidi marks, and BOM", () => {
  expect(sanitizeTerminalText("line1\nline2\r\nline3")).toBe("line1line2line3");
  expect(sanitizeTerminalText(`tab${BS}etween`)).toBe("tabetween");
  // RTL override — the classic terminal spoof.
  expect(sanitizeTerminalText(`good${RLO}drowssap`)).toBe("gooddrowssap");
  expect(sanitizeTerminalText(`${BOM}bom`)).toBe("bom");
});

test("truncateLine never emits control bytes even when they count as zero columns", () => {
  const tainted = `ok${ESC}[7m\nspoofed`;
  const out = truncateLine(tainted, 40);
  expect(out).not.toContain("\n");
  expect(out).not.toContain(ESC);
  expect(out).toBe("okspoofed");
});

test("padColumns helpers sanitize the value they pad", () => {
  expect(padColumnsEnd("a\nb", 8)).toBe(`ab${" ".repeat(6)}`);
  expect(padColumnsStart("a\tb", 8)).toBe(`${" ".repeat(6)}ab`);
});

test("wrapText strips injection before wrapping", () => {
  const lines = wrapText(`hello${ESC}[1m world\nagain`, 40, 3);
  for (const line of lines) {
    expect(line).not.toContain(ESC);
    expect(line).not.toContain("\n");
  }
  // The stripped newline joins the words — honest, if ugly.
  expect(lines[0]).toContain("hello worldagain");
});
