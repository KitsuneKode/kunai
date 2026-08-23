import { expect, test } from "bun:test";

import { frameWidth, renderedWidth, stripAnsi } from "../../support/rendered-width";

const ESC = String.fromCharCode(27);
const coloured = `${ESC}[38;2;255;143;176mGeneral${ESC}[39m ${ESC}[2m›${ESC}[22m`;

/**
 * The defect this exists for: width assertions used `line.length`, which counts
 * Ink's inline SGR bytes as glyphs. With `FORCE_COLOR=3` a 40-column tab strip
 * measured 149; at `FORCE_COLOR=0` the same assertion passed. The tests
 * inverted on an environment variable rather than on the layout.
 */
test("colour codes are not glyphs", () => {
  expect(coloured.length).toBe(42);
  expect(stripAnsi(coloured)).toBe("General ›");
  expect(renderedWidth(coloured)).toBe(9);
});

test("the same content measures the same with and without colour", () => {
  expect(renderedWidth(coloured)).toBe(renderedWidth("General ›"));
});

test("cursor and erase sequences are stripped too, not just colour", () => {
  expect(renderedWidth(`${ESC}[2K${ESC}[1;5Habc`)).toBe(3);
});

test("trailing padding does not count", () => {
  expect(renderedWidth("abc     ")).toBe(3);
});

/** A terminal lays out in columns, which is not character count either. */
test("wide glyphs occupy two columns", () => {
  expect(renderedWidth("日本語")).toBe(6);
  expect(renderedWidth("ab")).toBe(2);
});

test("combining marks and variation selectors occupy none", () => {
  expect(renderedWidth("é")).toBe(1);
  expect(renderedWidth(`x${String.fromCodePoint(0xfe0f)}`)).toBe(1);
});

test("frameWidth takes the widest line and ignores empty ones", () => {
  expect(frameWidth(`ab\n${coloured}\nc`)).toBe(9);
  expect(frameWidth("")).toBe(0);
});
