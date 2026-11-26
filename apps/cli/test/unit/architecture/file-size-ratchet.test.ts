import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildFileSizeBaseline,
  canLowerFileSizeBaseline,
  countLines,
  diffFileSizeBaseline,
  FILE_SIZE_BASELINE_RELATIVE_PATH,
  MAX_SOURCE_FILE_LINES,
  scanSourceFileLineCounts,
  type FileSizeBaseline,
} from "../../../../../scripts/update-file-size-baseline";
import { REPO_ROOT } from "../../support/repo-scan";

function loadCommittedBaseline(): FileSizeBaseline {
  const path = join(REPO_ROOT, FILE_SIZE_BASELINE_RELATIVE_PATH);
  // SAFETY: baseline JSON is a checked-in flat path->line-count map written by scripts/update-file-size-baseline.ts.
  return JSON.parse(readFileSync(path, "utf8")) as FileSizeBaseline;
}

describe("file-size ratchet", () => {
  test(`source files in apps/*/src and packages/*/src stay <= ${MAX_SOURCE_FILE_LINES} lines or within baseline`, () => {
    const baseline = loadCommittedBaseline();
    const current = scanSourceFileLineCounts(REPO_ROOT);
    const drift = diffFileSizeBaseline(baseline, current);

    const violations = [
      ...drift.grew.map(
        ({ file, baseline: was, lines: now }) =>
          `${file}: grew from baseline ${was} to ${now} lines (+${now - was})`,
      ),
      ...drift.overLimit.map(
        ({ file, lines }) =>
          `${file}: ${lines} lines exceeds the ${MAX_SOURCE_FILE_LINES}-line limit (un-baselined)`,
      ),
    ];

    expect(violations).toEqual([]);
  });

  test("baseline stays ratcheted down when baselined files shrink or are removed", () => {
    const baseline = loadCommittedBaseline();
    const current = scanSourceFileLineCounts(REPO_ROOT);
    const drift = diffFileSizeBaseline(baseline, current);

    const stale = [
      ...drift.shrunk.map(
        ({ file, baseline: was, lines: now }) =>
          `${file}: shrunk ${was} -> ${now} lines (run \`bun run ratchet:file-size:update\` to lower baseline)`,
      ),
      ...drift.removed.map(
        ({ file, baseline: was }) =>
          `${file}: removed from tree (was ${was} lines; run \`bun run ratchet:file-size:update\`)`,
      ),
    ];

    expect(stale).toEqual([]);
  });
});

describe("file-size ratchet helpers", () => {
  test("countLines matches LF and CRLF files with or without trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("one")).toBe(1);
    expect(countLines("one\n")).toBe(1);
    expect(countLines("one\r\n")).toBe(1);
    expect(countLines("one\ntwo\n")).toBe(2);
    expect(countLines("one\r\ntwo\r\nthree")).toBe(3);
  });

  test("diffFileSizeBaseline classifies growth, new over-limit files, shrinks, and removals", () => {
    const baseline: FileSizeBaseline = {
      "apps/cli/src/grew.ts": 900,
      "apps/cli/src/shrunk.ts": 1000,
      "apps/cli/src/dropped-below.ts": 850,
      "apps/cli/src/deleted.ts": 950,
      "apps/cli/src/unchanged.ts": 820,
    };
    const current = new Map<string, number>([
      ["apps/cli/src/grew.ts", 905],
      ["apps/cli/src/shrunk.ts", 920],
      ["apps/cli/src/dropped-below.ts", 790],
      ["apps/cli/src/unchanged.ts", 820],
      ["apps/cli/src/new-giant.ts", 801],
      ["apps/cli/src/new-ok.ts", 800],
    ]);

    const drift = diffFileSizeBaseline(baseline, current);
    expect(drift.grew).toEqual([{ file: "apps/cli/src/grew.ts", baseline: 900, lines: 905 }]);
    expect(drift.overLimit).toEqual([{ file: "apps/cli/src/new-giant.ts", lines: 801 }]);
    expect(drift.shrunk).toEqual([
      { file: "apps/cli/src/dropped-below.ts", baseline: 850, lines: 790 },
      { file: "apps/cli/src/shrunk.ts", baseline: 1000, lines: 920 },
    ]);
    expect(drift.removed).toEqual([{ file: "apps/cli/src/deleted.ts", baseline: 950 }]);

    expect(canLowerFileSizeBaseline(true, drift)).toBe(false);
    expect(canLowerFileSizeBaseline(false, drift)).toBe(true);
  });

  test("canLowerFileSizeBaseline allows pure shrinks and drops files <= 800 lines", () => {
    const baseline: FileSizeBaseline = {
      "apps/cli/src/shrunk.ts": 1000,
      "apps/cli/src/dropped-below.ts": 850,
    };
    const current = new Map<string, number>([
      ["apps/cli/src/shrunk.ts", 910],
      ["apps/cli/src/dropped-below.ts", 780],
    ]);
    const drift = diffFileSizeBaseline(baseline, current);
    expect(canLowerFileSizeBaseline(true, drift)).toBe(true);
    expect(buildFileSizeBaseline(current)).toEqual({ "apps/cli/src/shrunk.ts": 910 });
  });
});
