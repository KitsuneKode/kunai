import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const CAPTURE_DIR = path.join(import.meta.dir, "../../__captures__");

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
