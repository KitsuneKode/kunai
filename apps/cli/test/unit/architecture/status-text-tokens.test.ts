import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `danger` and `milestone` are too dark to read as text on this ground (Lc 46 and 40 on the canvas),
 * so text uses `dangerText` and `milestoneText`, the same hues lifted to Lc 60. The vivid originals
 * stay for borders and art. Two reds with no rule is a trap: the next `<Text color={palette.danger}>`
 * would quietly bring the unreadable one back, so the rule is checked here.
 */
const SRC = join(import.meta.dir, "../../../src/app-shell");

/** The only remaining reads of `palette.danger`, each with the reason it is not text. */
const NON_TEXT_DANGER = [
  {
    file: "root-status-shells.tsx",
    pattern: /borderColor=\{palette\.danger\}/,
    reason: "a border",
  },
  { file: "petal-fall.ts", pattern: /./, reason: "falling-petal art, not text" },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("status text tokens", () => {
  const files = sourceFiles(SRC).map((path) => ({
    name: relative(SRC, path),
    lines: readFileSync(path, "utf8").split("\n"),
  }));

  test("danger text reads dangerText, so only a border and petal art read palette.danger", () => {
    const stray: string[] = [];
    for (const file of files) {
      const allowed = NON_TEXT_DANGER.find((rule) => file.name.endsWith(rule.file));
      file.lines.forEach((line, index) => {
        if (!/palette\.danger\b/.test(line)) return;
        if (allowed?.pattern.test(line)) return;
        stray.push(`${file.name}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(stray).toEqual([]);
  });

  test("milestone text reads milestoneText", () => {
    const stray = files.flatMap((file) =>
      file.lines.flatMap((line, index) =>
        /palette\.milestone\b/.test(line) ? [`${file.name}:${index + 1}  ${line.trim()}`] : [],
      ),
    );
    expect(stray).toEqual([]);
  });

  test("the exemptions are still needed", () => {
    for (const rule of NON_TEXT_DANGER) {
      const file = files.find((f) => f.name.endsWith(rule.file));
      const reads = file?.lines.filter((line) => /palette\.danger\b/.test(line)) ?? [];
      expect(
        reads.length,
        `${rule.file} (${rule.reason}) no longer reads palette.danger`,
      ).toBeGreaterThan(0);
    }
  });
});
