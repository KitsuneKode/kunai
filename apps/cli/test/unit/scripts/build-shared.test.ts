import { describe, expect, test } from "bun:test";

import {
  assertNoForbiddenReleaseInputs,
  forbiddenReleaseInputs,
  requireBuildMetafile,
  type BunBuildMetafile,
} from "../../../scripts/build-shared";

function metafile(inputs: readonly string[]): BunBuildMetafile {
  return {
    inputs: Object.fromEntries(inputs.map((input) => [input, { bytes: 1, imports: [] }])),
    outputs: {},
  } as BunBuildMetafile;
}

describe("release build shared guards", () => {
  test("allows production source graph inputs", () => {
    const graph = metafile(["src/main.ts", "../../packages/providers/src/videasy/direct.ts"]);

    expect(forbiddenReleaseInputs(graph)).toEqual([]);
    expect(() => assertNoForbiddenReleaseInputs(graph)).not.toThrow();
  });

  test("rejects tests experiments plans and legacy imports in release graphs", () => {
    const graph = metafile([
      "src/main.ts",
      "test/unit/provider.test.ts",
      "apps/experiments/scratchpads/probe.ts",
      "archive/legacy/apps/cli/src/providers/old.ts",
      ".plans/runtime-note.md",
    ]);

    expect(forbiddenReleaseInputs(graph)).toEqual([
      ".plans/runtime-note.md",
      "apps/experiments/scratchpads/probe.ts",
      "archive/legacy/apps/cli/src/providers/old.ts",
      "test/unit/provider.test.ts",
    ]);
    expect(() => assertNoForbiddenReleaseInputs(graph)).toThrow("non-production inputs");
  });

  test("requires Bun to return a metafile when the release build requests one", () => {
    expect(() => requireBuildMetafile(undefined)).toThrow("did not return a metafile");
  });
});
