import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { measureColumns } from "@/domain/text-display";

const CAPTURE_DIR = path.join(import.meta.dir, "../../__captures__");

/**
 * Surfaces this PR owns and regenerated from real components. The per-line width
 * gate applies only here: unrelated historical captures were produced by earlier
 * harnesses and their overflow is not this change's contract to enforce.
 */
const PR4_CAPTURE_FAMILIES = [
  "downloads",
  "calendar-daystrip",
  "calendar-rows",
  "library-empty",
  "library-populated",
] as const;

/**
 * Captures carry their own width in the header the harness writes:
 * `# <surface> · <width> (<cols>×<rows>)`. Reading it back is what makes the
 * gate honest — a capture is checked against the width it CLAIMS, so a harness
 * that renders at a fixed 96 columns and files the frame as "narrow" fails.
 */
function captureWidthFromHeader(content: string): number {
  const header = content.split("\n", 1)[0] ?? "";
  const match = header.match(/\((\d+)×\d+\)/);
  expect(match, `capture header must declare its width: ${header}`).not.toBeNull();
  return Number(match?.[1]);
}

/** Committed layout goldens — must stay non-empty; refresh via harness capture scripts. */
describe("committed layout goldens", () => {
  test("every __captures__ file is non-empty text", async () => {
    const files = (await readdir(CAPTURE_DIR)).filter((name) => name.endsWith(".txt"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = await readFile(path.join(CAPTURE_DIR, file), "utf8");
      expect(content.trim().length, `${file} should not be empty`).toBeGreaterThan(0);
    }
  });

  test("capture triplets include narrow, medium, and wide widths", async () => {
    const files = (await readdir(CAPTURE_DIR)).filter((name) => name.endsWith(".txt"));
    const bases = new Map<string, Set<string>>();

    for (const file of files) {
      const match = file.match(/^(.+)\.(narrow|medium|wide)\.txt$/);
      if (!match) continue;
      const [, base, width] = match;
      const widths = bases.get(base!) ?? new Set();
      widths.add(width!);
      bases.set(base!, widths);
    }

    for (const [base, widths] of bases) {
      expect(widths.has("narrow"), `${base} missing narrow`).toBe(true);
      expect(widths.has("medium"), `${base} missing medium`).toBe(true);
      expect(widths.has("wide"), `${base} missing wide`).toBe(true);
    }
  });
});

describe("PR 4 capture width budget", () => {
  test("every owned capture line fits the width its header names", async () => {
    const files = (await readdir(CAPTURE_DIR)).filter((name) =>
      PR4_CAPTURE_FAMILIES.some((family) => name.startsWith(`${family}.`)),
    );
    expect(files.length).toBe(PR4_CAPTURE_FAMILIES.length * 3);

    for (const file of files) {
      const content = await readFile(path.join(CAPTURE_DIR, file), "utf8");
      const width = captureWidthFromHeader(content);
      const [, ...body] = content.split("\n");
      for (const line of body) {
        // Frames are already ANSI-stripped by the harness, and terminal columns
        // (not JS string length) are what a wide glyph actually costs.
        expect(
          measureColumns(line),
          `${file}: "${line}" exceeds ${width} columns`,
        ).toBeLessThanOrEqual(width);
      }
    }
  });

  test("each owned family has all three widths and non-empty content", async () => {
    const files = await readdir(CAPTURE_DIR);
    for (const family of PR4_CAPTURE_FAMILIES) {
      for (const width of ["narrow", "medium", "wide"] as const) {
        const name = `${family}.${width}.txt`;
        expect(files, `${name} missing`).toContain(name);
        const content = await readFile(path.join(CAPTURE_DIR, name), "utf8");
        expect(content.split("\n").slice(1).join("").trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("narrow and medium downloads carry no rail-only facts", async () => {
    for (const width of ["narrow", "medium"] as const) {
      const content = await readFile(path.join(CAPTURE_DIR, `downloads.${width}.txt`), "utf8");
      // "Status" is a rail-only fact label; list rows show a bare state chip.
      expect(content, `downloads.${width} must not render the rail`).not.toContain("Status");
    }
  });

  test("wide downloads show the selected-job rail and canonical position labels", async () => {
    const content = await readFile(path.join(CAPTURE_DIR, "downloads.wide.txt"), "utf8");
    expect(content).toContain("Status");
    // Series keep SxxExx, anime keep episode-only, movies stay quiet "Movie".
    expect(content).toMatch(/S\d\dE\d\d/);
    expect(content).toMatch(/(^|[^S\d])E\d\d/m);
    expect(content).toContain("Movie");
  });

  test("no download capture invents a synthetic movie episode", async () => {
    for (const width of ["narrow", "medium", "wide"] as const) {
      const content = await readFile(path.join(CAPTURE_DIR, `downloads.${width}.txt`), "utf8");
      const movieLine = content.split("\n").find((line) => line.includes("Dune: Part Two"));
      expect(movieLine, `downloads.${width} should show the legacy movie job`).toBeDefined();
      expect(movieLine).not.toContain("S01E01");
      // Narrow truncates the title column, so only the widths that can show the
      // whole label are asserted on it. What matters at every width is that the
      // synthetic S01E01 never appears.
      if (width !== "narrow") expect(movieLine).toContain("Movie");
    }
  });

  test("library captures show a real empty state and a real populated shelf", async () => {
    const empty = await readFile(path.join(CAPTURE_DIR, "library-empty.medium.txt"), "utf8");
    expect(empty).toContain("No offline titles yet");

    const populated = await readFile(
      path.join(CAPTURE_DIR, "library-populated.medium.txt"),
      "utf8",
    );
    expect(populated).toContain("Dune: Part Two");
    expect(populated).toContain("Severance");
    expect(populated).toContain("Frieren");
  });

  test("width-filling surfaces actually widen with the terminal budget", async () => {
    // A harness that renders at a FIXED width (the old calendar `width={96}`)
    // produces near-identical frames under all three names, and merely wraps
    // rather than overflowing — so the per-line gate alone cannot catch it.
    // Real width reactivity shows up as a strictly growing widest line.
    const widest = async (name: string) => {
      const content = await readFile(path.join(CAPTURE_DIR, name), "utf8");
      return Math.max(
        0,
        ...content
          .split("\n")
          .slice(1)
          .map((line) => measureColumns(line.replace(/\s+$/, ""))),
      );
    };

    for (const family of ["calendar-rows", "downloads", "library-populated"] as const) {
      const narrow = await widest(`${family}.narrow.txt`);
      const medium = await widest(`${family}.medium.txt`);
      const wide = await widest(`${family}.wide.txt`);
      expect(medium, `${family}: medium must be wider than narrow`).toBeGreaterThan(narrow);
      expect(wide, `${family}: wide must be wider than medium`).toBeGreaterThan(medium);
    }
  });
});
