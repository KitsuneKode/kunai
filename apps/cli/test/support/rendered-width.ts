/**
 * How wide a rendered terminal line actually is.
 *
 * Ink emits SGR colour sequences inline, so `line.length` counts escape bytes
 * as if they were glyphs. That makes any width assertion depend on whether
 * colour happens to be enabled: with `FORCE_COLOR=3` a 40-column tab strip
 * measured 149, and the same assertion passed at `FORCE_COLOR=0`. `FORCE_COLOR`
 * is set in plenty of developer shells and CI images — and is exactly what you
 * would set to exercise the colour paths — so the tests inverted depending on
 * the environment rather than on the layout they exist to check.
 *
 * Terminals lay out in *display columns*, which is also not the same as
 * character count: a combining mark occupies none, and a CJK ideograph
 * occupies two.
 */

/**
 * SGR and CSI sequences Ink can emit: colour, cursor movement, erase.
 *
 * Deliberately a local regex rather than the `ansi-regex` package — that is a
 * transitive dependency of Ink, not one this workspace declares, so importing
 * it would work today and break whenever Ink's tree changes.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /[][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;

/** Ranges a terminal renders two columns wide (East Asian Wide + Fullwidth). */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi
  [0x3041, 0x33ff], // Hiragana through CJK compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd], // CJK Extension B+
];

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function codePointWidth(codePoint: number): number {
  // Combining marks and zero-width joiners occupy no column.
  if (codePoint === 0x200d) return 0;
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return 0;
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 0; // variation selectors
  return WIDE_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 2 : 1;
}

/** Display columns one line occupies, ignoring colour and trailing padding. */
export function renderedWidth(line: string): number {
  let width = 0;
  for (const char of stripAnsi(line).trimEnd()) {
    width += codePointWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

/** Widest line in a multi-line frame. */
export function frameWidth(frame: string): number {
  return Math.max(0, ...frame.split("\n").map(renderedWidth));
}
