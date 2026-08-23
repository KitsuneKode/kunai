import { describe, expect, test } from "bun:test";

import {
  formatGitHubWarning,
  selectChangedLintPaths,
} from "../../../../../scripts/anti-slop-changed";

describe("anti-slop changed-file advisory", () => {
  test("selects existing changed source files once in stable order", () => {
    const existing = new Set(["z.tsx", "a.mts", "script.cjs"]);

    expect(
      selectChangedLintPaths(
        ["z.tsx", "README.md", "deleted.ts", "a.mts", "z.tsx", "script.cjs"],
        (path) => existing.has(path),
      ),
    ).toEqual(["a.mts", "script.cjs", "z.tsx"]);
  });

  test("renders escaped GitHub warning annotations with source positions", () => {
    expect(
      formatGitHubWarning({
        filename: "apps/cli/src/a,b.ts",
        code: "anti-slop(rule:name)",
        message: "parse 100%\nnow",
        labels: [{ span: { line: 12, column: 7 } }],
      }),
    ).toBe(
      "::warning file=apps/cli/src/a%2Cb.ts,line=12,col=7,title=anti-slop(rule%3Aname)::parse 100%25%0Anow",
    );
  });
});
